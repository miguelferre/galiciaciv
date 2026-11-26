"""Trade routes: the largest daily mobility flows between comarcas, drawn as caravan routes (D-002).

Adapted from usaciv's build/trade.py (Karpathy, MIT), which draws freight between FAF zones. Galicia has no open freight
origin-destination data, so a route is people moving: MITMA's trips of one working day (interim `mitma_movilidad`),
estimated from mobile phones. The JSON keeps the shape of the original; what changed:

* values are trips, so `value_musd`/`tons_k` are gone: `trips`, `trips_ab`, `trips_ba`, `km`;
* MITMA gives no transport mode or commodity: `modes`, `top_mode` and `top_commodity` are null, and `purposes`
  holds the share of trips by the activity at the destination;
* a zone is a comarca (`mitma` lists its MITMA zones), `partners` are [comarca, trips, null].

MITMA joins small concellos into one zone; a zone that crosses a comarca border counts in the comarca holding most
of its population (build() prints how many cross). Each route has a `path` of neighbouring cells along the road
links of infrastructure.json: a drawing aid, not data.
"""

from __future__ import annotations

import heapq
import json
import math
from collections import defaultdict
from pathlib import Path

from ..core.hexgrid import HexGrid
from ..core.paths import WEB_DATA
from ..core.store import load_interim, load_interim_payload, write_web
from .galicia import comarca_tables, concello_info
from .placing import Placer

REQUIRES = ["_world", "mitma_movilidad", "ige_comarcas", "ine_padron", "ign_limites", "cities.json",
            "infrastructure.json"]
PRODUCES = ["trade.json"]

TOP_N = 30
MIN_KM = 5.0  # two anchors closer than this would draw a stub arc
PARTNERS = 5
# Path costs per hex step: autovía, main road, rail only, cross-country land, water.
STEP_COST = {"autovia": 1.0, "via_rapida": 1.4, "rail": 1.8, "land": 4.0, "water": 10.0}
PURPOSES = [("trabajo_estudio", "Trabajo o estudio"), ("casa", "Vuelta a casa"),
            ("frecuente", "Otro destino frecuente"), ("no_frecuente", "Destino ocasional")]
SPANISH_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
                  "noviembre", "diciembre"]
ATTRIBUTION = "Basado en datos abiertos MITMA"
ATTRIBUTION_URL = "https://www.transportes.gob.es/ministerio/proyectos-singulares/estudios-de-movilidad-con-big-data/opendata-movilidad"
PATH_NOTE = ("MITMA dice dónde empieza y dónde acaba cada viaje, no por dónde pasa: el arco entre las dos comarcas "
             "es una ayuda de dibujo.")


def day_text(date: str) -> str:
    y, m, d = (int(v) for v in date.split("-"))
    return f"{d} de {SPANISH_MONTHS[m - 1]} de {y}"


def rule_text(date: str) -> str:
    return (f"Los {TOP_N} pares de comarcas con más viajes entre sí en un solo día laborable, el {day_text(date)} "
            f"(los dos sentidos sumados; fuera los pares con cabeceras a menos de {MIN_KM:g} km). No es una media "
            "del año. MITMA estima con teléfonos móviles los viajes de más "
            "de 500 m de los residentes en España; las distancias son en línea recta. Cada zona de MITMA, que agrupa "
            "los concellos pequeños, cuenta en la comarca que tiene más población suya.")


# ------------------------------------------------------------------ zones


def zone_comarcas(zones: list[dict], concello_comarca: dict, pop: dict) -> tuple[dict, list[str]]:
    """({MITMA zone id: comarca code}, ids of the zones whose concellos belong to more than one comarca)."""
    of, crossing = {}, []
    for z in zones:
        votes = defaultdict(float)
        for g in z["concellos"]:
            votes[concello_comarca[g]] += pop.get(g, 0)
        of[z["id"]] = max(votes, key=lambda k: (votes[k], k))
        if len(votes) > 1:
            crossing.append(z["id"])
    return of, crossing


def aggregate(flows: list, comarca_of: dict) -> tuple[dict, dict]:
    """(pairs, totals): pairs {(a, b) with a < b: {ab, ba, km, purposes}}; totals per comarca
    {within, other_zones, inbound, outbound} where the last two are trips from and to outside Galicia."""
    pairs = defaultdict(lambda: {"ab": 0.0, "ba": 0.0, "km": 0.0, "purposes": defaultdict(float)})
    totals = defaultdict(lambda: {"within": 0.0, "other_zones": 0.0, "inbound": 0.0, "outbound": 0.0})
    for o, d, trips, trips_km, purposes in flows:
        a, b = comarca_of.get(o), comarca_of.get(d)
        if a is None and b is None:
            continue
        if a is None:
            totals[b]["inbound"] += trips
        elif b is None:
            totals[a]["outbound"] += trips
        elif a == b:
            totals[a]["within"] += trips
        else:
            totals[a]["other_zones"] += trips
            totals[b]["other_zones"] += trips
            key = (a, b) if a < b else (b, a)
            rec = pairs[key]
            rec["ab" if a == key[0] else "ba"] += trips
            rec["km"] += trips_km
            for k, v in purposes.items():
                rec["purposes"][k] += v
    return pairs, totals


# ------------------------------------------------------------------ paths


def road_graph(infra: dict | None) -> dict:
    cost = {}
    if not infra:
        return cost
    classes = [c["id"] for c in infra.get("road_classes", [])]
    for a, b, *_ in infra.get("rail", []):
        cost[(a, b)] = STEP_COST["rail"]
    for a, b, cls, *_ in infra.get("roads", []):
        cost[(a, b)] = min(cost.get((a, b), 99), STEP_COST[classes[cls]])
    return cost


def shortest_path(grid: HexGrid, owner: list, links: dict, src: int, dst: int) -> list[int]:
    """Cheapest chain of neighbouring cells from src to dst (Dijkstra with an A* bound)."""
    def h(c):
        x0, y0 = grid.center(*grid.col_row(c))
        x1, y1 = grid.center(*grid.col_row(dst))
        return math.hypot(x1 - x0, y1 - y0) / (math.sqrt(3) * grid.radius) * STEP_COST["autovia"]

    best = {src: 0.0}
    prev = {}
    heap = [(h(src), 0.0, src)]
    while heap:
        _, d, c = heapq.heappop(heap)
        if c == dst:
            break
        if d > best.get(c, math.inf):
            continue
        for n in grid.neighbours(c):
            key = (c, n) if c < n else (n, c)
            step = links.get(key)
            if step is None:
                step = STEP_COST["land"] if owner[n] >= 0 else STEP_COST["water"]
            nd = d + step
            if nd < best.get(n, math.inf):
                best[n] = nd
                prev[n] = c
                heapq.heappush(heap, (nd + h(n), nd, n))
    if dst not in best:
        return [src, dst] if src == dst else []
    path = [dst]
    while path[-1] != src:
        path.append(prev[path[-1]])
    return path[::-1]


# ------------------------------------------------------------------ build


def build() -> None:
    place = Placer()
    grid, owner = place.grid, place.owner
    payload = load_interim_payload("mitma_movilidad")
    data = payload["data"]
    pop = load_interim("ine_padron")["by_concello"]
    comarcas, concello_comarca = comarca_tables()
    cities = json.loads((WEB_DATA / "cities.json").read_text(encoding="utf-8"))  # population order
    info = concello_info()
    ipath = WEB_DATA / "infrastructure.json"
    infra = json.loads(ipath.read_text(encoding="utf-8")) if ipath.exists() else None

    comarca_of, crossing = zone_comarcas(data["zones"], concello_comarca, pop)
    pairs, totals = aggregate(data["flows"], comarca_of)

    zones = {}
    for code, c in sorted(comarcas.items()):
        members = [g for g, k in concello_comarca.items() if k == code]
        own_cities = [x for x in cities if x["id"] in members]
        if own_cities:
            lead = own_cities[0]
            anchor = {"cell": lead["cell"], "x": lead["x"], "y": lead["y"], "city": lead["id"]}
        else:
            lead = info[max(members, key=lambda g: pop.get(g, 0))]
            at = place.place(lead["lon"], lead["lat"])
            anchor = at and {"cell": at["cell"], "x": at["x"], "y": at["y"], "city": None}
        zones[code] = {"id": code, "mitma": sorted(z for z, k in comarca_of.items() if k == code), "name": c["name"],
                       "short": c["name"], "kind": "comarca", "states": [c["abbr"]],
                       "cities": [x["id"] for x in own_cities], "counties": len(members), "anchor": anchor}

    partner = defaultdict(list)
    cands = []
    for (a, b), rec in pairs.items():
        trips = rec["ab"] + rec["ba"]
        partner[a].append([b, round(trips), None])
        partner[b].append([a, round(trips), None])
        za, zb = zones[a]["anchor"], zones[b]["anchor"]
        if not za or not zb or za["cell"] == zb["cell"]:
            continue
        dist = math.dist((za["x"], za["y"]), (zb["x"], zb["y"]))
        if dist >= MIN_KM:
            cands.append((trips, dist, a, b, rec))
    cands.sort(key=lambda t: (-t[0], t[2], t[3]))
    for code, z in zones.items():
        z["partners"] = sorted(partner[code], key=lambda p: (-p[1], p[0]))[:PARTNERS]
        z["totals_trips"] = {k: round(v) for k, v in totals[code].items()}

    links = road_graph(infra)
    routes = []
    for rank, (trips, dist, a, b, rec) in enumerate(cands[:TOP_N], 1):
        total_p = sum(rec["purposes"].values()) or 1
        routes.append({
            "a": a, "b": b, "rank": rank,
            "trips": round(trips), "trips_ab": round(rec["ab"]), "trips_ba": round(rec["ba"]),
            "km": round(rec["km"] / trips, 1),
            "modes": None, "top_mode": None, "top_commodity": None,
            "purposes": {k: round(rec["purposes"].get(k, 0) / total_p, 4) for k, _ in PURPOSES},
            "dist_km": round(dist),
            "path": shortest_path(grid, owner, links, zones[a]["anchor"]["cell"], zones[b]["anchor"]["cell"]),
        })

    split = {k: round(v[0]) for k, v in data["split"].items()}
    doc = {
        "version": 1,
        "vintage": payload["vintage"],
        "year": int(data["date"][:4]),
        "date": data["date"],
        "date_text": day_text(data["date"]),
        "sources": ["mitma_movilidad"],
        "rule": rule_text(data["date"]),
        "path_note": PATH_NOTE,
        "attribution": {"text": ATTRIBUTION, "url": ATTRIBUTION_URL},
        "units": {"trips": "viajes en el día", "km": "km por viaje, en línea recta"},
        "modes": [],
        "commodities": {},
        "purposes": [{"id": k, "name": n} for k, n in PURPOSES],
        "national_trips": {"galicia": round(data["galicia_total_trips"]), **split},
        "zones": sorted(zones.values(), key=lambda z: z["id"]),
        "routes": routes,
    }
    write_web("trade.json", doc)
    inter = sum(r["ab"] + r["ba"] for r in pairs.values())
    shown = sum(r["trips"] for r in routes)
    print(f"    {len(data['zones'])} MITMA zones → {len(zones)} comarcas ({len(crossing)} zones cross a comarca border); "
          f"{inter:,.0f} trips between comarcas, {len(routes)} routes hold {shown / inter:.0%} of them; "
          f"top: {zones[routes[0]['a']]['name']} – {zones[routes[0]['b']]['name']} {routes[0]['trips']:,}")


# ------------------------------------------------------------------ check


def check(web_dir: Path) -> list[tuple[str, str]]:
    path = Path(web_dir) / "trade.json"
    if not path.exists():
        return [("NOTE", "trade.json not built (optional; run: build trade --deps)")]
    out = []
    doc = json.loads(path.read_text(encoding="utf-8"))
    for k in ("version", "vintage", "year", "date", "sources", "rule", "attribution", "zones", "routes"):
        if k not in doc:
            out.append(("FAIL", f"trade.json lacks '{k}'"))
    if out:
        return out
    if doc["version"] != 1:
        out.append(("FAIL", f"trade.json version {doc['version']!r} (expected 1)"))
    wpath = Path(web_dir) / "world.json"
    world = json.loads(wpath.read_text(encoding="utf-8")) if wpath.exists() else None
    grid = (HexGrid(world["grid"]["radius"], world["grid"]["cols"], world["grid"]["rows"])
            if world and "grid" in world else None)
    owner = (world or {}).get("owner") or []
    cpath = Path(web_dir) / "cities.json"
    city_ids = {c["id"] for c in json.loads(cpath.read_text(encoding="utf-8"))} if cpath.exists() else None

    zones, probs = {}, []
    for z in doc["zones"]:
        lacking = [k for k in ("id", "mitma", "name", "short", "kind", "states", "cities", "anchor") if k not in z]
        if lacking:
            probs.append(f"zone {z.get('id')} lacks {lacking}")
            continue
        zones[z["id"]] = z
        a = z["anchor"]
        if a is not None and grid is not None:
            c = a.get("cell")
            if not isinstance(c, int) or not 0 <= c < grid.size or (owner and owner[c] < 0):
                probs.append(f"zone {z['id']} anchor cell {c!r} is not Galician land")
        if city_ids is not None and any(c not in city_ids for c in z["cities"]):
            probs.append(f"zone {z['id']} lists unknown cities")
    if len(zones) != len(doc["zones"]):
        probs.append("duplicate zone ids")
    if probs or not zones:
        out.append(("FAIL", f"trade.json zones: {len(probs)} problems, e.g. {probs[:3]}"))
    else:
        out.append(("PASS", f"trade.json zones: {len(zones)} comarcas, "
                            f"{sum(1 for z in zones.values() if z['anchor'])} anchored"))

    probs, ranks, pairs = [], [], set()
    for r in doc["routes"]:
        a, b = zones.get(r.get("a")), zones.get(r.get("b"))
        if a is None or b is None or a is b:
            probs.append(f"route {r.get('rank')}: unknown or repeated zone")
            continue
        pairs.add(tuple(sorted((r["a"], r["b"]))))
        ranks.append(r.get("rank"))
        for k in ("trips", "trips_ab", "trips_ba", "km", "dist_km"):
            if not isinstance(r.get(k), (int, float)) or r[k] < 0:
                probs.append(f"route {r['rank']}: {k} {r.get(k)!r}")
        if all(isinstance(r.get(k), (int, float)) for k in ("trips", "trips_ab", "trips_ba")):
            if r["trips"] <= 0 or abs(r["trips"] - r["trips_ab"] - r["trips_ba"]) > 1:
                probs.append(f"route {r['rank']}: trips {r['trips']} != both directions")
        shares = list((r.get("purposes") or {}).values())
        if shares and abs(sum(shares) - 1) > 0.01:
            probs.append(f"route {r['rank']}: purpose shares sum to {sum(shares):.3f}")
        p = r.get("path")
        if grid is not None:
            if not p or (a["anchor"] and p[0] != a["anchor"]["cell"]) or (b["anchor"] and p[-1] != b["anchor"]["cell"]):
                probs.append(f"route {r['rank']}: path does not join the anchors")
            elif any(v not in grid.neighbours(u) for u, v in zip(p, p[1:])):
                probs.append(f"route {r['rank']}: path steps are not neighbours")
    if ranks != list(range(1, len(ranks) + 1)):
        probs.append("ranks are not 1..N in order")
    vals = [r["trips"] for r in doc["routes"] if isinstance(r.get("trips"), (int, float))]
    if vals != sorted(vals, reverse=True):
        probs.append("routes are not sorted by trips")
    if len(pairs) != len(doc["routes"]):
        probs.append("duplicate zone pairs")
    if probs or not doc["routes"]:
        out.append(("FAIL", f"trade.json routes: {len(probs)} problems, e.g. {probs[:3]}"))
    else:
        top = doc["routes"][0]
        out.append(("PASS", f"trade.json routes: {len(doc['routes'])} routes, {sum(vals):,} trips on {doc['date']}; "
                            f"#1 {zones[top['a']]['short']} – {zones[top['b']]['short']} {top['trips']:,}"))
    size = path.stat().st_size
    if size > 300_000:
        out.append(("WARN", f"trade.json is {size / 1e3:.0f} kB (eager files should stay under ~300 kB)"))
    return out
