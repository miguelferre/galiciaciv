"""Etapas de los Caminos de Santiago en Galicia: IGN-CNIG, datos de la FEAACS (servicio ArcGIS `CaminoSantiago`).

Una sola consulta con la caja de Galicia (más un margen). Entran también trozos de Portugal y de otras comunidades: se
quedan solo las rutas con `id_camino` que empieza por «ES» y el recorte a tierra gallega lo hace el builder. El servicio
contesta GeoJSON en UTF-8 (sin forzarlo, curl lo lee mal: «Vía» sale con caracteres rotos). Las etapas de un mismo Camino
se agrupan por `id_camino`.
"""

import json
import urllib.parse

from ..core.source import Source, SourceInfo

URL = "https://nco.ign.es/server/rest/services/nco/CaminoSantiago/MapServer/1/query"
BBOX = (-9.4, 41.7, -6.7, 43.85)  # oeste, sur, este, norte
PAGE = 1000
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)", "Accept": "application/json"}
P = "sde.datos_nco."


def _url(offset):
    q = {"where": "1=1", "geometry": ",".join(str(v) for v in BBOX), "geometryType": "esriGeometryEnvelope",
         "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "f": "geojson",
         "orderByFields": P + "CST.objectid", "resultOffset": offset, "resultRecordCount": PAGE}
    return f"{URL}?{urllib.parse.urlencode(q)}"


class IgnCamino(Source):
    info = SourceInfo(
        id="ign_camino",
        title="Etapas de los Caminos de Santiago",
        publisher="IGN-CNIG, datos de la Federación Española de Asociaciones de Amigos del Camino de Santiago (FEAACS)",
        homepage="https://centrodedescargas.cnig.es/CentroDescargas/camino-santiago",
        license="CC-BY 4.0 FEAACS (página del CNIG leída el 2026-11-27; atribución «Caminos de Santiago: CC-BY 4.0 FEAACS, vía IGN-CNIG»)",
        description="Líneas de las etapas de los Caminos de Santiago del servicio ArcGIS `CaminoSantiago` del IGN (capa 1), "
        "pedidas una vez con la caja de Galicia (lon -9,4 a -6,7; lat 41,7 a 43,85). Solo rutas con `id_camino` que "
        "empieza por «ES». El trazado es una ayuda a la marcha, no el trazado definitivo (aviso del CNIG).",
        used_for=["Capa «Camino de Santiago» del mapa", "Km de Camino por concello (lente y asesor de Cultura)"],
    )

    def _path(self, k):
        return f"etapas-{k}.json"

    def fetch(self, force=False):
        k = 0
        while True:
            p = self.download(_url(k * PAGE), self._path(k), force=force, headers=HEADERS)
            doc = json.loads(p.read_text(encoding="utf-8"))
            if "error" in doc:
                self.discard(self._path(k))
                raise RuntimeError(f"El servicio del IGN devolvió un error: {doc['error']}")
            if not doc.get("exceededTransferLimit") and not (doc.get("properties") or {}).get("exceededTransferLimit"):
                return
            k += 1

    def process(self):
        stages, files, k, seen = [], [], 0, set()
        while (self.raw_dir / self._path(k)).exists():
            files.append(self._path(k))
            doc = json.loads((self.raw_dir / self._path(k)).read_text(encoding="utf-8"))
            for f in doc["features"]:
                pr, g = f["properties"], f["geometry"]
                cid = pr.get(P + "CST.id_camino") or ""
                if not cid.startswith("ES") or f["id"] in seen or not g:
                    continue
                seen.add(f["id"])
                parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
                stages.append({
                    "id": f["id"], "camino": cid, "stage": pr.get(P + "CST.id_etapa"),
                    "name": pr.get(P + "CST.nombre"), "km": pr.get(P + "CST.longitud"),
                    "camino_name": pr.get(P + "cst_camino.nombre"),
                    "lines": [[(round(c[0], 5), round(c[1], 5)) for c in part] for part in parts],
                })
            k += 1
        stages.sort(key=lambda s: (s["camino"], s["stage"] or "", s["id"]))
        return {"vintage": "IGN-CNIG, Caminos de Santiago (FEAACS), consulta del 2026-11-27", "_files": files,
                "stages": stages}
