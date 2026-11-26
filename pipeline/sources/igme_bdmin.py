"""Explotaciones e indicios de rocas y minerales industriales (IGME, base de datos BDMIN).

Servicio ArcGIS `BasesDatos/IGME_BDMIN_Explotaciones`, capa 0, pedido con la caja de Galicia y paginado
(1.000 por página). La caja incluye León, Asturias y Zamora: se filtra por el campo `Provincia`. La capa no
tiene nombre de explotación (`name` va a null) y `Municipio` es un nombre, no un código INE. No se filtra por
estado: se conserva `Estado_Explotacion` tal cual («Activa continua», «Activa intermitente», «Abandonada»,
«Indicio»). La minería metálica está en otro servicio (IGME_BDMIN_Indicios y Metalogenia), que aquí no se usa.
"""

import json
import urllib.parse
from datetime import date

from ..core.source import Source, SourceInfo

SERVICE = "https://mapas.igme.es/gis/rest/services/BasesDatos/IGME_BDMIN_Explotaciones/MapServer"
BBOX = (-9.4, 41.8, -6.7, 43.8)  # oeste, sur, este, norte
PAGE = 1000
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
PROVINCES = {"CORUÑA": "A Coruña", "LUGO": "Lugo", "ORENSE": "Ourense", "PONTEVEDRA": "Pontevedra"}


def _query(**params):
    q = {
        "where": "1=1", "geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope",
        "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "f": "json", **params,
    }
    return f"{SERVICE}/0/query?{urllib.parse.urlencode(q)}"


def _text(value):
    return (value or "").strip() or None


class IgmeBdmin(Source):
    info = SourceInfo(
        id="igme_bdmin",
        title="Explotaciones de rocas y minerales industriales (BDMIN)",
        publisher="Instituto Geológico y Minero de España (CN IGME-CSIC)",
        homepage=SERVICE,
        license="Licencia de uso del CN IGME: libre y gratuita, uso comercial y no comercial, con la cita «Origen de "
        "los datos: ©CN Instituto Geológico y Minero de España (IGME)» (info.igme.es/media/Pdfs/LicUsoIGME_GENERICA_2022.pdf). "
        "El servicio pide contactar con el IGME antes de montar un servicio de valor añadido de pago.",
        description="Puntos de la base BDMIN en las cuatro provincias gallegas: sustancia, estado de la explotación "
        "(activa continua, activa intermitente, abandonada o indicio) y municipio. Solo rocas y minerales "
        "industriales: no incluye la minería metálica. El IGME fecha la última actualización del servicio en marzo "
        "de 2015, así que «activa» significa activa según una ficha de esa fecha o anterior.",
        used_for=["Canteras y minas por celda (sustancia y estado según BDMIN)"],
    )

    def _json(self, rel):
        doc = json.loads((self.raw_dir / rel).read_text(encoding="utf-8"))
        if "error" in doc:
            raise RuntimeError(f"igme_bdmin: error del servicio en {rel}: {doc['error']}")
        return doc

    def _get(self, url, rel, force):
        self.download(url, rel, force=force, headers=HEADERS)
        try:
            return self._json(rel)
        except (ValueError, RuntimeError):
            self.discard(rel)
            raise

    def fetch(self, force=False):
        total = self._get(_query(returnCountOnly="true"), "count.json", force)["count"]
        got, k = 0, 0
        while got < total:
            url = _query(outFields="*", outSR=4326, orderByFields="ESRI_OID", resultOffset=got, resultRecordCount=PAGE)
            n = len(self._get(url, f"explotaciones_{k:02d}.json", force)["features"])
            if not n:
                self.discard(f"explotaciones_{k:02d}.json")
                raise RuntimeError(f"igme_bdmin: página vacía con {got} de {total} registros")
            got += n
            k += 1

    def process(self):
        total = self._json("count.json")["count"]
        files, features, k = ["count.json"], [], 0
        while len(features) < total:
            rel = f"explotaciones_{k:02d}.json"
            page = self._json(rel)["features"]
            if not page:
                raise RuntimeError(f"igme_bdmin: {rel} está vacía")
            features += page
            files.append(rel)
            k += 1
        ids = {f["attributes"]["Codigo_roca"] for f in features}
        if len(features) != total or len(ids) != total:
            raise RuntimeError(f"igme_bdmin: {len(features)} registros ({len(ids)} códigos únicos), el servicio anuncia {total}")

        sites, outside, dropped = [], {}, []
        for f in features:
            a, g = f["attributes"], f.get("geometry")
            province = PROVINCES.get((a.get("Provincia") or "").strip())
            if province is None:
                outside[a.get("Provincia")] = outside.get(a.get("Provincia"), 0) + 1
                continue
            if not g:
                dropped.append(a["Codigo_roca"])
                continue
            sites.append({
                "id": a["Codigo_roca"],
                "lon": round(g["x"], 6), "lat": round(g["y"], 6),
                "name": None,
                "substance": _text(a.get("Sustancia")),
                "status": _text(a.get("Estado_Explotacion")),
                "concello": _text(a.get("Municipio")),
                "province": province,
                "uses": _text(a.get("Usos")),
            })
        print(f"    {len(sites)} puntos en Galicia de {total} en la caja; fuera por provincia {outside}; sin geometría: {dropped}")
        return {
            "vintage": f"IGME BDMIN Explotaciones (última actualización del servicio: marzo de 2015), consultado el {date.today().isoformat()}",
            "sites": sites,
            "_files": files,
        }
