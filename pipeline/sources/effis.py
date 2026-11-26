"""Áreas quemadas de EFFIS (Copernicus) en Galicia, 2016-2025.

EFFIS publica un WFS sin clave con una capa por año (`ms:modis.ba.poly.<año>`): polígonos de
áreas quemadas detectadas por satélite (MODIS/VIIRS), desde unas 30 ha. Se pide cada año en una
caja que cubre Galicia y un margen (también entra Portugal, Asturias, León y Zamora) y se queda
en process() con los de PROVINCE A Coruña, Lugo, Ourense y Pontevedra de COUNTRY ES.

Trampas verificadas el 2026-11-26:
* Con srs urn:ogc:def:crs:EPSG::4326 la caja va en orden lat,lon; las coordenadas del GeoJSON
  salen en lon,lat (comprobado con el incendio de Carballeda de Avia, Ourense, 13-10-2017).
* El incendio de Carballeda de Avia viene como GeometryCollection (un MultiPolygon más un
  MultiLineString degenerado), no como Polygon: un lector que solo espera Polygon falla ahí.
  Aquí se recorre la geometría entera y se cuenta lo que se descarta.
* Todas las propiedades llegan como texto (AREA_HA "105"); FIREDATE con o sin fracciones de segundo.
* El GeoJSON trae `numberMatched`; fetch() lo compara con los elementos recibidos para no cachear
  una respuesta cortada. Con resultType=hits el servidor da el mismo número, sin límite visible.
"""

import json
import re

from ..core.source import Source, SourceInfo

WFS = "https://maps.effis.emergency.copernicus.eu/effis"
YEARS = list(range(2016, 2026))
BBOX = "41.7,-9.5,43.9,-6.6"  # lat_sur,lon_oeste,lat_norte,lon_este: orden de EPSG:4326 en WFS 2.0
CRS = "urn:ogc:def:crs:EPSG::4326"
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
GALICIA = {"A Coruña", "Lugo", "Ourense", "Pontevedra"}  # PROVINCE, con COUNTRY == "ES"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _path(year):
    return f"ba_{year}.json"


def _url(year):
    return (
        f"{WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:modis.ba.poly.{year}"
        f"&bbox={BBOX},{CRS}&outputFormat=geojson"
    )


def _polygons(geom, drops):
    """Lista de polígonos [exterior, agujero, ...] de una geometría GeoJSON; lo que no es polígono se cuenta en `drops`."""
    t = geom.get("type")
    if t == "Polygon":
        return [geom["coordinates"]]
    if t == "MultiPolygon":
        return list(geom["coordinates"])
    if t == "GeometryCollection":
        return [p for g in geom["geometries"] for p in _polygons(g, drops)]
    drops[t] = drops.get(t, 0) + 1
    return []


def _ring(ring):
    out = []
    for lon, lat in ring:
        pt = [round(lon, 5), round(lat, 5)]
        if not out or out[-1] != pt:
            out.append(pt)
    return out if len(out) >= 4 and out[0] == out[-1] else None


def _clean(poly):
    rings = [_ring(r) for r in poly]
    if rings[0] is None:
        return None, 1 + len(rings[1:])  # sin exterior válido: el polígono entero cae
    return [r for r in rings if r is not None], sum(r is None for r in rings[1:])


class Effis(Source):
    info = SourceInfo(
        id="effis",
        title="Áreas quemadas de EFFIS (Copernicus)",
        publisher="EFFIS, Sistema Europeo de Información sobre Incendios Forestales (Copernicus, Comisión Europea)",
        homepage="https://forest-fire.emergency.copernicus.eu/applications/data-and-services",
        license="CC BY 4.0 (Comisión Europea, EFFIS); citar «© Unión Europea, EFFIS» e indicar los cambios",
        description="Polígonos de áreas quemadas de EFFIS (servicio WFS, capas ms:modis.ba.poly.<año>, 2016 a 2025) "
        "para Galicia: fecha, hectáreas, provincia y concello de cada incendio. Solo recoge incendios desde unas "
        "30 ha detectados por satélite (MODIS y VIIRS); los pequeños no están. Se filtran por la provincia "
        "(A Coruña, Lugo, Ourense, Pontevedra) y se guardan los perímetros con 5 decimales.",
        used_for=["Superficie quemada por celda 2016-2025", "Año del mayor incendio de cada celda"],
    )

    def fetch(self, force=False):
        for y in YEARS:
            p = self.download(_url(y), _path(y), force=force, headers=HEADERS)
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
                n, want = len(d["features"]), int(d["numberMatched"])
                if d.get("type") != "FeatureCollection" or n != want:
                    raise ValueError(f"{n} elementos de {want} anunciados")
            except (ValueError, KeyError) as exc:
                self.discard(_path(y))
                raise RuntimeError(f"EFFIS {y}: respuesta incompleta o mal formada ({exc}); vuelve a intentarlo") from exc

    def process(self):
        fires, by_year = [], {}
        drops, bad_rings, odd = {}, 0, {"fuera de Galicia": 0, "sin fecha": 0}
        seen = set()
        for y in YEARS:
            d = json.loads((self.raw_dir / _path(y)).read_text(encoding="utf-8"))
            by_year[str(y)] = {"n": 0, "area_ha": 0.0}
            for ft in d["features"]:
                p = ft["properties"]
                if p["COUNTRY"] != "ES" or p["PROVINCE"] not in GALICIA:
                    odd["fuera de Galicia"] += 1
                    continue
                key = (y, p["id"])
                if key in seen:
                    raise RuntimeError(f"EFFIS {y}: id {p['id']} repetido")
                seen.add(key)
                polys = []
                for poly in _polygons(ft["geometry"], drops):
                    cleaned, lost = _clean(poly)
                    bad_rings += lost
                    if cleaned:
                        polys.append(cleaned)
                if not polys:
                    raise RuntimeError(f"EFFIS {y}: el incendio {p['id']} no tiene ningún polígono válido")
                m = DATE_RE.match(p.get("FIREDATE") or "")
                odd["sin fecha"] += m is None
                area = float(p["AREA_HA"])
                fires.append(
                    {
                        "year": y,
                        "date": m.group(0) if m else None,
                        "area_ha": area,
                        "province": p["PROVINCE"],
                        "commune": p.get("COMMUNE") or "",
                        "polygons": polys,
                    }
                )
                by_year[str(y)]["n"] += 1
                by_year[str(y)]["area_ha"] += area
        for v in by_year.values():
            v["area_ha"] = round(v["area_ha"], 1)
        fires.sort(key=lambda f: (f["year"], f["date"] or "", -f["area_ha"]))
        print(f"    {len(fires)} incendios en Galicia; descartados por otra provincia: {odd['fuera de Galicia']}; "
              f"sin fecha: {odd['sin fecha']}; partes que no son polígono: {drops or 0}; anillos inválidos: {bad_rings}")
        return {
            "vintage": f"EFFIS áreas quemadas {YEARS[0]}-{YEARS[-1]}",
            "years": YEARS,
            "fires": fires,
            "by_year": by_year,
            "_files": [_path(y) for y in YEARS],
        }
