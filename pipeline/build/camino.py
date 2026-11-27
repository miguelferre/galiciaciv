"""Caminos de Santiago: líneas del mapa y km por concello (IGN-CNIG, datos de la FEAACS).

Método, en cuatro pasos:
1. Cada etapa se proyecta al plano del mapa (km) y se trocea en piezas de como mucho PIECE_KM. La pieza se queda si su
   punto medio cae dentro de un concello de Galicia (contornos de ign_limites); el resto (Portugal, Asturias, León, mar) se
   descarta. Por eso `km_galicia` cuenta solo tierra gallega.
2. Dos Caminos comparten tramo cuando sus piezas están a menos de SHARE_KM una de otra (rejilla de SHARE_KM, mirando
   también las ocho casillas vecinas). El Francés, el Norte y la Vía de la Plata acaban en los mismos km, por ejemplo.
3. Km por concello: cada pieza pesa su longitud entre el número de Caminos que pasan por ahí, así que un tramo compartido
   se cuenta una vez en el total. La pieza se asigna al concello de su punto medio (contorno municipal, no la casilla
   del mapa). `km_galicia` de cada Camino es su longitud entera, también en los tramos compartidos.
4. Líneas: se recorren las piezas de cada etapa y se agrupan las consecutivas con el mismo conjunto de Caminos. Un tramo
   compartido lo dibuja solo el Camino de id más bajo y lleva en `routes` a todos. Las líneas se unen y se simplifican a
   LINE_KM.

Es dibujo de ayuda a la marcha, no el trazado legal (aviso del CNIG).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from ..core.geo import MapProjection, Shape, ShapeIndex
from ..core.store import load_interim, load_interim_payload, write_web
from .world import join_lines, simplify

REQUIRES = ["_world", "ign_limites", "ign_camino"]
PRODUCES = ["camino.json"]

PIECE_KM = 0.1
SHARE_KM = 0.15
LINE_KM = 0.25
ATTRIBUTION = "Caminos de Santiago: CC-BY 4.0 FEAACS, vía IGN-CNIG"
SHORT = {"ES01c": "Camino Francés", "ES02a": "Camino Portugués", "ES03a": "Camino del Norte",
         "ES04a": "Vía de la Plata", "ES05a": "Camino Primitivo", "ES06a": "Camino Inglés",
         "ES07a": "Fisterra y Muxía", "ES11a": "Camino Olvidado", "ES17a": "Camino de Invierno",
         "ES18a": "Portugués de la Costa", "ES40a": "Mar de Arousa y Ulla", "ES40b": "Variante Espiritual"}
COLORS = {"ES01c": "#f2c14e", "ES02a": "#ff8a5c", "ES03a": "#5cc8ff", "ES04a": "#d98cf5", "ES05a": "#ff6b8b",
          "ES06a": "#9be564", "ES07a": "#f5f1e6", "ES11a": "#c9a27a", "ES17a": "#4de0c4", "ES18a": "#ffb3d1",
          "ES40a": "#8fa8ff", "ES40b": "#e6e65c"}
FALLBACK = "#ffffff"


def _pieces(pts, locate):
    """Pieces (ax, ay, bx, by, length, county) of a projected line; county -1 outside Galicia."""
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        if d == 0:
            continue
        n = max(1, math.ceil(d / PIECE_KM))
        for j in range(n):
            ax, ay = x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n
            bx, by = x0 + (x1 - x0) * (j + 1) / n, y0 + (y1 - y0) * (j + 1) / n
            out.append((ax, ay, bx, by, d / n, locate((ax + bx) / 2, (ay + by) / 2)))
    return out


def build() -> None:
    world = load_interim("_world")
    lau = load_interim("ign_limites")
    src = load_interim("ign_camino")
    payload = load_interim_payload("ign_camino")
    proj = MapProjection(**world["projection"])
    by_geoid = {c["geoid"]: c for c in lau["counties"]}
    geoids = list(world["counties"])
    idx = ShapeIndex([Shape([[proj(lon, lat) for lon, lat in r] for r in by_geoid[g]["rings"]]) for g in geoids], cell_km=20)

    stages, names = [], {}  # (route, pieces) per stage line
    for st in src["stages"]:
        names.setdefault(st["camino"], st["camino_name"])
        for line in st["lines"]:
            stages.append((st["camino"], _pieces([proj(lon, lat) for lon, lat in line], idx.locate)))

    def key(x, y):
        return int(x // SHARE_KM), int(y // SHARE_KM)

    grid = defaultdict(set)  # routes with a piece in each square
    for r, ps in stages:
        for ax, ay, bx, by, _, c in ps:
            if c >= 0:
                grid[key((ax + bx) / 2, (ay + by) / 2)].add(r)

    def sig(r, x, y):
        gx, gy = key(x, y)
        s = {r}
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                s |= grid.get((gx + i, gy + j), set())
        return tuple(sorted(s))

    km_route = defaultdict(float)
    cnt_km = defaultdict(float)
    cnt_routes = defaultdict(set)
    owned = defaultdict(list)  # signature -> runs drawn by the lowest route of the signature
    for r, ps in stages:
        cur, cur_sig = [], None

        def flush():
            if len(cur) >= 2 and cur_sig and cur_sig[0] == r:
                owned[cur_sig].append(cur)

        for ax, ay, bx, by, d, c in ps:
            if c < 0:
                flush()
                cur, cur_sig = [], None
                continue
            s = sig(r, (ax + bx) / 2, (ay + by) / 2)
            km_route[r] += d
            g = geoids[c]
            cnt_km[g] += d / len(s)
            cnt_routes[g].add(r)
            if s != cur_sig:
                flush()
                cur, cur_sig = [(ax, ay)], s
            cur.append((bx, by))
        flush()

    lines = []
    for s in sorted(owned):
        for piece in join_lines(owned[s]):
            pts = simplify(piece, LINE_KM)
            if len(pts) >= 2:
                lines.append({"routes": list(s), "pts": [round(v, 2) for p in pts for v in p]})

    routes = [{"id": r, "name": SHORT.get(r, names.get(r, r)), "full_name": names.get(r, r),
               "color": COLORS.get(r, FALLBACK), "km_galicia": round(km_route[r], 1)} for r in sorted(km_route)]
    by_concello = {g: {"km": round(cnt_km[g], 1), "routes": sorted(cnt_routes[g])}
                   for g in sorted(cnt_km) if round(cnt_km[g], 1) > 0}
    total = round(sum(cnt_km.values()), 1)
    write_web("camino.json", {
        "version": 1,
        "vintage": payload.get("vintage") or "IGN-CNIG, Caminos de Santiago (FEAACS)",
        "sources": ["ign_camino"],
        "attribution": ATTRIBUTION,
        "rule": "Km dentro de tierra gallega, medidos sobre el trazado del IGN en piezas de 100 m y asignados al concello "
                "por su contorno municipal. Un tramo que comparten varios Caminos cuenta una vez en el total y en cada "
                "concello; el km de cada Camino cuenta su recorrido entero. Es ayuda a la marcha, no el trazado legal.",
        "total_km": total,
        "routes": routes,
        "lines": lines,
        "by_concello": by_concello,
    })
    print(f"    {len(routes)} Caminos, {sum(r['km_galicia'] for r in routes):.0f} km sumados, {total:.0f} km sin repetir, "
          f"{len(by_concello)} concellos, {len(lines)} líneas")


def check(web_dir: Path) -> list[tuple[str, str]]:
    path = Path(web_dir) / "camino.json"
    if not path.exists():
        return [("NOTE", "camino.json not built (optional; run: build camino --deps)")]
    doc = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for k in ("version", "vintage", "sources", "attribution", "rule", "total_km", "routes", "lines", "by_concello"):
        if k not in doc:
            out.append(("FAIL", f"camino.json lacks '{k}'"))
    if out:
        return out
    if doc["version"] != 1:
        out.append(("FAIL", f"camino.json version {doc['version']!r} (expected 1)"))
    ids = {r["id"] for r in doc["routes"]}
    if not ids:
        out.append(("FAIL", "camino.json has no routes"))
    for r in doc["routes"]:
        if any(k not in r for k in ("id", "name", "color", "km_galicia")) or not r["km_galicia"] > 0:
            out.append(("FAIL", f"camino.json route {r.get('id')} is incomplete or has no km"))
    bad = [i for i, l in enumerate(doc["lines"])
           if not l["routes"] or not set(l["routes"]) <= ids or len(l["pts"]) < 4 or len(l["pts"]) % 2]
    if bad:
        out.append(("FAIL", f"camino.json lines with bad routes or points: {bad[:5]}"))
    world = Path(web_dir) / "world.json"
    if world.exists():
        w = json.loads(world.read_text(encoding="utf-8"))
        geoids = {c["geoid"] for c in w["counties"]}
        unknown = [g for g in doc["by_concello"] if g not in geoids]
        if unknown:
            out.append(("FAIL", f"camino.json by_concello has unknown concellos {unknown[:5]}"))
        xs = [v for l in doc["lines"] for v in l["pts"][0::2]]
        ys = [v for l in doc["lines"] for v in l["pts"][1::2]]
        if xs and (min(xs) < 0 or max(xs) > w["width"] or min(ys) < 0 or max(ys) > w["height"]):
            out.append(("FAIL", "camino.json lines fall outside the map"))
    bc = [v for v in doc["by_concello"].values() if not v["routes"] or not set(v["routes"]) <= ids or v["km"] <= 0]
    if bc:
        out.append(("FAIL", f"camino.json by_concello has {len(bc)} bad entries"))
    sm = round(sum(v["km"] for v in doc["by_concello"].values()), 1)
    if abs(sm - doc["total_km"]) > 1.0:
        out.append(("FAIL", f"camino.json by_concello km sum {sm} differs from total_km {doc['total_km']}"))
    return out or [("PASS", f"camino.json: {len(ids)} routes, {len(doc['lines'])} lines, {len(doc['by_concello'])} concellos")]
