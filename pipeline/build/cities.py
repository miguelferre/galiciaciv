"""Cities = concellos with MIN_POP inhabitants or more (padron INE 2025), plus nation.json.

Each city keeps its position x, y (centroid of its concello, IGN límites) and gets one land cell of
Galicia for its banner: the most built-up part of its concello (see place_city). With 1 km hexes the
centroid is often fields or hills, kilometres from the town. Growth is null: the pilot has no population series
(IGE 589 has the years, a second fetch would be needed). A city is one concello, so `counties` has
one id, and `states` holds the fips of its comarca (the viewer's key).
"""

from __future__ import annotations

import math

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.store import load_interim, load_interim_payload, write_web
from .galicia import JOB_LABELS, comarca_tables, concello_info
from .yields import GDP_YEAR, YIELDS, branch_affiliates, economy, industries, mean_income

REQUIRES = ["_world", "ign_limites", "ige_comarcas", "ine_padron", "ige_pib", "ige_afiliacion", "ige_paro", "ine_adrh", "ige_ramas"]
PRODUCES = ["cities.json", "nation.json"]

MIN_POP = 10_000
CAPITAL = "15078"  # Santiago de Compostela
FOOTPRINT_MAJORITY = 4  # of a cell's 7 county samples
PEERS = 5
RANK_KEYS = ["population", "gdp", "gdp_per_capita", "growth"] + [y["key"] for y in YIELDS]


def ring_search(grid: HexGrid, start: int, max_rings: int):
    """Yield (ring, cell) for every cell within `max_rings` steps of `start`, nearest rings first."""
    seen = {start}
    frontier = [start]
    yield 0, start
    for ring in range(1, max_rings + 1):
        nxt = []
        for c in frontier:
            for n in grid.neighbours(c):
                if n not in seen:
                    seen.add(n)
                    nxt.append(n)
                    yield ring, n
        frontier = nxt


def nearest_land(grid: HexGrid, owner: list[int], cell: int, x: float, y: float, state: int, max_km=35.0):
    """Nearest Galician land cell (owner >= 0) to (x, y), preferring `state`: first ring with land, plus one more."""
    found_ring = None
    best = None
    for ring, c in ring_search(grid, cell, math.ceil(max_km / (math.sqrt(3) * grid.radius))):
        if found_ring is not None and ring > found_ring + 1:
            break
        if owner[c] < 0:
            continue
        found_ring = ring if found_ring is None else found_ring
        cx, cy = grid.center(*grid.col_row(c))
        score = (owner[c] != state, math.hypot(cx - x, cy - y))
        if best is None or score < best[0]:
            best = (score, c)
    return best[1] if best else -1


def place_city(grid: HexGrid, owner: list[int], county: list[int], taken: set, x: float, y: float,
               concello: int, comarca: int, built: list[int] | None = None) -> int:
    """The banner cell of a city whose centroid is (x, y), or -1 if Galicia has no free cell.

    Only Galician land cells count (owner >= 0: never water, never foreign land) that no other city
    holds. Order of preference:
    1. a cell of the city's own concello (county index): the one at the heart of its built-up land (`built` =
       percent built-up per cell; the cell's value plus the mean of its six neighbours in the concello), then the
       nearest to (x, y), which alone decides without `built`;
    then, by distance from (x, y) to the cell centre:
    2. a cell of its comarca (concellos with no cell of their own, or all of them taken);
    3. any free Galician land cell.
    """
    def town(c: int) -> float:
        if built is None:
            return 0.0
        return built[c] + sum(built[n] for n in grid.neighbours(c) if county[n] == concello) / 6

    tiers: list[tuple[tuple[float, float], int]] = [((math.inf, math.inf), -1)] * 3
    for c, o in enumerate(owner):
        if o < 0 or c in taken:
            continue
        cx, cy = grid.center(*grid.col_row(c))
        d = math.hypot(cx - x, cy - y)
        t = 0 if county[c] == concello else 1 if o == comarca else 2
        score = (-town(c) if t == 0 else 0.0, d)
        if score < tiers[t][0]:
            tiers[t] = (score, c)
    for _, c in tiers:
        if c >= 0:
            return c
    return -1


def footprints(world: dict, concello_of_city: dict[str, int]) -> dict[str, set[int]]:
    """City id -> Galician cells where at least FOOTPRINT_MAJORITY of the 7 samples fall in its concello."""
    idx_city = {k: cid for cid, k in concello_of_city.items()}
    out: dict[str, set[int]] = {}
    for cell, s in enumerate(world["county_samples"]):
        if not s or world["owner"][cell] < 0:
            continue
        votes: dict[str, int] = {}
        for k in s:
            cid = idx_city.get(k)
            if cid:
                votes[cid] = votes.get(cid, 0) + 1
        for cid, n in votes.items():
            if n >= FOOTPRINT_MAJORITY:
                out.setdefault(cid, set()).add(cell)
    return out


def add_ranks(cities: list[dict]) -> None:
    """ranks: 1 = highest among all cities, null where the value is null (cities are sorted by population,
    so ties keep population order). peers: the PEERS cities closest in population (by ratio)."""
    def value(c, key):
        if key == "gdp_per_capita":
            return c["gdp"] / c["population"] if c.get("gdp") is not None and c.get("population") else None
        if key in ("population", "gdp", "growth"):
            return c.get(key)
        return c["yields"].get(key)

    for c in cities:
        c["ranks"] = {}
    for key in RANK_KEYS:
        have = [c for c in cities if value(c, key) is not None]
        have.sort(key=lambda c: -value(c, key))  # stable: ties stay in population order
        for r, c in enumerate(have, 1):
            c["ranks"][key] = r
        for c in cities:
            c["ranks"].setdefault(key, None)
    for i, c in enumerate(cities):
        lp = math.log(c["population"])
        near = sorted((abs(math.log(o["population"]) - lp), j) for j, o in enumerate(cities) if j != i)
        c["peers"] = [cities[j]["id"] for _, j in near[:PEERS]]


def clean_paro(paro: dict, geoid: str):
    """Registered unemployment total of a concello; None where the IGE gives 0 for a merged concello."""
    if geoid in set(paro.get("zero_total_concellos") or []):
        return None
    return (paro["by_concello"].get(geoid) or {}).get("total")


def build() -> None:
    world = load_interim("_world")
    pad = load_interim_payload("ine_padron")
    pop = pad["data"]["by_concello"]
    pib_p, aff_p, paro_p = (load_interim_payload(n) for n in ("ige_pib", "ige_afiliacion", "ige_paro"))
    pib, aff, paro = pib_p["data"], aff_p["data"], paro_p["data"]
    renta = load_interim("ine_adrh")["by_concello"]
    ramas = load_interim("ige_ramas")
    info = concello_info()
    comarcas, comarca_of = comarca_tables()
    proj = MapProjection(**world["projection"])
    grid, owner, county = HexGrid(**world["grid"]), world["owner"], world["county"]
    state_idx = {fips: i for i, fips in enumerate(world["states"])}
    concello_idx = {g: k for k, g in enumerate(world["counties"])}

    cities = []
    for geoid, p in pop.items():
        if p < MIN_POP or geoid not in info:
            continue
        i = info[geoid]
        x, y = proj(i["lon"], i["lat"])
        com = comarca_of[geoid]
        cities.append({
            "id": geoid, "name": i["name"], "full": f"{i['name']}, {i['province']}",
            "states": [com], "metro": True, "capital": geoid == CAPITAL,
            "x": round(x, 1), "y": round(y, 1), "cell": -1,
            **economy(p, aff["by_concello"].get(geoid), pib["by_concello"].get(geoid), clean_paro(paro, geoid),
                      income=mean_income([geoid], pop, renta),
                      branch=branch_affiliates(aff["by_concello"].get(geoid), ramas["by_concello"].get(geoid))),
            "growth": None, "growth_years": None,
            "counties": [geoid], "pop_series": None,
        })
    cities.sort(key=lambda c: -c["population"])

    taken: set[int] = set()
    off_own = []
    for c in cities:
        k, s = concello_idx[c["id"]], state_idx.get(c["states"][0], -1)
        cell = place_city(grid, owner, county, taken, c["x"], c["y"], k, s, world["pct"]["developed"])
        if cell < 0:
            raise RuntimeError(f"no free Galician land cell for {c['name']}")
        if county[cell] != k:
            off_own.append(c["name"])
        taken.add(cell)
        c["cell"] = cell

    feet = footprints(world, {c["id"]: concello_idx[c["id"]] for c in cities})
    for c in cities:
        c["footprint"] = sorted(feet.get(c["id"], set()) | {c["cell"]})
    add_ranks(cities)

    capitals = [c["name"] for c in cities if c["capital"]]
    print(f"    {len(cities)} cities (>= {MIN_POP:,} inhabitants); capital: {capitals}")
    no_city = [com["name"] for code, com in comarcas.items()
               if code in state_idx and not any(code in c["states"] for c in cities)]
    print(f"    {len(no_city)} comarcas without a city (no extra city added): {', '.join(no_city[:6])} ...")
    if off_own:
        print(f"    {len(off_own)} cities placed on a cell of a neighbouring concello: {', '.join(off_own)}")

    nat_aff = aff["galicia_total"]
    nation = economy(pad["data"]["galicia_total"], nat_aff, pib["galicia_total"], paro["galicia_total"]["total"],
                     income=mean_income(list(pop), pop, renta),
                     branch=branch_affiliates(nat_aff, ramas["galicia"]))
    nation["growth"], nation["growth_years"] = None, None
    write_web("cities.json", cities)
    write_web(
        "nation.json",
        {
            "name": "Galicia",
            "currency": "EUR",
            "vintage": f"{pad['vintage']}; {aff_p['vintage']}; {paro_p['vintage']}; {load_interim_payload('ine_adrh')['vintage']}; {load_interim_payload('ige_ramas')['vintage']}",
            "year": pad["data"]["year"],
            "gdp_vintage": pib_p["vintage"],
            "nation": nation,
            "yields": YIELDS,
            "industries": industries(),
            "gdp_industries": {},
        },
    )
