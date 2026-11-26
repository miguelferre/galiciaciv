"""Límite del Parque Nacional de las Illas Atlánticas (servicio ArcGIS del IGN, visualizador de Parques Nacionales).

Capa 11 («Límite del Parque Nacional») del servicio visualizador_ppnn/12_limites, filtrada por idPark = 12 y
pedida en EPSG:4326 con 6 decimales. Pesa unos 23 kB, así que no se simplifica (sin maxAllowableOffset).
`rings` son los anillos tal como los da ArcGIS (exteriores en sentido horario, huecos al contrario).
`area_ha` es el atributo superficie_ha del servicio; incluye la superficie marina.
"""

import json
import urllib.parse
from datetime import datetime, timedelta, timezone

from ..core.fetch import UnexpectedContentError, read_manifest
from ..core.source import Source, SourceInfo

LAYER = "https://serviciosgis.ign.es/servicios/rest/services/visualizador_ppnn/12_limites/MapServer/11"
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
WHERE = "idPark=12"
PAGE = 2000
COUNT = "count.json"


def _url(params):
    return f"{LAYER}/query?{urllib.parse.urlencode(params)}"


def _page(k):
    return f"limite_{k:03d}.json"


def _load(path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise UnexpectedContentError(f"{path.name}: no es JSON ({exc})") from exc
    if not isinstance(data, dict) or "error" in data or not ("features" in data or "count" in data):
        raise UnexpectedContentError(f"{path.name}: respuesta de error {str(data)[:200]}")
    return data


class IgnPpnn(Source):
    info = SourceInfo(
        id="ign_ppnn",
        title="Límite del Parque Nacional Marítimo-Terrestre de las Illas Atlánticas de Galicia",
        publisher="Instituto Geográfico Nacional (IGN)",
        homepage="https://serviciosgis.ign.es/servicios/rest/services/visualizador_ppnn/12_limites/MapServer",
        license="CC BY 4.0 según los metadatos del Organismo Autónomo Parques Nacionales («Fuente: Organismo Autónomo "
        "Parques Nacionales»; © Instituto Geográfico Nacional de España). Que la capa del servicio sea ese fichero es "
        "una inferencia: verificación parcial.",
        description="Polígonos del límite del parque nacional (archipiélagos y aguas incluidas), superficie y fecha "
        "de declaración, del servicio de mapas del visualizador de Parques Nacionales.",
        used_for=["Maravillas (Parque Nacional)"],
    )

    def _get(self, url, rel, force):
        path = self.download(url, rel, force=force, headers=HEADERS)
        try:
            return _load(path)
        except UnexpectedContentError:
            self.discard(rel)
            raise

    def fetch(self, force=False):
        total = self._get(_url({"where": WHERE, "returnCountOnly": "true", "f": "json"}), COUNT, force)["count"]
        offset, k = 0, 0
        while offset < total:
            q = {"where": WHERE, "outFields": "idPark,nombre,superficie_ha,fecha_declaracion,declaracion",
                 "returnGeometry": "true", "outSR": 4326, "geometryPrecision": 6, "f": "json",
                 "resultOffset": offset, "resultRecordCount": PAGE}
            n = len(self._get(_url(q), _page(k), force)["features"])
            if not n:
                self.discard(_page(k))
                raise RuntimeError(f"ign_ppnn: página vacía en resultOffset={offset} de {total}")
            offset, k = offset + n, k + 1

    def process(self):
        total = _load(self.raw_dir / COUNT)["count"]
        features, files = [], [COUNT]
        while len(features) < total:
            rel = _page(len(files) - 1)
            page = _load(self.raw_dir / rel)["features"]
            if not page:
                raise RuntimeError(f"ign_ppnn: {rel} vacía")
            features += page
            files.append(rel)
        if total < 1 or len(features) != total:
            raise RuntimeError(f"ign_ppnn: {len(features)} entidades, esperadas {total} (al menos 1)")

        parks = []
        for f in features:
            a = f["attributes"]
            if a.get("idPark") != 12 or "Atlánticas" not in (a.get("nombre") or ""):
                raise RuntimeError(f"ign_ppnn: entidad inesperada {a.get('idPark')} {a.get('nombre')!r}")
            rings = [[[round(x, 6), round(y, 6)] for x, y in ring] for ring in f["geometry"]["rings"]]
            ms = a.get("fecha_declaracion")  # milisegundos desde 1970, UTC
            declared = (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ms)).date().isoformat() if ms is not None else None
            parks.append({
                "name": a["nombre"].strip(),
                "area_ha": round(a["superficie_ha"], 2),
                "declared": declared,
                "rings": rings,
            })
        print(f"    {len(parks)} parque, {sum(len(p['rings']) for p in parks)} anillos, "
              f"{sum(len(r) for p in parks for r in p['rings'])} vértices")
        when = read_manifest(self.id).get(COUNT, {}).get("retrieved", "")[:10]
        return {"vintage": f"IGN, visualizador de Parques Nacionales, consultado {when}", "parks": parks, "_files": files}
