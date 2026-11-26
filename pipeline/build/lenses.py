"""Lenses = per-hex map overlays for Galicia.

Each Galician hex is sampled at 7 points (see world.py). A concello's population is spread over the
hexes in proportion to how many of all its sample points fall in each hex, so every concello's people
are counted exactly once. A concello that no sample hits (A Illa de Arousa) is added in full to the
hex nearest its centroid. Concellos with no hex of their own (Mugardos, Burela, O Grove...) still
count through the samples that fall in neighbouring hexes. Density = people / the hex's land area;
the other concello lenses are the mean of the concellos in the hex, weighted by those people.
Climate lenses are interpolated from the stations (climate.py), not from concellos.
"""

from __future__ import annotations

import json
import math
from collections import Counter

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.paths import WEB_DATA
from ..core.store import load_interim, load_interim_payload, write_web
from .cities import clean_paro, nearest_land
from .climate import idw, idw_temperature
from .galicia import concello_info
from .lens_meta import (CLIMATE_FIELDS, CLIMATE_LENSES, CONCELLO_LENSES, DOMAIN_NOTE, ELEVATION, FIRE_YEARS,
                        GROUPS, LAND_LENSES, RISK_LENSES)
from .overlay import cell_shares, polygon_spans, union

REQUIRES = ["_world", "world.json", "ign_limites", "ine_padron", "ige_pib", "ige_afiliacion", "ige_paro",
            "meteogalicia", "ine_adrh", "ige_poboacion", "ige_censo", "effis", "snczi"]
PRODUCES = ["lenses.json"]


def nice(v: float, up: bool) -> float:
    """v rounded outward (up or down) to 2 significant digits."""
    if v == 0:
        return 0
    mag = 10 ** (math.floor(math.log10(abs(v))) - 1)
    return round((math.ceil if up else math.floor)(v / mag) * mag, 10)


def percentile_domain(values: list, log: bool) -> list[float] | None:
    """[2nd, 98th] percentile of the non-null hex values, rounded outward; positive values only on a log scale."""
    vals = sorted(v for v in values if v is not None and (v > 0 or not log))
    if not vals:
        return None
    lo, hi = vals[int(0.02 * (len(vals) - 1))], vals[int(0.98 * (len(vals) - 1))]
    lo, hi = nice(lo, False), nice(hi, True)
    return [lo, hi] if hi > lo else [lo, nice(vals[-1], True)]


def concello_metrics(geoids: list[str]) -> list[dict]:
    """Per concello (same order as geoids): pop plus the values behind the concello lenses (None = missing)."""
    pop = load_interim("ine_padron")["by_concello"]
    pib = load_interim("ige_pib")["by_concello"]
    aff = load_interim("ige_afiliacion")["by_concello"]
    paro = load_interim("ige_paro")
    renta = load_interim("ine_adrh")["by_concello"]
    pobo = load_interim("ige_poboacion")["by_concello"]
    censo = load_interim("ige_censo")["by_concello"]
    out = []
    for g in geoids:
        p, a = pop.get(g), aff.get(g) or {}
        tot = a.get("total")
        pr = clean_paro(paro, g)
        r, po, ce = renta.get(g) or {}, pobo.get(g) or {}, censo.get(g) or {}
        out.append({
            "renta_pc": r.get("net_income_pc"), "gini": r.get("gini"), "p80p20": r.get("p80p20"),
            "edad_media": po.get("mean_age"), "nacidos_fuera": po.get("born_outside_galicia_share"),
            "estudios_superiores": ce.get("higher_share"),
            "geoid": g, "pop": p,
            "gdp": pib.get(g),
            "gdp_pc": pib[g] / p if p and pib.get(g) is not None else None,
            "unemployment": pr / p * 100 if p and pr is not None else None,
            "agro_share": a["agro"] / tot if tot and a.get("agro") is not None else None,
            "industry_share": a["industria"] / tot if tot and a.get("industria") is not None else None,
        })
    return out


def spread(weights, cvals: list, digits: int) -> list:
    """Population-weighted mean of the concello values over each hex's parts (None where no part has a value)."""
    out = [None] * len(weights)
    for i, parts in enumerate(weights):
        vals = [(cvals[k], p) for k, p in parts if cvals[k] is not None]
        wsum = sum(p for _, p in vals)
        if wsum:
            out[i] = round(sum(v * p for v, p in vals) / wsum, digits)
    return out


def climate_values(world, proj, grid, elev, stations, var):
    """Per-cell IDW at the centres of Galician land cells. Only temperature gets an elevation correction;
    the station field and rounding come from CLIMATE_FIELDS, and pct lenses (humidity) are divided by 100."""
    owner = world["owner"]
    field, digits = CLIMATE_FIELDS[var]
    pct = CLIMATE_LENSES[var]["format"] == "pct"
    if var == "temp":
        pts = [(*proj(s["lon"], s["lat"]), s["altitude"], s[field]) for s in stations
               if s.get(field) is not None and s.get("altitude") is not None]
    else:
        pts = [(*proj(s["lon"], s["lat"]), s[field] / 100 if pct else s[field]) for s in stations
               if s.get(field) is not None]
    out = [None] * grid.size
    for i in range(grid.size):
        if owner[i] < 0:
            continue
        x, y = grid.center(*grid.col_row(i))
        v = idw_temperature(x, y, elev[i], pts) if var == "temp" else idw(x, y, pts)
        out[i] = None if v is None else (round(v) if digits == 0 else round(v, digits))
    return out, len(pts)


FIRE_STEP_KM = 0.05  # raster step of the burned-area overlay (one hex = about 6 500 samples)
FLOOD_STEP_KM = 0.025  # finer for the narrow flood strips along rivers


def risk_values(world, proj, grid) -> dict[str, list]:
    """Burned share 2016-2025 (union of all perimeters), year of the biggest fire per cell, flood share T=100."""
    owner = world["owner"]
    galician = [o >= 0 for o in owner]
    fires = load_interim("effis")["fires"]
    fire_spans, biggest = [], {}
    for f in fires:
        spans = union(polygon_spans(rings, proj, FIRE_STEP_KM) for rings in f["polygons"])
        fire_spans.append(spans)
        for cell in cell_shares(spans, grid, FIRE_STEP_KM):
            if galician[cell] and (cell not in biggest or f["area_ha"] > biggest[cell][0]):
                biggest[cell] = (f["area_ha"], f["year"])
    burned = cell_shares(union(fire_spans), grid, FIRE_STEP_KM)
    flood_polys = load_interim("snczi")["polygons"]
    flooded = cell_shares(union(polygon_spans(rings, proj, FLOOD_STEP_KM) for rings in flood_polys),
                          grid, FLOOD_STEP_KM)
    year_idx = {y: k for k, y in enumerate(FIRE_YEARS)}
    return {
        "incendios": [round(burned.get(i, 0.0), 4) if g else None for i, g in enumerate(galician)],
        "incendio_anyo": [year_idx[biggest[i][1]] if g and i in biggest else None for i, g in enumerate(galician)],
        "inundacion": [round(flooded.get(i, 0.0), 4) if g else None for i, g in enumerate(galician)],
    }


def build() -> None:
    world = load_interim("_world")
    elev = json.loads((WEB_DATA / "world.json").read_text(encoding="utf-8"))["elev"]
    proj, grid = MapProjection(**world["projection"]), HexGrid(**world["grid"])
    owner, samples = world["owner"], world["county_samples"]
    hex_area = 1.5 * math.sqrt(3) * grid.radius**2
    info = concello_info()
    county = concello_metrics(world["counties"])
    total_hits = Counter(k for s in samples for k in s if k >= 0)

    small_by_cell: dict[int, list[int]] = {}  # concellos no sample hits: whole population on the nearest cell
    for k, c in enumerate(county):
        if total_hits[k] or c["pop"] is None:
            continue
        i = info[c["geoid"]]
        x, y = proj(i["lon"], i["lat"])
        cell = nearest_land(grid, owner, max(grid.cell_at(x, y), 0), x, y, -1)
        if cell >= 0:
            small_by_cell.setdefault(cell, []).append(k)
            print(f"    {i['name']}: no sample hits it, placed on cell {cell}")

    weights: list[list[tuple[int, float]]] = [[] for _ in range(grid.size)]
    density: list = [None] * grid.size
    for i, s in enumerate(samples):
        if not s:
            continue
        parts = [(k, county[k]["pop"] * hits / total_hits[k]) for k, hits in Counter(x for x in s if x >= 0).items()
                 if county[k]["pop"] is not None]
        parts += [(k, county[k]["pop"]) for k in small_by_cell.get(i, [])]
        land = sum(1 for x in s if x >= 0) or 1
        weights[i] = parts
        if parts:
            people = sum(p for _, p in parts)
            density[i] = round(people / (hex_area * land / len(s)), 2)
    total_pop = sum(c["pop"] for c in county if c["pop"])
    print(f"    population on hexes {sum(p for w in weights for _, p in w):,.0f} of {total_pop:,.0f}")

    lenses = [{
        "id": "density", "group": "people", "name": "Población", "icon": "l-people", "emoji": "👥",
        "unit": "habitantes por km²", "format": "int", "scale": "log", "higher_is": "neutral",
        "ramp": ["#1b1035", "#4b2377", "#9a3b8a", "#e0645e", "#f9b24a", "#fff3a8"], "source": "ine_padron",
        "description": "Habitantes por km² de tierra (padrón del INE a 1 de enero de 2025). La población de cada "
        "concello se reparte entre las casillas que cubre, en proporción a cuánto del concello cae en cada una.",
        "values": density,
    }]
    for lid, meta in CONCELLO_LENSES.items():
        digits = (4 if meta["format"] == "pct" else 1 if lid in ("unemployment", "edad_media", "gini")
                  else 0 if meta["format"] == "eur" else 2)
        lenses.append({"id": lid, **meta, "values": spread(weights, [c[lid] for c in county], digits)})

    stations = load_interim("meteogalicia")["stations"]
    for lid, meta in CLIMATE_LENSES.items():
        values, n_st = climate_values(world, proj, grid, elev, stations, lid)
        print(f"    {lid}: {n_st} stations with a 2025 value")
        lenses.append({"id": lid, **meta, "values": values})

    for lid, values in risk_values(world, proj, grid).items():
        lenses.append({"id": lid, **RISK_LENSES[lid], "values": values})

    pct, cover = world["pct"], world["cover"]
    for lid, (keys, meta) in LAND_LENSES.items():
        values = [round(sum(pct[k][i] for k in keys) / 100, 2) if owner[i] >= 0 and cover[i] else None
                  for i in range(grid.size)]
        lenses.append({"id": lid, "group": "land", **meta, "unit": "parte de la superficie", "format": "pct",
                       "scale": "linear", "higher_is": "neutral", "values": values})
    lenses.append({**ELEVATION, "values": [elev[i] if owner[i] >= 0 else None for i in range(grid.size)]})

    for lens in lenses:
        lens["domain"] = ([0, len(lens["categories"]) - 1] if lens["format"] == "category"
                          else percentile_domain(lens["values"], lens["scale"] == "log"))
        if lens["format"] != "category":  # a categorical lens has no percentile colour range
            lens["description"] += DOMAIN_NOTE
    groups = [g for g in GROUPS if any(l["group"] == g["id"] for l in lenses)]
    vint = load_interim_payload("meteogalicia")["vintage"]
    write_web("lenses.json", {"vintage": f"INE 2025, IGE 2023-2026, MeteoGalicia 2025 ({vint})",
                              "groups": groups, "lenses": lenses})


def check(web_dir) -> list[tuple[str, str]]:
    """Lens ids, units and coverage of Galician land cells (pipeline.check validates the general shape)."""
    from pathlib import Path

    path = Path(web_dir) / "lenses.json"
    if not path.exists():
        return [("NOTE", "lenses.json missing (pipeline.check reports it)")]
    doc = json.loads(path.read_text(encoding="utf-8"))
    by_id = {l.get("id"): l for l in doc.get("lenses", []) if isinstance(l, dict)}
    out = []
    want = ["density", *CONCELLO_LENSES, *CLIMATE_LENSES, *RISK_LENSES, *LAND_LENSES, "elevation"]
    missing = [i for i in want if i not in by_id]
    only_density = set(missing) == set(want) - {"density"}  # a dataset without the Galician lenses at all
    out.append(("NOTE" if only_density else "WARN", f"lenses missing: {missing}") if missing else ("PASS", f"all {len(want)} Galician lenses present"))
    us = [i for i in by_id if i in ("faith", "veterans", "disasters", "amenities", "income", "home", "health")]
    if us:
        out.append(("FAIL", f"US lenses still present: {us}"))
    dens = by_id.get("density")
    if dens and not str(dens.get("unit", "")).startswith("habitantes"):
        out.append(("FAIL", "density unit must start with 'habitantes'"))
    for l in doc.get("lenses", []):
        if l.get("format") == "eur" and "eur" not in l.get("unit", "").lower():
            out.append(("WARN", f"lens {l['id']}: money format but unit does not say euros"))
    return out
