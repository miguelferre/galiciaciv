"""Counties = the 313 concellos, one row each for the Explorer table (column-oriented).

GEOID = 5-digit INE code. Every concello of world.json appears, including the few that own no hex (2 on 1 km hexes):
their land-cover shares and climate come from the hexes their sample points fall in (null if none).
`state` is the comarca name, `city` the cities.json id (the concello itself when it is a city).
Unemployment is registered unemployed per inhabitant (0..1, shown as a share).
"""

from __future__ import annotations

import json
from collections import Counter

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.paths import WEB_DATA
from ..core.store import load_interim, write_web
from .cities import nearest_land
from .galicia import comarca_tables, concello_info
from .lenses import concello_metrics

REQUIRES = ["_world", "ign_limites", "ige_comarcas", "ine_padron", "ige_pib", "ige_afiliacion", "ige_paro",
            "ine_adrh", "ige_poboacion", "ige_censo", "cities.json", "lenses.json"]
PRODUCES = ["counties.json"]

LAND = {  # output key -> (world pct key, label, description)
    "forest": ("forest", "Bosque", "Parte de la superficie del concello cubierta por bosque (ESA WorldCover 2021)"),
    "crop": ("crop", "Cultivo", "Parte de la superficie del concello en cultivos (ESA WorldCover 2021)"),
    "pasture": ("pasture", "Pasto", "Parte de la superficie del concello en pastizal o prado (ESA WorldCover 2021)"),
    "developed": ("developed", "Suelo urbanizado", "Parte de la superficie del concello con edificios y calles (ESA WorldCover 2021)"),
}
LAND_NOTE = (", promediada sobre las casillas donde caen las muestras del concello (la parte de cada casilla se "
             "cuenta una vez por muestra). En blanco si ninguna muestra cae en el concello.")
CLIMATE = {"temp": ("Temperatura media", "°C, 2025", "float", "Temperatura media anual de 2025 interpolada desde "
                    "las estaciones de MeteoGalicia (con corrección por altitud), promediada sobre las casillas del concello"),
           "precip": ("Precipitación anual", "mm, 2025", "int", "Precipitación anual de 2025 interpolada desde "
                      "las estaciones de MeteoGalicia, promediada sobre las casillas del concello"),
           "viento": ("Viento medio", "m/s, 2025", "float", "Velocidad media del viento a 10 m en 2025 interpolada "
                      "desde las estaciones de MeteoGalicia, promediada sobre las casillas del concello"),
           "sol": ("Horas de sol", "horas, 2025", "int", "Horas de sol de 2025 interpoladas desde las estaciones de "
                   "MeteoGalicia, promediadas sobre las casillas del concello"),
           "humedad": ("Humedad relativa", "media de 2025", "pct", "Humedad relativa media de 2025 interpolada desde "
                       "las estaciones de MeteoGalicia, promediada sobre las casillas del concello")}
CLIMATE_DIGITS = {"temp": 1, "precip": 0, "viento": 1, "sol": 0, "humedad": 3}
CONCELLO_TEXT = {"EDAD": 'Edad media de la población del concello a 1 de enero de 2025 (IGE, tabla 723, «Idade media», a partir del padrón).', "NACIDOS": 'Personas empadronadas en el concello a 1 de enero de 2025 que nacieron en otra comunidad autónoma o en el extranjero, entre toda la población del concello (IGE, tabla 143, población por lugar de nacimiento).', "ESTUDIOS": 'Personas de 15 años o más con educación superior (nivel «Educación superior» de la tabla del IGE) entre toda la población de 15 años o más del concello (IGE, tabla 11253, a partir del Censo de 2021).'}
# Concello values straight from concello_metrics (lenses.py): key -> (label, format, unit, higher_is, source, description)
PER_CONCELLO = {
    "renta_pc": ("Renta neta por persona", "eur", "euros por persona", "good", "ine_adrh",
                 "Renta neta media por persona, 2024 (INE, Atlas de Distribución de Renta de los Hogares)."),
    "gini": ("Índice de Gini", "float", "de 0 a 100", "bad", "ine_adrh",
             "Índice de Gini de la renta, 2024 (INE, Atlas de Distribución de Renta de los Hogares)."),
    "p80p20": ("P80/P20", "float", "veces", "bad", "ine_adrh",
               "Cociente entre los percentiles 80 y 20 de la renta, 2024 (INE, Atlas de Distribución de Renta de los Hogares)."),
    "edad_media": ("Edad media", "years", "años", "neutral", "ige_poboacion", "EDAD"),
    "nacidos_fuera": ("Nacidos fuera de Galicia", "pct", "parte de la población", "neutral", "ige_poboacion", "NACIDOS"),
    "estudios_superiores": ("Estudios superiores", "pct", "parte de la población de 15 años o más", "neutral", "ige_censo", "ESTUDIOS"),
}


def _round(v, digits):
    return round(v) if digits == 0 else round(v, digits)


def _field(key, label, fmt, unit, higher_is, source, description):
    return {"key": key, "label": label, "format": fmt, "unit": unit, "higher_is": higher_is,
            "source": source, "description": description}


def fields() -> list[dict]:
    out = [
        _field("geoid", "Código INE", "text", None, "neutral", "ign_limites", "Código INE de 5 dígitos del concello (provincia + concello)."),
        _field("name", "Concello", "text", None, "neutral", "ign_limites", "Nombre oficial del concello."),
        _field("state", "Comarca", "text", None, "neutral", "ige_comarcas", "Comarca del concello (IGE, tabla 2246)."),
        _field("province", "Provincia", "text", None, "neutral", "ign_limites", "Provincia del concello."),
        _field("population", "Población", "int", "habitantes", "neutral", "ine_padron", "Población a 1 de enero de 2025 (padrón del INE, vía IGE 589)."),
        _field("land_km2", "Superficie", "km2", "km²", "neutral", "ign_limites", "Superficie del concello, calculada del contorno de los límites municipales del IGN (INSPIRE AU), antes de simplificarlo."),
        _field("density", "Densidad", "float", "habitantes por km²", "neutral", "ine_padron", "Población entre superficie."),
        _field("gdp", "PIB", "eur", "euros", "good", "ige_pib", "PIB de 2023 estimado por el IGE para el concello (tabla 9958)."),
        _field("gdp_pc", "PIB por habitante", "eur", "euros por habitante", "good", "ige_pib", "PIB de 2023 entre la población de 2025."),
        _field("affiliates", "Afiliados", "int", "personas", "neutral", "ige_afiliacion",
               "Afiliaciones a la Seguridad Social por concello de residencia, septiembre de 2026 (IGE, tabla 11497)."),
        _field("agro", "Afiliados en agricultura y pesca", "int", "personas", "neutral", "ige_afiliacion",
               "Afiliados que viven en el concello y trabajan en agricultura y pesca. En blanco si el IGE lo oculta."),
        _field("industria", "Afiliados en industria", "int", "personas", "neutral", "ige_afiliacion",
               "Afiliados que viven en el concello y trabajan en la industria. En blanco si el IGE lo oculta."),
        _field("construccion", "Afiliados en construcción", "int", "personas", "neutral", "ige_afiliacion",
               "Afiliados que viven en el concello y trabajan en la construcción. En blanco si el IGE lo oculta."),
        _field("servicios", "Afiliados en servicios", "int", "personas", "neutral", "ige_afiliacion",
               "Afiliados que viven en el concello y trabajan en servicios. En blanco si el IGE lo oculta."),
        _field("agro_share", "Afiliación agraria", "pct", "parte de las afiliaciones", "neutral", "ige_afiliacion",
               "Afiliados en agricultura y pesca entre todos los afiliados del concello."),
        _field("industry_share", "Afiliación industrial", "pct", "parte de las afiliaciones", "neutral", "ige_afiliacion",
               "Afiliados en industria entre todos los afiliados del concello."),
        _field("unemployment", "Paro registrado", "pct", "parados por habitante", "bad", "ige_paro",
               "Parados registrados en octubre de 2026 (IGE, tabla 742) entre la población de 2025. No es la tasa de "
               "paro. En blanco en Oza-Cesuras y Cerdedo-Cotobade, donde el IGE da 0 por ser concellos fusionados."),
    ]
    for key, (label, fmt, unit, hib, src, desc) in PER_CONCELLO.items():
        out.append(_field(key, label, fmt, unit, hib, src, CONCELLO_TEXT.get(desc, desc)))
    for key, (label, unit, fmt, desc) in CLIMATE.items():
        out.append(_field(key, label, fmt, unit, "neutral", "meteogalicia", desc + ". En blanco si ninguna muestra cae en el concello."))
    for key, (_, label, desc) in LAND.items():
        out.append(_field(key, label, "pct", "parte de la superficie", "neutral", "worldcover", desc + LAND_NOTE))
    out.append(_field("city", "Ciudad", "text", None, "neutral", "ine_padron",
                      "Identificador en cities.json si el concello tiene 10 000 habitantes o más; si no, en blanco."))
    out.append(_field("cell", "Casilla del mapa", "int", None, "neutral", "ign_limites",
                      "Casilla de Galicia más cercana al centro del concello (en su comarca si es posible). Permite "
                      "encontrar en el mapa un concello más pequeño que una casilla."))
    return out


def build() -> None:
    world = load_interim("_world")
    pop = load_interim("ine_padron")["by_concello"]
    aff = load_interim("ige_afiliacion")["by_concello"]
    info = concello_info()
    comarcas, comarca_of = comarca_tables()
    city_ids = {c["id"] for c in json.loads((WEB_DATA / "cities.json").read_text(encoding="utf-8"))}
    lenses = {l["id"]: l["values"] for l in json.loads((WEB_DATA / "lenses.json").read_text(encoding="utf-8"))["lenses"]}
    pct, cover, owner = world["pct"], world["cover"], world["owner"]
    proj, grid = MapProjection(**world["projection"]), HexGrid(**world["grid"])
    state_idx = {fips: k for k, fips in enumerate(world["states"])}
    metrics = concello_metrics(world["counties"])

    # Per concello: cells its samples fall in (one count per sample) -> land shares and climate.
    acc = [Counter() for _ in world["counties"]]
    n = Counter()
    for cell, s in enumerate(world["county_samples"]):
        if not s or owner[cell] < 0:
            continue
        for k in s:
            if k < 0:
                continue
            for key in CLIMATE:
                if lenses[key][cell] is not None:
                    acc[k][key] += lenses[key][cell]
                    acc[k][key + "_n"] += 1
            if cover[cell]:
                n[k] += 1
                for key, (pk, _, _) in LAND.items():
                    acc[k][key] += pct[pk][cell]

    fs = fields()
    columns = [f["key"] for f in fs]
    rows, no_cell = [], []
    for k, geoid in enumerate(world["counties"]):
        g, m, a = info[geoid], metrics[k], aff.get(geoid) or {}
        x, y = proj(g["lon"], g["lat"])
        com = comarca_of[geoid]
        cell = nearest_land(grid, owner, max(grid.cell_at(x, y), 0), x, y, state_idx.get(com, -9))
        if cell < 0:
            no_cell.append(geoid)
        p = pop[geoid]
        row = {
            "geoid": geoid, "name": g["name"], "state": comarcas[com]["name"], "province": g["province"],
            "population": p, "land_km2": round(g["area_km2"], 1), "density": round(p / g["area_km2"], 1),
            "gdp": m["gdp"], "gdp_pc": round(m["gdp_pc"]) if m["gdp_pc"] is not None else None,
            "affiliates": a.get("total"),
            "agro": a.get("agro"), "industria": a.get("industria"),
            "construccion": a.get("construcion"), "servicios": a.get("servizos"),
            "agro_share": round(m["agro_share"], 4) if m["agro_share"] is not None else None,
            "industry_share": round(m["industry_share"], 4) if m["industry_share"] is not None else None,
            "unemployment": round(m["unemployment"] / 100, 4) if m["unemployment"] is not None else None,
            **{key: (_round(acc[k][key] / acc[k][key + "_n"], CLIMATE_DIGITS[key]) if acc[k][key + "_n"] else None)
               for key in CLIMATE},
            **{key: (_round(m[key], 4 if PER_CONCELLO[key][1] == "pct" else 0 if key == "renta_pc" else 2)
                     if m[key] is not None else None) for key in PER_CONCELLO},
            **{key: (round(acc[k][key] / n[k] / 100, 4) if n[k] else None) for key in LAND},
            "city": geoid if geoid in city_ids else None,
            "cell": cell if cell >= 0 else None,
        }
        rows.append([row[c] for c in columns])
    write_web("counties.json", {"vintage": "INE 2025, IGE 2023-2026, MeteoGalicia 2025", "fields": fs,
                                "columns": columns, "rows": rows})
    print(f"    {len(rows)} concellos, {sum(1 for r in rows if r[columns.index('city')])} are cities, "
          f"{sum(1 for k in range(len(rows)) if not n[k])} without land shares"
          + (f"; no cell for {no_cell}" if no_cell else ""))
