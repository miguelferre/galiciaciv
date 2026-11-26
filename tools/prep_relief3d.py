"""Prepare the fine mesh of the 3D relief view: web/data/relief3d_detalle.bin (needs rasterio + numpy).

    PYTHONUTF8=1 uv run --with rasterio --with numpy python tools/prep_relief3d.py [--radius 0.5] [--force]
        [--world web/data/world.json] [--out web/data/relief3d_detalle.bin]

A hex grid of its own, independent of the game grid, in the same map km as web/data/world.json (its `projection`).
Run it again whenever world.json changes (grid or projection): the file records which game grid it was made for.

Inputs
* web/data/world.json            projection, map size and game grid (for the "containing game cell" of each fine cell)
* data/raw/mdt_ign/              MDT 200 m (IGN, WCS) and ETOPO1 (NOAA): already fetched by tools/prep_raster.py
* ESA WorldCover 2021 v200       read from S3 as COGs through /vsicurl/ (overviews, no full download) at ~100 m and
                                 cached in data/raw/relief3d/wc_100m.npz (--force reads it again)
* data/interim/osm_rios.json     OpenStreetMap rivers (pipeline source osm_rios), simplified much less than in
                                 world.json, so they follow the valleys of the fine mesh

Each hex is sampled on a 100 m lattice. Water = more than half of the samples are WorldCover water (class 80) or have
no data over an MDT of 0. Water joined to the open sea at sea level is sea (height 0, depth from ETOPO1); the rest is
a lake or reservoir, at its MDT height. Land takes the mean altitude of its land samples (MDT; ETOPO1 where the MDT is
0, which covers Portugal) and the most frequent WorldCover class.

Output (little-endian)
    4 bytes   "R3D1"
    uint32    length L of the header; the header is padded so that the arrays start at a multiple of 4
    L bytes   JSON header (UTF-8): grid {radius, cols, rows} (pointy-top, odd-r, same layout as web/js/hex.js),
              count, game {grid, projection, width, height}, rivers [{name, rank, pts: [x, y, ...]}], sources, date
    int16 n   elev    m. Land: mean altitude (>= 0). Sea: depth (<= 0). Lake: surface altitude
    uint16 n  parent  index of the game cell holding the centre (65535 = outside the game grid)
    uint8 n   cover   WorldCover class of land (10..100); 80 = sea, 81 = lake or reservoir
"""

from __future__ import annotations

import argparse
import datetime
import json
import math
import struct
import sys
from collections import deque
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.build.world import clip_polyline, join_lines  # noqa: E402  (read only)
from pipeline.core.geo import MapProjection  # noqa: E402
from pipeline.core.hexgrid import SQRT3, HexGrid  # noqa: E402

OUT = ROOT / "web" / "data" / "relief3d_detalle.bin"
MDT = ROOT / "data" / "raw" / "mdt_ign" / "mdt200_galicia.tif"
ETOPO = ROOT / "data" / "raw" / "mdt_ign" / "etopo1_galicia.csv"
WC_CACHE = ROOT / "data" / "raw" / "relief3d" / "wc_100m.npz"
RIVERS = ROOT / "data" / "interim" / "osm_rios.json"

# Same window as tools/prep_raster.py.
LON0, LON1, LAT0, LAT1 = -10.2, -5.8, 41.3, 44.2
WC_BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
WC_TILES = {"N42W009": (-9, 42), "N42W012": (-12, 42), "N39W009": (-9, 39), "N39W012": (-12, 39)}
WC_DX, WC_DY = 0.00122, 0.0009  # ~100 m at 42.8 N
CLASSES = (10, 20, 30, 40, 50, 60, 70, 90, 95, 100)  # land classes of WorldCover
WATER_CLASS, LAKE_CLASS = 80, 81
STEP_KM = 0.1  # sampling lattice inside each hex
SEA_SURFACE_M = 3  # water joined to the open sea counts as sea while the MDT stays at or below this
OPEN_SEA_M = -10  # ETOPO depth that seeds the flood fill of the sea
COAST_ALT_M = 20  # ETOPO altitude above which water without MDT is inland, not coast
RIVER_TOLERANCE_KM = 0.15
NONE = 65535


def worldcover(force: bool) -> tuple[np.ndarray, float, float]:
    """(classes [rows, cols], lon of column 0, lat of row 0): pixel centres, rows going south."""
    cols = math.ceil((LON1 - LON0) / WC_DX)
    rows = math.ceil((LAT1 - LAT0) / WC_DY)
    x0, y0 = LON0 + WC_DX / 2, LAT1 - WC_DY / 2
    if WC_CACHE.exists() and not force:
        grid = np.load(WC_CACHE)["classes"]
        if grid.shape == (rows, cols):
            print(f"worldcover: cached {WC_CACHE.relative_to(ROOT)}")
            return grid, x0, y0
    grid = np.zeros((rows, cols), dtype=np.uint8)
    for tile, (tlon, tlat) in WC_TILES.items():
        c0, c1 = max(0, math.ceil((tlon - x0) / WC_DX)), min(cols, math.floor((tlon + 3 - x0) / WC_DX) + 1)
        r0, r1 = max(0, math.ceil((y0 - (tlat + 3)) / WC_DY)), min(rows, math.floor((y0 - tlat) / WC_DY) + 1)
        if c0 >= c1 or r0 >= r1:
            continue
        with rasterio.open("/vsicurl/" + WC_BASE.format(t=tile)) as ds:
            left, right = x0 + (c0 - 0.5) * WC_DX, x0 + (c1 - 0.5) * WC_DX
            top, bottom = y0 - (r0 - 0.5) * WC_DY, y0 - (r1 - 0.5) * WC_DY
            win = Window(
                (left - ds.transform.c) / ds.transform.a, (top - ds.transform.f) / ds.transform.e,
                (right - left) / ds.transform.a, (top - bottom) / -ds.transform.e,
            )
            data = ds.read(1, window=win, out_shape=(r1 - r0, c1 - c0), resampling=rasterio.enums.Resampling.nearest,
                           boundless=True, fill_value=0)
        grid[r0:r1, c0:c1] = data
        print(f"worldcover tile {tile}: rows {r0}-{r1}, cols {c0}-{c1}", flush=True)
    WC_CACHE.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(WC_CACHE, classes=grid)
    return grid, x0, y0


def etopo_grid() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    data = np.loadtxt(ETOPO, delimiter=",", skiprows=2)
    lats, li = np.unique(data[:, 0], return_inverse=True)
    lons, ki = np.unique(data[:, 1], return_inverse=True)
    grid = np.zeros((len(lats), len(lons)), dtype=np.float32)
    grid[li, ki] = data[:, 2]
    return grid, lats, lons


def bilinear(grid, lats, lons, lat, lon):
    fy = np.clip((lat - lats[0]) / (lats[1] - lats[0]), 0, len(lats) - 1.001)
    fx = np.clip((lon - lons[0]) / (lons[1] - lons[0]), 0, len(lons) - 1.001)
    r, c = fy.astype(np.int32), fx.astype(np.int32)
    ty, tx = (fy - r).astype(np.float32), (fx - c).astype(np.float32)
    return (grid[r, c] * (1 - ty) * (1 - tx) + grid[r, c + 1] * (1 - ty) * tx
            + grid[r + 1, c] * ty * (1 - tx) + grid[r + 1, c + 1] * ty * tx)


def lattice(radius: float) -> np.ndarray:
    n = int(radius // STEP_KM) + 1
    pts = [((ix + 0.5) * STEP_KM, (iy + 0.5) * STEP_KM) for iy in range(-n, n) for ix in range(-n, n)]
    return np.array([(x, y) for x, y in pts if abs(x) <= SQRT3 / 2 * radius and abs(y) <= radius - abs(x) / SQRT3])


def inverse(proj: MapProjection, x: np.ndarray, y: np.ndarray):
    """MapProjection.inverse (spherical Albers) over arrays; checked against it in main()."""
    a = proj._albers
    px = x + proj.min_x - proj.margin
    dy = a.rho0 - (proj.max_y + proj.margin - y)
    rho = np.hypot(px, dy)
    theta = np.arctan2(px, dy)
    s = (a.c - (rho * a.n / 6371.0088) ** 2) / (2 * a.n)
    return np.degrees(a.lon0 + theta / a.n), np.degrees(np.arcsin(np.clip(s, -1, 1)))


def rdp(pts: list, tol: float) -> list:
    """Douglas-Peucker without recursion."""
    if len(pts) < 3:
        return pts
    a = np.array(pts)
    keep = np.zeros(len(a), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        seg = a[j] - a[i]
        rel = a[i + 1:j] - a[i]
        length = math.hypot(*seg)
        d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / length if length > 1e-9 else np.hypot(rel[:, 0], rel[:, 1])
        k = int(np.argmax(d))
        if d[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return [pts[k] for k in np.flatnonzero(keep)]


def rivers(proj: MapProjection, width: float, height: float) -> list[dict]:
    if not RIVERS.exists():
        print("rivers: data/interim/osm_rios.json missing; the viewer will use world.json's rivers")
        return []
    out = []
    for r in json.loads(RIVERS.read_text(encoding="utf-8"))["data"]["rivers"]:
        parts = []
        for way in r["lines"]:
            parts.extend(clip_polyline([proj(lon, lat) for lon, lat in way], width, height))
        for piece in join_lines(parts):
            if sum(math.dist(a, b) for a, b in zip(piece, piece[1:])) < 1.0:
                continue
            pts = rdp(piece, RIVER_TOLERANCE_KM)
            out.append({"name": r["name"], "rank": r["rank"], "pts": [round(v, 2) for p in pts for v in p]})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--radius", type=float, default=0.5, help="hex radius, km")
    ap.add_argument("--force", action="store_true", help="read WorldCover again instead of the cache")
    ap.add_argument("--world", type=Path, default=ROOT / "web" / "data" / "world.json", help="world.json to match")
    ap.add_argument("--out", type=Path, default=OUT, help="file to write")
    args = ap.parse_args()

    world = json.loads(args.world.read_text(encoding="utf-8"))
    p = world["projection"]
    proj = MapProjection(**p)
    width, height = world["width"], world["height"]
    game = HexGrid(**world["grid"])
    grid = HexGrid.covering(width, height, args.radius)
    n = grid.size
    print(f"grid {grid.cols} x {grid.rows} = {n} hexes of {args.radius:g} km (game grid: {game.radius:g} km)")

    for x, y in ((0, 0), (width, height), (31.7, 202.4)):
        lon, lat = inverse(proj, np.array(x, float), np.array(y, float))
        assert max(abs(a - b) for a, b in zip((float(lon), float(lat)), proj.inverse(x, y))) < 1e-9

    wc, wx0, wy0 = worldcover(args.force)
    with rasterio.open(MDT) as ds:
        mdt = ds.read(1)
        t = ds.transform
    sea_grid, lats, lons = etopo_grid()

    cols, rows = np.arange(grid.cols), np.arange(grid.rows)
    cx = (grid.radius * SQRT3 * (cols[None, :] + 0.5 * (rows[:, None] & 1))).ravel()
    cy = np.repeat(1.5 * grid.radius * rows, grid.cols).astype(float)
    off = lattice(grid.radius)
    print(f"{len(off)} sample points per hex")

    water = np.zeros(n, dtype=bool)
    cover = np.zeros(n, dtype=np.uint8)
    land_alt = np.zeros(n, dtype=np.float32)
    surface = np.zeros(n, dtype=np.float32)  # mean MDT of the water samples
    depth = np.zeros(n, dtype=np.float32)  # mean ETOPO of all samples
    for start in range(0, n, 4000):
        end = min(n, start + 4000)
        x = cx[start:end, None] + off[None, :, 0]
        y = cy[start:end, None] + off[None, :, 1]
        lon, lat = inverse(proj, x, y)
        wc_c = np.clip(np.rint((lon - wx0) / WC_DX).astype(np.int64), 0, wc.shape[1] - 1)
        wc_r = np.clip(np.rint((wy0 - lat) / WC_DY).astype(np.int64), 0, wc.shape[0] - 1)
        klass = wc[wc_r, wc_c]
        mc = np.floor((lon - t.c) / t.a).astype(np.int64)
        mr = np.floor((lat - t.f) / t.e).astype(np.int64)
        inside = (mc >= 0) & (mc < mdt.shape[1]) & (mr >= 0) & (mr < mdt.shape[0])
        m = np.where(inside, mdt[np.clip(mr, 0, mdt.shape[0] - 1), np.clip(mc, 0, mdt.shape[1] - 1)], 0).astype(np.float32)
        e = bilinear(sea_grid, lats, lons, lat, lon)
        wet = (klass == WATER_CLASS) | ((klass == 0) & (m <= 0))
        dry = ~wet
        alt = np.where(m != 0, m, np.maximum(e, 0))
        nwet, ndry = wet.sum(1), dry.sum(1)
        water[start:end] = nwet > 0.5 * len(off)
        land_alt[start:end] = np.where(ndry > 0, (alt * dry).sum(1) / np.maximum(ndry, 1), 0)
        surface[start:end] = np.where(nwet > 0, (m * wet).sum(1) / np.maximum(nwet, 1), 0)
        depth[start:end] = e.mean(1)
        counts = np.stack([((klass == c) & dry).sum(1) for c in CLASSES], axis=1)
        cover[start:end] = np.where(counts.max(1) > 0, np.array(CLASSES)[counts.argmax(1)], 30)
        if start % 20000 == 0:
            print(f"  sampled {end}/{n}", flush=True)

    # Sea = water joined to the open sea without leaving sea level; everything else that is wet is a lake.
    sea = np.zeros(n, dtype=bool)
    queue = deque(int(i) for i in np.flatnonzero(water & (depth < OPEN_SEA_M) & (surface <= SEA_SURFACE_M)))
    sea[list(queue)] = True
    while queue:
        for j in grid.neighbours(queue.popleft()):
            if water[j] and not sea[j] and surface[j] <= SEA_SURFACE_M:
                sea[j] = True
                queue.append(j)
    # Wet cells at MDT 0 that the fill could not reach: on a low coast they are still sea (a channel too narrow for this
    # resolution). Inland they are reservoirs outside the MDT (Portugal): lakes, at the level of their lowest shore.
    unreached = water & ~sea & (surface <= 0.5)
    sea |= unreached & (depth <= COAST_ALT_M)
    seen: set[int] = set()
    inland = 0
    for first in np.flatnonzero(unreached & ~sea):
        if int(first) in seen:
            continue
        body, shore, queue = [], [], deque([int(first)])
        seen.add(int(first))
        while queue:
            i = queue.popleft()
            body.append(i)
            for j in grid.neighbours(i):
                if not water[j]:
                    shore.append(float(land_alt[j]))
                elif unreached[j] and not sea[j] and j not in seen:
                    seen.add(j)
                    queue.append(j)
        surface[body] = max(1.0, min(shore) if shore else float(np.median(depth[body])))
        inland += len(body)
    lake = water & ~sea

    elev = np.where(sea, np.minimum(depth, 0), np.where(lake, np.maximum(surface, 1), np.maximum(land_alt, 0)))
    elev = np.rint(elev).astype("<i2")
    cover = np.where(sea, WATER_CLASS, np.where(lake, LAKE_CLASS, cover)).astype(np.uint8)
    parent = np.array([game.cell_at(x, y) for x, y in zip(cx.tolist(), cy.tolist())], dtype=np.int64)
    assert game.size < NONE, "parent no longer fits in 16 bits"
    parent = np.where(parent < 0, NONE, parent).astype("<u2")

    # Registration check: the fine altitudes averaged per game cell must match world.json.
    land = ~water
    owner = np.array(world["owner"])
    mask = land & (parent != NONE)
    total = np.bincount(parent[mask], weights=elev[mask].astype(float), minlength=game.size)
    count = np.bincount(parent[mask], minlength=game.size)
    gal = (owner >= 0) & (count > 0)
    ours, theirs = total[gal] / count[gal], np.array(world["elev"], float)[gal]
    r = float(np.corrcoef(ours, theirs)[0, 1])
    err = float(np.median(np.abs(ours - theirs)))
    print(f"check against world.json: {int(gal.sum())} Galician game cells, r = {r:.4f}, median |diff| = {err:.1f} m")
    assert r > 0.97, "the fine mesh does not line up with world.json"
    for name, lat, lon, expect_water in (("ría de Muros e Noia", 42.765, -8.99, True), ("ría de Arousa", 42.53, -8.91, True),
                                          ("Santiago", 42.88, -8.545, False), ("Ourense", 42.34, -7.865, False)):
        i = grid.cell_at(*proj(lon, lat))
        print(f"  {name}: {'water' if water[i] else 'land'} (elev {elev[i]} m)")
        if water[i] != expect_water:
            print(f"  WARNING: expected {'water' if expect_water else 'land'}")

    lines = rivers(proj, width, height)
    header = {
        "version": 1,
        "date": datetime.date.today().isoformat(),
        "grid": grid.to_dict(),
        "count": n,
        "game": {"grid": world["grid"], "projection": p, "width": width, "height": height},
        "layers": ["elev:int16", "parent:uint16", "cover:uint8"],
        "sources": ["IGN MDT 200 m (CC BY 4.0)", "NOAA ETOPO1", "ESA WorldCover 2021 v200 (CC BY 4.0)",
                    "OpenStreetMap (ODbL)"],
        "rivers": lines,
    }
    text = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    text += b" " * (-(8 + len(text)) % 4)
    args.out.write_bytes(b"R3D1" + struct.pack("<I", len(text)) + text + elev.tobytes() + parent.tobytes() + cover.tobytes())
    print(f"{inland} lake cells without MDT, set at their shore")
    print(f"cells {n}: land {int(land.sum())}, sea {int(sea.sum())}, lake {int(lake.sum())}; "
          f"land elev max {int(elev[land].max())} m; {len(lines)} river pieces, "
          f"{sum(len(l['pts']) for l in lines) // 2} points")
    print(f"{args.out}: {args.out.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
