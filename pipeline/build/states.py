"""States = the 53 comarcas: the same economic profile as a city (sums of their concellos), ranks, a label anchor.

Also land-cover shares over the comarca's hexes. Ranks are among the comarcas (1 = largest).
The label anchor is the comarca's "pole of inaccessibility" on the hex map (the hex farthest from the
border, by hex steps, or one nearly as deep that fits a bigger name), turned along the comarca's long axis
when that helps, and sized to fit the run of the comarca's own hexes through the anchor.
`size` assumes ~0.6 em per character; the viewer should still clamp or hide labels of tiny comarcas.

A comarca's yields are the sum of the concellos that have a value: where the IGE withholds a sector for a
small concello the comarca total is a lower bound. Unemployment (registered, per inhabitant) leaves out
the concellos with a missing unemployment figure from both numerator and denominator. Growth is null.
"""

from __future__ import annotations

import math
from collections import deque

from ..core.hexgrid import HexGrid
from ..core.store import load_interim, write_web
from .cities import clean_paro
from .galicia import comarca_tables
from .yields import YIELDS, branch_affiliates, economy, mean_income

REQUIRES = ["_world", "ige_comarcas", "ine_padron", "ige_pib", "ige_afiliacion", "ige_paro", "ine_adrh", "ige_ramas"]
PRODUCES = ["states.json"]

MIN_LABEL_KM, MAX_LABEL_KM = 14.0, 110.0  # suggested font height range, map km


def label_anchor(grid: HexGrid, owner: list[int], s: int, name: str) -> dict | None:
    """{x, y, angle, size} for state index `s`, or None if it owns no hex (e.g. DC).

    angle: degrees, clockwise on screen (y down), in (-90, 90]. size: suggested font height in map km.
    """
    cells = [i for i, o in enumerate(owner) if o == s]
    if not cells:
        return None
    # Multi-source BFS from the border hexes inward.
    dist = {}
    queue = deque()
    for c in cells:
        nb = grid.neighbours(c)
        if len(nb) < 6 or any(owner[n] != s for n in nb):
            dist[c] = 0
            queue.append(c)
    while queue:
        c = queue.popleft()
        for n in grid.neighbours(c):
            if owner[n] == s and n not in dist:
                dist[n] = dist[c] + 1
                queue.append(n)
    pts = {c: grid.center(*grid.col_row(c)) for c in cells}
    mx = sum(p[0] for p in pts.values()) / len(cells)
    my = sum(p[1] for p in pts.values()) / len(cells)

    # Principal axis of the hex centres. Labels stay horizontal unless tilting them
    # along a clearly elongated state (at most 45°) allows a much bigger name.
    sxx = sum((p[0] - mx) ** 2 for p in pts.values())
    syy = sum((p[1] - my) ** 2 for p in pts.values())
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts.values())
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)  # (-90°, 90°], clockwise on screen
    angles = [0.0] + ([theta] if 1 <= abs(math.degrees(theta)) <= 45 else [])
    step = grid.radius / 4

    def reach(x: float, y: float, ux: float, uy: float) -> float:
        """Distance (km) from (x, y) along (ux, uy) before leaving the state's hexes."""
        t = 0.0
        while True:
            c = grid.cell_at(x + (t + step) * ux, y + (t + step) * uy)
            if c < 0 or owner[c] != s:
                return t + step / 2
            t += step

    def fit(c: int, t: float) -> float:
        """Font height (km) for a label centred on hex c at angle t: ~0.6 em per character
        over 90% of the local run through c, and no taller than 80% of the local breadth.
        The run is then re-measured along the label's top and bottom edges (twice), so the
        whole box, not just its centre line, stays inside the state."""
        (x, y), ux, uy = pts[c], math.cos(t), math.sin(t)
        across = 2 * min(reach(x, y, -uy, ux), reach(x, y, uy, -ux))
        h, offsets = 0.8 * across, [0.0]
        for _ in range(3):
            along = min(
                2 * min(reach(x - o * uy, y + o * ux, ux, uy), reach(x - o * uy, y + o * ux, -ux, -uy))
                for o in offsets
            )
            h = min(h, 0.9 * along / (0.6 * max(len(name), 4)))
            offsets = [0.0, h / 2, -h / 2]
        return h

    # Candidates: the pole of inaccessibility and hexes nearly as deep; pick the one (and angle)
    # that fits the biggest label, a tilted label only if it is 25% bigger than a flat one.
    far = max(dist.values())
    best = None
    for c in cells:
        if dist[c] < far - 1:
            continue
        for t in angles:
            size = fit(c, t) / (1.25 if t else 1.0)
            score = (round(size), -math.hypot(pts[c][0] - mx, pts[c][1] - my))
            if best is None or score > best[0]:
                best = (score, c, t, size * (1.25 if t else 1.0))
    _, pole, angle, size = best
    px, py = pts[pole]
    return {
        "x": round(px, 1),
        "y": round(py, 1),
        "angle": round(math.degrees(angle), 1),
        "size": round(max(MIN_LABEL_KM, min(MAX_LABEL_KM, size)), 1),
    }


PCT_KEYS = ["forest", "crop", "pasture", "grass", "shrub", "wetland", "developed"]


def land_shares(world: dict, s: int) -> dict | None:
    """Mean world `pct` (0..100) over the state's cells with land-cover samples, as 0..1 fractions."""
    pct, cover, owner = world.get("pct"), world.get("cover"), world["owner"]
    if not pct or not cover:
        return None
    cells = [i for i, o in enumerate(owner) if o == s and cover[i]]
    if not cells:
        return None
    return {k: round(sum(pct[k][i] for i in cells) / len(cells) / 100, 3) for k in PCT_KEYS}


def build() -> None:
    world = load_interim("_world")
    pop = load_interim("ine_padron")["by_concello"]
    pib = load_interim("ige_pib")["by_concello"]
    aff = load_interim("ige_afiliacion")["by_concello"]
    paro = load_interim("ige_paro")
    renta = load_interim("ine_adrh")["by_concello"]
    ramas = load_interim("ige_ramas")["by_concello"]
    comarcas, comarca_of = comarca_tables()
    grid, owner = HexGrid(**world["grid"]), world["owner"]
    members: dict[str, list[str]] = {}
    for g in world["counties"]:
        members.setdefault(comarca_of[g], []).append(g)

    states = []
    for i, fips in enumerate(world["states"]):
        com = comarcas[fips]
        gs = members[fips]
        sector = {k: sum(aff[g][k] for g in gs if aff.get(g, {}).get(k) is not None)
                  for k in ("agro", "industria", "construcion", "servizos", "total")}
        # a comarca with no value at all for a sector would be 0: use None when every concello lacks it
        for k in sector:
            if not any(aff.get(g, {}).get(k) is not None for g in gs):
                sector[k] = None
        p_all = sum(pop[g] for g in gs)
        with_paro = [g for g in gs if clean_paro(paro, g) is not None]
        paro_sum = sum(clean_paro(paro, g) for g in with_paro) if with_paro else None
        per = [branch_affiliates(aff.get(g), ramas.get(g)) for g in gs]
        branch = {k: (sum(b[k] for b in per if b[k] is not None) if any(b[k] is not None for b in per) else None)
                  for k in ("science", "culture")}  # a lower bound where a concello lacks a value
        econ = economy(p_all, sector, sum(pib[g] for g in gs), paro_sum, income=mean_income(gs, pop, renta),
                       branch=branch)
        if with_paro and len(with_paro) < len(gs):  # unemployment over the concellos that have it
            econ["unemployment"] = round(paro_sum / sum(pop[g] for g in with_paro), 4)
        states.append({
            "fips": fips, "abbr": com["abbr"], "name": com["name"], "province": com["province"],
            **econ, "growth": None, "growth_years": None, "ranks": {},
            "label": label_anchor(grid, owner, i, com["name"]),
            "land": land_shares(world, i),
        })
    for y in YIELDS:
        key = y["key"]
        ranked = sorted((s for s in states if s["yields"][key] is not None), key=lambda s: -s["yields"][key])
        for r, s in enumerate(ranked, 1):
            s["ranks"][key] = r
        for s in states:
            s["ranks"].setdefault(key, None)
    write_web("states.json", states)
    no_label = [s["abbr"] for s in states if not s["label"]]
    print(f"    {len(states)} comarcas" + (f"; no label anchor: {', '.join(no_label)}" if no_label else ""))
