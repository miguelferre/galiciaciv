"""Tile improvements: autopistas, vías rápidas and ferrocarril rasterised onto hex links, plus ports and airports.

Adapted from usaciv's build/infrastructure.py (Karpathy, MIT). Lines are never shipped as polylines. OpenStreetMap ways are
stitched into chains, sampled every SAMPLE_RADII hex radii and snapped to hex centres; a cell the line only clips at a corner is
dropped, and of three links that form a triangle (the two carriageways of an autovía, a double track) the least used
one of the lowest class goes. The browser draws a link as a road or rail segment from hex centre to hex centre.

Ports (Wikidata, CC0) and airports (OpenStreetMap, ODbL) carry position and name only: Puertos del Estado and AENA
require prior written authorisation, so no tonnage, passengers, operations or cargo is used (D-002, 2026-11-26).
Size rule: no traffic ranking exists, so every port and every airport is drawn at one fixed size (tier 1) and the
lists are ordered by name. A site's `cell` is the Galician land hex at its
point, or the nearest one up to about SITE_KM away; x/y stay the true position.
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from ..core.hexgrid import HexGrid
from ..core.store import load_interim_payload, write_web
from .placing import SITE_KM, Placer

REQUIRES = ["_world", "osm_vias", "wikidata_puertos", "osm_aeropuertos", "ige_comarcas", "cities.json"]
PRODUCES = ["infrastructure.json"]

SAMPLE_RADII = 0.2  # sampling step along a line, in hex radii
ROAD_CLASSES = [{"id": "autovia", "name": "Autopistas y autovías"},
                {"id": "via_rapida", "name": "Vías rápidas y carreteras principales"}]
RAIL_TIERS = [{"id": "principal", "name": "Línea principal o de alta velocidad"},
              {"id": "secundaria", "name": "Otras líneas"}]
RULES = {
    "roads": "Vías de OpenStreetMap, muestreadas y ajustadas a enlaces entre centros de hexágonos. "
             "Clase 0: autopistas y autovías (highway=motorway). Clase 1: vías rápidas y carreteras principales "
             "(highway=trunk) donde ninguna autovía une ya los mismos dos hexágonos. Es dibujo del mapa, no el trazado exacto.",
    "rail": "Ferrocarril de OpenStreetMap (ancho ibérico, internacional y métrico), sin vías de servicio ni líneas "
            "industriales o turísticas. Línea principal: usage=main o highspeed=yes. Es dibujo del mapa, no el trazado exacto.",
    "ports": "Puertos de interés general de Galicia, con su posición de Wikidata. No llevan cifras de tráfico: Puertos "
             "del Estado exige autorización previa. Todos se dibujan del mismo tamaño y se ordenan por nombre. "
             "Los puertos autonómicos no están.",
    "airports": "Los aeropuertos de Galicia (Santiago-Rosalía de Castro, A Coruña y Vigo), con su posición de OpenStreetMap. "
                "No llevan cifras de tráfico: Aena exige autorización previa. Todos se dibujan del mismo tamaño y se "
                "ordenan por nombre.",
}


# ------------------------------------------------------------------ hex helpers


def _axial(grid: HexGrid, cell: int) -> tuple[int, int]:
    col, row = grid.col_row(cell)
    return col - (row - (row & 1)) // 2, row


def _from_axial(grid: HexGrid, q: int, r: int) -> int:
    col = q + (r - (r & 1)) // 2
    if 0 <= col < grid.cols and 0 <= r < grid.rows:
        return grid.index(col, r)
    return -1


def hex_distance(grid: HexGrid, a: int, b: int) -> int:
    (q1, r1), (q2, r2) = _axial(grid, a), _axial(grid, b)
    return (abs(q1 - q2) + abs(r1 - r2) + abs((q1 + r1) - (q2 + r2))) // 2


def hex_walk(grid: HexGrid, a: int, b: int) -> list[int]:
    """Cells on the hex line from a to b, both included (cube lerp with a tiny nudge to break ties)."""
    n = hex_distance(grid, a, b)
    if n <= 1:
        return [a, b] if a != b else [a]
    (q1, r1), (q2, r2) = _axial(grid, a), _axial(grid, b)
    out = []
    for i in range(n + 1):
        t = i / n
        x = q1 + (q2 - q1) * t + 1e-6
        z = r1 + (r2 - r1) * t + 1e-6
        y = -x - z
        rx, ry, rz = round(x), round(y), round(z)
        dx, dy, dz = abs(rx - x), abs(ry - y), abs(rz - z)
        if dx > dy and dx > dz:
            rx = -ry - rz
        elif dy <= dz:
            rz = -rx - ry
        c = _from_axial(grid, rx, rz)
        if c >= 0 and (not out or out[-1] != c):
            out.append(c)
    return out


def sample_cells(grid: HexGrid, pts: list[tuple[float, float]]) -> list[int]:
    """The distinct consecutive cells along a projected line, sampled every SAMPLE_RADII hex radii."""
    run: list[int] = []
    step = SAMPLE_RADII * grid.radius

    def add(x, y):
        c = grid.cell_at(x, y)
        if c >= 0 and (not run or run[-1] != c):
            run.append(c)

    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        steps = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        for i in range(steps):
            t = i / steps
            add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
    if pts:
        add(*pts[-1])
    return run


def straighten(grid: HexGrid, run: list[int]) -> list[int]:
    """Drop detour cells: where the cells before and after a cell are neighbours themselves, the line only clipped
    that cell's corner. Without this, a road running along a row boundary zigzags between two rows."""
    out = []
    for c in run:
        while len(out) >= 2 and c in grid.neighbours(out[-2]):
            out.pop()
        if not out or out[-1] != c:
            out.append(c)
    return out


def links_of(grid: HexGrid, run: list[int]) -> list[tuple[int, int]]:
    if len(run) < 2:
        return []
    full = [run[0]]
    for a, b in zip(run, run[1:]):
        full += hex_walk(grid, a, b)[1:]
    run = straighten(grid, full)
    out = []
    for a, b in zip(run, run[1:]):
        path = hex_walk(grid, a, b)
        out += [(u, v) if u < v else (v, u) for u, v in zip(path, path[1:]) if u != v]
    return out


def stitch(lines: list[list]) -> list[list]:
    """Join polylines that share an end point into longer chains (each line used once), so that straighten() sees a
    whole road and not one short OSM way at a time."""
    ends = defaultdict(list)
    for k, line in enumerate(lines):
        ends[tuple(line[0])].append(k)
        ends[tuple(line[-1])].append(k)
    used = [False] * len(lines)
    chains = []
    for k, line in enumerate(lines):
        if used[k]:
            continue
        used[k] = True
        chain = list(line)
        for _ in range(2):  # grow the tail, flip, grow what was the head
            while True:
                tail = tuple(chain[-1])
                j = next((j for j in ends[tail] if not used[j]), None)
                if j is None:
                    break
                used[j] = True
                nxt = lines[j] if tuple(lines[j][0]) == tail else lines[j][::-1]
                chain += nxt[1:]
            chain.reverse()
        chains.append(chain)
    return chains


def prune_triangles(grid: HexGrid, links: dict) -> int:
    """`links`: {(a, b): [class, support, names]}. Of every three links closing a triangle, drop the one of the
    highest class number and least support. The two ends stay joined through the third cell. Returns the count."""
    adj = defaultdict(set)
    for a, b in links:
        adj[a].add(b)
        adj[b].add(a)
    dropped = 0
    order = sorted(links, key=lambda k: (-links[k][0], links[k][1], k))  # weakest first
    for a, b in order:
        if adj[a] & adj[b]:
            del links[(a, b)]
            adj[a].discard(b)
            adj[b].discard(a)
            dropped += 1
    return dropped


# ------------------------------------------------------------------ roads and rail


def road_name(ref: str | None) -> str | None:
    """«AG-55;E-70» → «AG-55»: the first reference that is not a European route number."""
    parts = [p.strip() for p in (ref or "").split(";") if p.strip()]
    own = [p for p in parts if not p.startswith("E-")]
    return (own or parts or [None])[0]


def build_links(place: Placer, ways: list[dict], class_of) -> tuple[list[list], int]:
    """[[a, b, class, name]] of the ways class_of() accepts (it returns 0, 1 or None)."""
    grid, owner = place.grid, place.owner
    groups = defaultdict(list)  # (class, name) → projected lines
    for w in ways:
        cls = class_of(w)
        if cls is not None:
            groups[(cls, road_name(w.get("ref")))].append([place.proj(lon, lat) for lon, lat in w["line"]])
    links: dict = {}
    for (cls, name), lines in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        for chain in stitch(lines):
            for key in links_of(grid, sample_cells(grid, chain)):
                a, b = key
                if owner[a] == -2 or owner[b] == -2 or (owner[a] < 0 and owner[b] < 0):
                    continue  # into Asturias, Castilla y León or Portugal, or over water at both ends
                rec = links.setdefault(key, [cls, 0, Counter()])
                if cls < rec[0]:
                    rec[0], rec[1] = cls, 0
                    rec[2].clear()
                if cls == rec[0]:
                    rec[1] += 1
                    if name:
                        rec[2][name] += 1
    dropped = prune_triangles(grid, links)
    out = []
    for (a, b), (cls, _, names) in sorted(links.items()):
        name = min(names, key=lambda n: (-names[n], n)) if names else None
        out.append([a, b, cls, name])
    return out, dropped


def road_class(w: dict) -> int | None:
    return {"motorway": 0, "trunk": 1}.get(w.get("highway"))


def rail_class(w: dict) -> int | None:
    if w.get("railway") not in ("rail", "narrow_gauge"):
        return None
    return 0 if w.get("usage") == "main" or w.get("highspeed") == "yes" else 1


# ------------------------------------------------------------------ sites


def build_ports(place: Placer, doc: dict) -> list[dict]:
    out = []
    for p in sorted(doc["ports"], key=lambda p: p["name"]):
        at = place.place(p["lon"], p["lat"])
        if at is None:
            print(f"    ! port without a Galician hex: {p['name']}")
            continue
        out.append({"id": str(p["id"]), "name": p["name"], "authority": p.get("authority"), "type": "coastal", **at})
    return out


def build_airports(place: Placer, doc: dict) -> list[dict]:
    out = []
    for a in sorted(doc["airports"], key=lambda a: a["name"]):
        at = place.place(a["lon"], a["lat"])
        if at is None:
            print(f"    ! airport without a Galician hex: {a['name']}")
            continue
        out.append({"id": a["id"], "icao": a.get("icao"), "name": a["name"], "city": a.get("city"), **at})
    return out


# ------------------------------------------------------------------ build


def build() -> None:
    place = Placer()
    osm = load_interim_payload("osm_vias")
    ports_in = load_interim_payload("wikidata_puertos")
    air_in = load_interim_payload("osm_aeropuertos")
    roads, dropped_roads = build_links(place, osm["data"]["ways"], road_class)
    rail, dropped_rail = build_links(place, osm["data"]["ways"], rail_class)
    rail = [r[:3] for r in rail]
    ports = build_ports(place, ports_in["data"])
    airports = build_airports(place, air_in["data"])

    doc = {
        "version": 1,
        "vintage": {"roads": osm["vintage"], "rail": osm["vintage"], "ports": ports_in["vintage"],
                    "airports": air_in["vintage"]},
        "sources": ["osm_vias", "wikidata_puertos", "osm_aeropuertos"],
        "rules": RULES,
        "road_classes": ROAD_CLASSES,
        "rail_tiers": RAIL_TIERS,
        "roads": roads,
        "rail": rail,
        "ports": ports,
        "airports": airports,
    }
    write_web("infrastructure.json", doc)
    owner = place.owner
    road_cells = {c for a, b, *_ in roads for c in (a, b) if owner[c] >= 0}
    rail_cells = {c for a, b, _ in rail for c in (a, b) if owner[c] >= 0}
    n0 = sum(1 for r in roads if r[2] == 0)
    print(f"    roads: {n0} autovía + {len(roads) - n0} vía rápida links on {len(road_cells)} hexes; "
          f"rail: {len(rail)} links on {len(rail_cells)} hexes (triangles dropped: {dropped_roads} road, "
          f"{dropped_rail} rail); {len(ports)} ports, {len(airports)} airports")


# ------------------------------------------------------------------ check


def check(web_dir: Path) -> list[tuple[str, str]]:
    path = Path(web_dir) / "infrastructure.json"
    if not path.exists():
        return [("NOTE", "infrastructure.json not built (optional; run: build infrastructure --deps)")]
    out = []
    doc = json.loads(path.read_text(encoding="utf-8"))
    for k in ("version", "vintage", "sources", "road_classes", "roads", "rail", "ports", "airports"):
        if k not in doc:
            out.append(("FAIL", f"infrastructure.json lacks '{k}'"))
    if any(lv == "FAIL" for lv, _ in out):
        return out
    if doc["version"] != 1:
        out.append(("FAIL", f"infrastructure.json version {doc['version']!r} (expected 1)"))
    wpath = Path(web_dir) / "world.json"
    world = json.loads(wpath.read_text(encoding="utf-8")) if wpath.exists() else None
    if not world or "grid" not in world:
        return out + [("NOTE", "infrastructure.json: world.json unavailable, cell checks skipped")]
    grid = HexGrid(world["grid"]["radius"], world["grid"]["cols"], world["grid"]["rows"])
    owner = world.get("owner") or []
    n = grid.size
    county_ids = {c["geoid"] for c in world.get("counties", [])}
    cpath = Path(web_dir) / "cities.json"
    city_ids = {c["id"] for c in json.loads(cpath.read_text(encoding="utf-8"))} if cpath.exists() else None
    spath = Path(web_dir) / "sources.json"
    if spath.exists():
        ids = {s["id"] for s in json.loads(spath.read_text(encoding="utf-8"))}
        miss = [s for s in doc["sources"] if s not in ids]
        if miss:
            out.append(("WARN", f"infrastructure.json cites sources missing from sources.json: {miss}"))

    def bad_link(link, ncls):
        if not isinstance(link, list) or len(link) < 3:
            return "shape"
        a, b, c = link[:3]
        if not all(isinstance(v, int) for v in (a, b, c)):
            return "types"
        if not (0 <= a < b < n):
            return "order/range"
        if b not in grid.neighbours(a):
            return "not neighbours"
        if len(owner) == n and owner[a] < 0 and owner[b] < 0:
            return "no Galician land end"
        if not 0 <= c < ncls:
            return "class"
        return None

    for key, ncls in (("roads", len(doc["road_classes"])), ("rail", len(doc.get("rail_tiers") or [0, 1]))):
        links = doc[key]
        bad = [(l, why) for l in links if (why := bad_link(l, ncls))]
        pairs = [tuple(l[:2]) for l in links if isinstance(l, list)]
        dup = len(pairs) - len(set(pairs))
        if not links or bad or dup:
            out.append(("FAIL", f"infrastructure.json {key}: {len(links)} links, {len(bad)} bad (e.g. {bad[:2]}), "
                                f"{dup} duplicates"))
        else:
            cells = {c for l in links for c in l[:2]}
            out.append(("PASS", f"infrastructure.json {key}: {len(links)} neighbour links on {len(cells)} hexes"))
    if any(not (r[3] is None or isinstance(r[3], str)) for r in doc["roads"] if len(r) > 3):
        out.append(("FAIL", "infrastructure.json roads: route name must be a string or null"))

    def check_sites(key, num_keys):
        probs = [] if doc[key] else [f"no {key}"]
        for s in doc[key]:
            c = s.get("cell")
            if not isinstance(c, int) or not 0 <= c < n or (len(owner) == n and owner[c] < 0):
                probs.append(f"{s.get('id')}: cell {c!r} is not Galician land")
                continue
            if any(s.get(k) is not None and not isinstance(s.get(k), (int, float)) for k in num_keys):
                probs.append(f"{s.get('id')}: non-numeric value")
            cx, cy = grid.center(*grid.col_row(c))
            if not all(isinstance(s.get(k), (int, float)) for k in ("x", "y")) or \
                    math.dist((cx, cy), (s["x"], s["y"])) > SITE_KM + 3 * grid.radius:
                probs.append(f"{s.get('id')}: x/y far from its cell")
            if s.get("county") is not None and county_ids and s["county"] not in county_ids:
                probs.append(f"{s.get('id')}: unknown county {s['county']}")
            if s.get("cbsa") is not None and city_ids is not None and s["cbsa"] not in city_ids:
                probs.append(f"{s.get('id')}: unknown cbsa {s['cbsa']}")
        ids = [s.get("id") for s in doc[key]]
        if len(ids) != len(set(ids)):
            probs.append("duplicate ids")
        return probs

    for key in ("ports", "airports"):
        probs = check_sites(key, ())
        banned = {"tons", "passengers", "operations", "cargo_t", "teus", "rank", "hub"} & {k for s in doc[key] for k in s}
        if banned:
            probs.append(f"traffic fields {sorted(banned)} must not be published (authorisation required)")
        if probs:
            out.append(("FAIL", f"infrastructure.json {key}: {len(probs)} problems, e.g. {probs[:3]}"))
        else:
            inside = sum(1 for s in doc[key] if s.get("cbsa"))
            out.append(("PASS", f"infrastructure.json {key}: {len(doc[key])} sites, {inside} in a mapped city"))
    size = path.stat().st_size
    if size > 300_000:
        out.append(("WARN", f"infrastructure.json is {size / 1e3:.0f} kB (eager files should stay under ~300 kB)"))
    return out
