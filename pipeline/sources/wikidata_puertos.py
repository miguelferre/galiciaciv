"""Puertos de interés general de Galicia: nombre y posición, de Wikidata (CC0).

Sin cifras de tráfico: Puertos del Estado exige autorización escrita previa para usar sus datos (D-002,
2026-11-26), así que el servicio ArcGIS de tráfico portuario ya no se descarga ni se usa. Las coordenadas son
la propiedad P625 de Wikidata, pedida en fetch(). Solo puertos del Estado: los autonómicos no están.
"""

from __future__ import annotations

import json
import urllib.parse

from ..core.fetch import UnexpectedContentError
from ..core.source import Source, SourceInfo

HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
WD_REL = "wikidata_puertos.json"

# id -> (nombre, autoridad portuaria, elemento de Wikidata, UN/LOCODE en P1937)
PORTS = {
    "a_coruna": ("A Coruña", "A Coruña", "Q956068", "ESLCG"),
    "ferrol": ("Ferrol", "Ferrol-San Cibrao", "Q3394104", None),  # sin P1937 en Wikidata
    "san_cibrao": ("San Cibrao", "Ferrol-San Cibrao", "Q31283136", "ESSCI"),
    "marin": ("Marín y Ría de Pontevedra", "Marín y Ría de Pontevedra", "Q96484531", "ESMPG"),
    "vilagarcia": ("Vilagarcía", "Vilagarcía", "Q24943461", "ESVIL"),  # el elemento es la Autoridad Portuaria
    "vigo": ("Vigo", "Vigo", "Q947819", "ESVGO"),
}
AUTHORITY_ITEMS = {"Q24943461"}

WD_URL = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
    {
        "action": "wbgetentities",
        "ids": "|".join(v[2] for v in PORTS.values()),
        "props": "labels|claims",
        "languages": "es|gl|en",
        "format": "json",
    }
)


def _read(path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise UnexpectedContentError(f"{path.name}: not JSON ({exc})") from exc
    if not isinstance(data, dict) or "error" in data:
        raise UnexpectedContentError(f"{path.name}: service error {data.get('error') if isinstance(data, dict) else data!r}")
    return data


def _claims(entity: dict, prop: str) -> list:
    """Values of `prop`, preferred rank first, deprecated ones left out."""
    claims = [c for c in entity.get("claims", {}).get(prop, []) if c.get("rank") != "deprecated"]
    claims.sort(key=lambda c: c.get("rank") != "preferred")
    return [c["mainsnak"]["datavalue"]["value"] for c in claims if "datavalue" in c.get("mainsnak", {})]


def _coords(data: dict) -> dict[str, tuple[float, float, str]]:
    """{port id: (lon, lat, source text)}; raises if an entity is not the expected one."""
    out = {}
    for pid, (_, _, qid, locode) in PORTS.items():
        entity = data.get("entities", {}).get(qid, {})
        points = _claims(entity, "P625")
        if not points:
            raise UnexpectedContentError(f"wikidata {qid} ({pid}): no P625 coordinates")
        if locode and locode not in _claims(entity, "P1937"):
            raise UnexpectedContentError(f"wikidata {qid} ({pid}): P1937 is {_claims(entity, 'P1937')}, expected {locode}")
        labels = " / ".join(v["value"] for v in entity.get("labels", {}).values())
        if locode is None and "ferrol" not in labels.casefold():
            raise UnexpectedContentError(f"wikidata {qid} ({pid}): unexpected labels {labels!r}")
        lon, lat = points[0]["longitude"], points[0]["latitude"]
        if not (-9.5 <= lon <= -6.6 and 41.7 <= lat <= 43.9):
            raise UnexpectedContentError(f"wikidata {qid} ({pid}): point ({lon}, {lat}) outside Galicia")
        note = f"Wikidata {qid}, propiedad P625 (CC0)"
        if qid in AUTHORITY_ITEMS:
            note += "; el elemento es la Autoridad Portuaria, no el puerto"
        precision = points[0].get("precision")
        if precision and precision > 0.001:
            note += f"; precisión declarada {precision:.3f} grados"
        out[pid] = (round(lon, 5), round(lat, 5), note)
    return out


class WikidataPuertos(Source):
    info = SourceInfo(
        id="wikidata_puertos",
        title="Puertos de interés general de Galicia (Wikidata)",
        publisher="Wikidata, Fundación Wikimedia",
        homepage="https://www.wikidata.org",
        license="CC0 (dominio público). Sin cifras de tráfico: Puertos del Estado exige autorización escrita previa.",
        description="Nombre y posición (propiedad P625) de los seis puertos de interés general de Galicia: A Coruña, "
        "Ferrol, San Cibrao, Marín y Ría de Pontevedra, Vilagarcía y Vigo. No incluye los puertos autonómicos "
        "ni ninguna cifra de tráfico.",
        used_for=["Puertos del mapa"],
    )

    def fetch(self, force=False):
        path = self.download(WD_URL, WD_REL, force=force, headers=HEADERS)
        try:
            _coords(_read(path))
        except UnexpectedContentError:
            self.discard(WD_REL)
            raise

    def process(self):
        coords = _coords(_read(self.raw_dir / WD_REL))
        ports = []
        for pid, (name, authority, _, _) in PORTS.items():
            lon, lat, note = coords[pid]
            ports.append({"id": pid, "name": name, "authority": authority, "lon": lon, "lat": lat,
                          "coords_source": note})
            print(f"    {pid:12} ({lon}, {lat})")
        return {"vintage": "Wikidata (CC0), posiciones de los puertos de interés general", "ports": ports,
                "_files": [WD_REL]}
