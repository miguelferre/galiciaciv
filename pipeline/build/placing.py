"""Helper of the map-layer builders (no build(): not a builder): lon/lat → map km and hex cell.

A site stands on the Galician land hex at its point, or on the nearest one up to about SITE_KM away (ports and
rías), whatever the hex radius of the grid. x/y stay the true position. `county` is the concello that holds the true
point (IGN outlines; for a point just offshore, the nearest one within SHORE_KM), else the concello of the cell's
centre. `cbsa` is the id of the cities.json city of that concello (a Galician city is its concello) and `state` its
comarca's abbreviation.
"""

from __future__ import annotations

import json
import math

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.paths import WEB_DATA
from ..core.store import load_interim
from .galicia import comarca_tables

SHORE_KM = 3.0  # a harbour point in the water belongs to the concello this close to it
SITE_KM = 8.5  # how far a port, an airport or a monument may be from its land hex
NEAR_KM = 4.0  # the same for the many small items (turbines, quarries)


def rings_for(grid: HexGrid, km: float) -> int:
    """Hex rings that cover `km` (neighbour centres are sqrt(3) radii apart)."""
    return max(1, math.ceil(km / (math.sqrt(3) * grid.radius)))


def inside(pt: tuple[float, float], ring: list) -> bool:
    """Even-odd test of a point against one ring."""
    x, y = pt
    hit = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def _segment_km(p, a, b) -> float:
    """Distance from p to the segment a-b, all in a local km frame."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) if l2 else 0.0
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


class Placer:
    def __init__(self, world: dict | None = None):
        world = world or load_interim("_world")
        self.world = world
        self.proj = MapProjection(**world["projection"])
        self.grid = HexGrid(**world["grid"])
        self.owner, self.county, self.geoids = world["owner"], world["county"], world["counties"]
        comarcas, concello_comarca = comarca_tables()
        self.abbrs = [comarcas[code]["abbr"] for code in world["states"]]
        self.abbr_of_concello = {g: comarcas[code]["abbr"] for g, code in concello_comarca.items()}
        self.outlines = [(c["geoid"], c["rings"]) for c in load_interim("ign_limites")["counties"]]
        self.city_ids = {c["id"] for c in json.loads((WEB_DATA / "cities.json").read_text(encoding="utf-8"))}

    def land_cell(self, x: float, y: float, km: float = SITE_KM) -> int:
        """The Galician land cell at x/y, else the nearest in the first ring (up to about `km`) holding one, or -1."""
        grid, owner = self.grid, self.owner
        rings = rings_for(grid, km)
        cell = grid.cell_at(x, y)
        if cell < 0:
            return -1
        if owner[cell] >= 0:
            return cell
        seen, frontier = {cell}, [cell]
        for _ in range(rings):
            ring = list(dict.fromkeys(n for c in frontier for n in grid.neighbours(c) if n not in seen))
            seen.update(ring)
            land = [n for n in ring if owner[n] >= 0]
            if land:
                return min(land, key=lambda n: math.dist(grid.center(*grid.col_row(n)), (x, y)))
            frontier = ring
        return -1

    def concello_at(self, lon: float, lat: float) -> str | None:
        """The concello holding a point, or the nearest one within SHORE_KM of it; None farther out."""
        for geoid, rings in self.outlines:
            if sum(inside((lon, lat), r) for r in rings) % 2:
                return geoid
        kx, ky = 111.32 * math.cos(math.radians(lat)), 110.57
        best, best_km = None, SHORE_KM
        for geoid, rings in self.outlines:
            for r in rings:
                if min(abs(q[0] - lon) for q in r) * kx > 20 or min(abs(q[1] - lat) for q in r) * ky > 20:
                    continue
                local = [((q[0] - lon) * kx, (q[1] - lat) * ky) for q in r]
                km = min(_segment_km((0.0, 0.0), a, b) for a, b in zip(local, local[1:] + local[:1]))
                if km < best_km:
                    best, best_km = geoid, km
        return best

    def tags(self, cell: int, concello: str | None = None) -> dict:
        """county, cbsa and state of a site on a land cell; `concello` (where the site truly is) wins over the
        concello of the cell's centre."""
        ci = self.county[cell]
        geoid = concello or (self.geoids[ci] if ci >= 0 else None)
        return {"county": geoid, "cbsa": geoid if geoid in self.city_ids else None,
                "state": self.abbr_of_concello.get(geoid) or self.abbrs[self.owner[cell]]}

    def place(self, lon: float, lat: float, km: float = SITE_KM) -> dict | None:
        """{x, y, cell, county, cbsa, state} of a point, or None if no Galician land is near it."""
        if lon is None or lat is None:
            return None
        x, y = self.proj(lon, lat)
        cell = self.land_cell(x, y, km)
        if cell < 0:
            return None
        return {"x": round(x, 1), "y": round(y, 1), "cell": cell, **self.tags(cell, self.concello_at(lon, lat))}
