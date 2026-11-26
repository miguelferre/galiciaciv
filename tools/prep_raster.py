"""Prepare the relief and land-cover rasters for the galiciaciv `world` builder (needs rasterio + numpy).

    uv run --with rasterio --with numpy python tools/prep_raster.py

The pipeline itself is stdlib-only, so the rasters are decimated here to small JSON files that the sources
`mdt_ign` and `worldcover` (pipeline/sources/) read in process():

* data/raw/mdt_ign/relief_grid.json     {x0, dx, y0, dy, rows: [[alt, ...], ...]}: a lon/lat grid, one value per
    MDT pixel (~0.15 x 0.20 km, about 85 per 1 km hex). Land: IGN MDT (WCS Elevacion4258_200, 200 m).
    Where the MDT is 0 (sea, Portugal: the MDT only covers Spain, and its sea cells are 0, not nodata) and north
    of its coverage, NOAA ETOPO1 (ERDDAP, ~1.8 km) fills in, interpolated to the same pixels: sea depth and the
    Portuguese land. Both parts have the same density, so a coast hex weighs sea and land by area.
* data/raw/worldcover/cover_grid.json   the shape of the old `nlcd` interim, but in lon/lat degrees (EPSG:4326):
    ESA WorldCover 2021 v200 read from S3 as COGs through /vsicurl/ (overviews, no full download),
    nearest-neighbour at ~0.2 km, reclassified to the NLCD codes world.py already understands (MAPPING).
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[1]
MDT_DIR = ROOT / "data" / "raw" / "mdt_ign"
WC_DIR = ROOT / "data" / "raw" / "worldcover"
# Window that covers the map rectangle (Galicia + 25 km margin, plus slack for the conic's rotation).
LON0, LON1, LAT0, LAT1 = -10.2, -5.8, 41.3, 44.2
MDT_LAT1 = 43.9  # the MDT 200 m coverage ends at 43.93 N
MDT_URL = (
    "https://servicios.idee.es/wcs-inspire/mdt?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=Elevacion4258_200"
    f"&subset=long({LON0},{LON1})&subset=lat({LAT0},{MDT_LAT1})&format=image/tiff"
)
ETOPO_URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.csv"
    f"?altitude%5B({LAT0}):1:({LAT1})%5D%5B({LON0}):1:({LON1})%5D"
)

WC_BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
# 3-degree tiles named by their SW corner; Galicia needs these four (all verified to exist, 2026-11-26).
WC_TILES = {"N42W009": (-9, 42), "N42W012": (-12, 42), "N39W009": (-9, 39), "N39W012": (-12, 39)}
# Cover grid step: ~0.2 km (0.00245 deg of longitude and 0.0018 deg of latitude at 42.8 N).
DX, DY = 0.00245, 0.0018
# WorldCover class -> NLCD code (world.py's COVER/GROUPS/PCT tables use the NLCD codes).
MAPPING = {
    10: 43,  # Tree cover -> mixed forest (WorldCover does not tell oak from eucalyptus or pine)
    20: 52,  # Shrubland -> shrub/scrub (matorral, tojo)
    30: 81,  # Grassland -> pasture/hay (in Galicia it is mostly managed meadow, prados; not NLCD's wild grassland)
    40: 82,  # Cropland -> cultivated crops
    50: 23,  # Built-up -> developed, medium intensity
    60: 31,  # Bare / sparse vegetation -> barren
    70: 12,  # Snow and ice
    80: 11,  # Permanent water bodies (ignored by world.py)
    90: 90,  # Herbaceous wetland -> wetlands
    95: 95,  # Mangroves (none in Galicia)
    100: 71,  # Moss and lichen -> grassland (none in Galicia)
}
LEGEND = {0: ".", 11: "w", 12: "i", 23: "m", 31: "b", 43: "x", 52: "s", 71: "g", 81: "p", 82: "c", 90: "f", 95: "v"}


def download(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print("  GET", url[:110])
        req = urllib.request.Request(url, headers={"User-Agent": "galiciaciv/0.1 (open data pipeline)"})
        with urllib.request.urlopen(req, timeout=300) as r:
            path.write_bytes(r.read())
    return path


def relief() -> None:
    tif = download(MDT_URL, MDT_DIR / "mdt200_galicia.tif")
    etopo = download(ETOPO_URL, MDT_DIR / "etopo1_galicia.csv")
    with rasterio.open(tif) as ds:
        a = ds.read(1)
        t = ds.transform
    north = math.ceil((LAT1 - t.f) / -t.e)  # rows of the same pixel size north of the MDT coverage
    rows, cols = np.arange(-north, a.shape[0]), np.arange(a.shape[1])
    lats, lons = t.f + (rows + 0.5) * t.e, t.c + (cols + 0.5) * t.a
    alt = np.zeros((len(rows), len(cols)), dtype=np.int32)
    alt[north:] = a
    mdt = alt != 0
    # ETOPO1 on its own grid, interpolated (bilinear) to the same pixels
    table = np.loadtxt(etopo, delimiter=",", skiprows=2)
    elat, elon = np.unique(table[:, 0]), np.unique(table[:, 1])
    z = np.full((len(elat), len(elon)), np.nan)
    z[np.searchsorted(elat, table[:, 0]), np.searchsorted(elon, table[:, 1])] = table[:, 2]
    assert not np.isnan(z).any(), "the ETOPO1 CSV is not a full grid"
    by_row = np.array([np.interp(lons, elon, line) for line in z])
    fill = np.array([np.interp(lats, elat, by_row[:, j]) for j in range(len(lons))]).T
    alt = np.where(mdt, alt, np.rint(fill).astype(np.int32))
    n_mdt = int(mdt.sum())
    out = {"vintage": "IGN MDT 200 m (land, Spain) + ETOPO1 (sea, Portugal) interpolated to the MDT pixels (~0.15 x 0.20 km)",
           "n_mdt": n_mdt, "n_etopo": int(alt.size) - n_mdt, "x0": float(lons[0]), "dx": float(t.a),
           "y0": float(lats[0]), "dy": float(t.e), "cols": len(lons), "rows_n": len(lats), "rows": alt.tolist()}
    (MDT_DIR / "relief_grid.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"relief: {n_mdt} MDT pixels + {alt.size - n_mdt} filled from ETOPO1; alt {alt.min()}..{alt.max()}")


def cover() -> None:
    cols = math.ceil((LON1 - LON0) / DX)
    rows = math.ceil((LAT1 - LAT0) / DY)
    x0, y0 = LON0 + DX / 2, LAT1 - DY / 2  # pixel centre of column 0 / row 0 (rows go south)
    grid = np.zeros((rows, cols), dtype=np.uint8)
    lut = np.zeros(256, dtype=np.uint8)
    for k, v in MAPPING.items():
        lut[k] = v
    for tile, (tlon, tlat) in WC_TILES.items():
        # output pixels whose centre falls in the tile
        c0, c1 = max(0, math.ceil((tlon - x0) / DX)), min(cols, math.floor((tlon + 3 - x0) / DX) + 1)
        r0, r1 = max(0, math.ceil((y0 - (tlat + 3)) / DY)), min(rows, math.floor((y0 - tlat) / DY) + 1)
        if c0 >= c1 or r0 >= r1:
            continue
        url = "/vsicurl/" + WC_BASE.format(t=tile)
        with rasterio.open(url) as ds:
            # window of the tile that spans those output pixels (pixel edges), read decimated to (r1-r0, c1-c0)
            left, right = x0 + (c0 - 0.5) * DX, x0 + (c1 - 0.5) * DX
            top, bottom = y0 - (r0 - 0.5) * DY, y0 - (r1 - 0.5) * DY
            win = Window(
                (left - ds.transform.c) / ds.transform.a, (top - ds.transform.f) / ds.transform.e,
                (right - left) / ds.transform.a, (top - bottom) / -ds.transform.e,
            )
            data = ds.read(1, window=win, out_shape=(r1 - r0, c1 - c0), resampling=rasterio.enums.Resampling.nearest)
        grid[r0:r1, c0:c1] = lut[data]
        print(f"cover tile {tile}: rows {r0}-{r1}, cols {c0}-{c1}")
    # sea outside any tile data is 0 already ("no data"); water (80) -> 11
    chars = np.array([LEGEND.get(i, ".") for i in range(256)])
    text = ["".join(chars[g]) for g in grid]
    out = {"vintage": "ESA WorldCover 2021 v200 (10 m), nearest neighbour to ~0.2 km", "crs": "EPSG:4326",
           "x0": x0, "dx": DX, "y0": y0, "dy": -DY, "cols": cols, "rows_n": rows,
           "legend": {ch: code for code, ch in LEGEND.items()}, "mapping": {str(k): v for k, v in MAPPING.items()},
           "rows": text}
    WC_DIR.mkdir(parents=True, exist_ok=True)
    (WC_DIR / "cover_grid.json").write_text(json.dumps(out, separators=(",", ":")))
    u, n = np.unique(grid, return_counts=True)
    print("cover codes:", {int(a): int(b) for a, b in zip(u, n)})


if __name__ == "__main__":
    which = sys.argv[1:] or ["relief", "cover"]
    if "relief" in which:
        relief()
    if "cover" in which:
        cover()
