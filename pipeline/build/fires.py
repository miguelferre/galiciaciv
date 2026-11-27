"""Burned area year by year, 2016-2025: the share of each Galician land hex inside that year's EFFIS perimeters.

One entry per year in `cells`: [[cell, share], ...] with share rounded to 3 decimals, hexes under 0.001 left out. The
perimeters of a year are merged first (union), so a hex burned by two fires of one year counts once. The raster step
and the helpers are the ones lenses.py uses for the all-years lens, so the years add up to it (never above it).
"""

from __future__ import annotations

import json
from pathlib import Path

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.store import load_interim, load_interim_payload, write_web
from .lens_meta import FIRE_YEARS
from .lenses import FIRE_STEP_KM
from .overlay import cell_shares, polygon_spans, union

REQUIRES = ["_world", "effis"]
PRODUCES = ["fires.json"]

MIN_SHARE = 0.001


def build() -> None:
    world = load_interim("_world")
    proj, grid = MapProjection(**world["projection"]), HexGrid(**world["grid"])
    owner = world["owner"]
    payload = load_interim_payload("effis")
    effis = payload["data"]
    by_year, cells = [], []
    for year in FIRE_YEARS:
        fires = [f for f in effis["fires"] if f["year"] == year]
        spans = union(polygon_spans(rings, proj, FIRE_STEP_KM) for f in fires for rings in f["polygons"])
        shares = cell_shares(spans, grid, FIRE_STEP_KM)
        rows = [[c, round(s, 3)] for c, s in sorted(shares.items()) if owner[c] >= 0 and round(s, 3) >= MIN_SHARE]
        by_year.append({"n": len(fires), "ha": round(sum(f["area_ha"] for f in fires)), "cells_touched": len(rows)})
        cells.append(rows)
        print(f"    {year}: {len(fires)} perimeters, {by_year[-1]['ha']} ha, {len(rows)} cells")
    write_web("fires.json", {"version": 1, "vintage": payload.get("vintage", ""), "sources": ["effis"],
                             "years": list(FIRE_YEARS), "by_year": by_year, "cells": cells})


def check(web_dir: Path) -> list[tuple[str, str]]:
    path = Path(web_dir) / "fires.json"
    if not path.exists():
        return [("NOTE", "fires.json not built (optional; run: build fires)")]
    doc = json.loads(path.read_text(encoding="utf-8"))
    for k in ("version", "vintage", "sources", "years", "by_year", "cells"):
        if k not in doc:
            return [("FAIL", f"fires.json lacks '{k}'")]
    probs = []
    if doc["version"] != 1:
        probs.append(f"version {doc['version']!r} (expected 1)")
    n = len(doc["years"])
    if len(doc["by_year"]) != n or len(doc["cells"]) != n:
        probs.append(f"lengths differ: years {n}, by_year {len(doc['by_year'])}, cells {len(doc['cells'])}")
    world = json.loads((Path(web_dir) / "world.json").read_text(encoding="utf-8")) if (Path(web_dir) / "world.json").exists() else None
    size = world["grid"]["cols"] * world["grid"]["rows"] if world and "grid" in world else None
    owner = (world or {}).get("owner") or []
    ref = None
    try:
        ref = load_interim("effis")["by_year"]
    except Exception:  # interim not on disk (a fresh checkout): skip the cross-check
        pass
    for k, (y, by, rows) in enumerate(zip(doc["years"], doc["by_year"], doc["cells"])):
        if by.get("cells_touched") != len(rows):
            probs.append(f"{y}: cells_touched {by.get('cells_touched')} but {len(rows)} rows")
        if len({r[0] for r in rows}) != len(rows):
            probs.append(f"{y}: repeated cells")
        for c, s in rows:
            if not (isinstance(c, int) and (size is None or 0 <= c < size) and (not owner or owner[c] >= 0)):
                probs.append(f"{y}: cell {c!r} is not Galician land")
                break
            if not MIN_SHARE <= s <= 1:
                probs.append(f"{y}: share {s!r} out of range")
                break
        if ref is not None:
            r = ref.get(str(y))
            if not r or r["n"] != by["n"] or round(r["area_ha"]) != by["ha"]:
                probs.append(f"{y}: n/ha differ from the effis interim")
    if probs:
        return [("FAIL", f"fires.json: {len(probs)} problems, e.g. {probs[:3]}")]
    return [("PASS", f"fires.json: {n} years, {sum(len(r) for r in doc['cells'])} cell entries")]
