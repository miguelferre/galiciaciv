"""Aeropuertos gallegos: nombre y posición, de OpenStreetMap (ODbL).

Sin cifras de tráfico: Aena reserva sus derechos y exige autorización escrita previa (D-002, 2026-11-26), así
que el informe anual ya no se descarga ni se usa. Posición: centro del polígono `aeroway=aerodrome` de
OpenStreetMap con ese código IATA.
"""

from __future__ import annotations

import json
import urllib.parse

from ..core.fetch import UnexpectedContentError
from ..core.source import Source, SourceInfo

HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
OSM_REL = "osm_aeropuertos.json"
OSM_QUERY = '[out:json][timeout:90];nwr["aeroway"="aerodrome"]["iata"~"^(SCQ|LCG|VGO)$"](41.7,-9.5,43.9,-6.6);out center tags;'
OSM_URL = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(OSM_QUERY)

# IATA -> (ICAO, ciudad)
AIRPORTS = {
    "SCQ": ("LEST", "Santiago de Compostela"),
    "LCG": ("LECO", "A Coruña"),
    "VGO": ("LEVX", "Vigo"),
}


def _osm(path) -> dict[str, dict]:
    """{IATA: OSM element}; raises unless there is exactly one aerodrome per airport."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise UnexpectedContentError(f"{path.name}: not JSON ({exc})") from exc
    if data.get("remark"):  # Overpass answers 200 with a remark when it runs out of time or memory
        raise UnexpectedContentError(f"{path.name}: Overpass remark {data['remark']!r}")
    out = {}
    for iata, (icao, _) in AIRPORTS.items():
        hits = [e for e in data.get("elements", []) if e.get("tags", {}).get("iata") == iata]
        if len(hits) != 1:
            raise UnexpectedContentError(f"{path.name}: {len(hits)} aerodromes with iata={iata}")
        if hits[0]["tags"].get("icao") != icao:
            raise UnexpectedContentError(f"{path.name}: {iata} has icao={hits[0]['tags'].get('icao')!r}, expected {icao}")
        out[iata] = hits[0]
    return out


class OsmAeropuertos(Source):
    info = SourceInfo(
        id="osm_aeropuertos",
        title="Aeropuertos de Galicia (OpenStreetMap)",
        publisher="OpenStreetMap contributors",
        homepage="https://www.openstreetmap.org",
        license="ODbL 1.0 («© colaboradores de OpenStreetMap»). Sin cifras de tráfico: Aena exige autorización escrita previa.",
        description="Nombre y posición del centro del aeródromo de Santiago-Rosalía de Castro, A Coruña y Vigo "
        "(aeroway=aerodrome con IATA). No incluye ninguna cifra de pasajeros, operaciones ni mercancía.",
        used_for=["Aeropuertos del mapa"],
    )

    def fetch(self, force=False):
        path = self.download(OSM_URL, OSM_REL, force=force, headers={**HEADERS, "Accept": "*/*"})  # Overpass: sin Accept responde 406
        try:
            _osm(path)
        except UnexpectedContentError:
            self.discard(OSM_REL)
            raise

    def process(self):
        osm = _osm(self.raw_dir / OSM_REL)
        airports = []
        for iata, (icao, city) in AIRPORTS.items():
            el = osm[iata]
            point = el.get("center") or el
            airports.append(
                {
                    "id": iata,
                    "icao": icao,
                    "name": el["tags"]["name"],
                    "city": city,
                    "lon": round(point["lon"], 5),
                    "lat": round(point["lat"], 5),
                    "coords_source": f"OpenStreetMap {el['type']} {el['id']}, centro del aeródromo "
                    "(ODbL, © colaboradores de OpenStreetMap)",
                }
            )
            print(f"    {iata}  ({airports[-1]['lon']}, {airports[-1]['lat']})")
        return {"vintage": "OpenStreetMap (ODbL), posiciones de los aeródromos", "airports": airports,
                "_files": [OSM_REL]}
