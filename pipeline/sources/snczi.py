"""Zonas inundables T=100 del SNCZI (MITECO), por WFS.

Capa `agua:Zi_laminas_q100` del GeoServer del MITECO: láminas de inundación de periodo de retorno
de 100 años (probabilidad media u ocasional). Comprobado el 2026-11-26: los 819 polígonos de la caja
de Galicia tienen `tipo_zona` = «Q Periodo de retorno T100» (la capa NO mezcla T=100 y T=500; el T=500
es otra capa, `Zi_laminas_q500`). Se pide GeoJSON en EPSG:4326 (el orden de las coordenadas es [lon, lat])
paginado (250 por página) y ordenado por `id_zona`; 179 MB en bruto en total (por debajo del umbral de 200 MB),
así que no se simplifica con Douglas-Peucker. El servidor ya redondea a 4 decimales (~8 m) y repite vértices:
aquí solo se quitan los vértices consecutivos idénticos (sin pérdida) y se redondea a 5 decimales (interim de ~16 MB).
"""

import json
import math
import urllib.parse
from datetime import date

from ..core.source import Source, SourceInfo

WFS = "https://gis.miteco.gob.es/geoserver/agua/ows"
LAYER = "agua:Zi_laminas_q100"
BBOX = (-9.4, 41.8, -6.7, 43.8)  # oeste, sur, este, norte (lon/lat)
PAGE = 250
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
ATTRS = ["id_zona", "zona", "tipo_zona", "rio", "long_km", "hipotesis", "hidrologia", "precision", "hidraul",
         "estudio", "tipo_est", "organismo", "demarcacio", "id_demar", "ciclo", "fecha_apro", "fecha_lim", "fecha_geo"]


def _url(start):
    q = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": LAYER,
        "bbox": "{},{},{},{},EPSG:4326".format(*BBOX), "outputFormat": "application/json",
        "srsName": "EPSG:4326", "sortBy": "id_zona", "count": PAGE, "startIndex": start,
        "propertyName": ",".join(ATTRS + ["shape"]),
    }
    return f"{WFS}?{urllib.parse.urlencode(q, safe=',:')}"


def _clean(ring):
    out = []
    for lon, lat in ring:
        p = [round(lon, 5), round(lat, 5)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def _ring_km2(ring):
    """Área aproximada en km² (proyección equirrectangular local)."""
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = 111.320 * math.cos(math.radians(lat0)), 110.574
    s = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        s += x0 * kx * y1 * ky - x1 * kx * y0 * ky
    return abs(s) / 2


def _poly_km2(rings):
    return _ring_km2(rings[0]) - sum(_ring_km2(r) for r in rings[1:])


class Snczi(Source):
    info = SourceInfo(
        id="snczi",
        title="Zonas inundables T=100 (SNCZI)",
        publisher="MITECO, Sistema Nacional de Cartografía de Zonas Inundables",
        homepage="https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html",
        license="MITECO: uso libre y gratuito con cita «© Ministerio para la Transición Ecológica y el Reto Demográfico» (CC BY 4.0 según la IDEE)",
        description="Láminas de inundación fluvial de periodo de retorno de 100 años (capa agua:Zi_laminas_q100 del WFS del MITECO), "
        "polígonos que tocan la caja lon -9,4 a -6,7 y lat 41,8 a 43,8 (Galicia y un margen: Miño-Sil, Galicia-Costa, "
        "Cantábrico Occidental y un tramo del Duero). Solo hay láminas en los tramos estudiados: la ausencia de lámina "
        "no significa ausencia de riesgo de inundación. Cada demarcación aporta su estudio, con fecha y método propios.",
        used_for=["Zona inundable T=100 (% de la celda)"],
    )

    def _path(self, k):
        return f"laminas_q100_{k:03d}.json"

    def _page(self, k):
        return json.loads((self.raw_dir / self._path(k)).read_text(encoding="utf-8"))

    def _pages(self):
        n = self._page(0)["numberMatched"]
        return -(-n // PAGE)

    def fetch(self, force=False):
        for k in range(10_000):
            p = self.download(_url(k * PAGE), self._path(k), force=force, headers=HEADERS)
            doc = json.loads(p.read_text(encoding="utf-8"))
            if not doc.get("features") and doc.get("numberMatched"):
                self.discard(self._path(k))
                raise RuntimeError("el WFS devolvió una página vacía; vuelve a intentarlo más tarde")
            if (k + 1) * PAGE >= doc["numberMatched"]:
                return

    def process(self):
        polygons, kept = [], []
        attrs_seen = set()
        n_expected = self._page(0)["numberMatched"]
        files = []
        for k in range(self._pages()):
            files.append(self._path(k))
            for f in self._page(k)["features"]:
                attrs_seen.update(f["properties"])
                g = f["geometry"]
                if not g:
                    continue
                if f["properties"].get("tipo_zona") != "Q Periodo de retorno T100":
                    continue  # solo T=100
                parts = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
                for poly in parts:
                    rings = [_clean(r) for r in poly]
                    rings = [r for r in rings if len(r) >= 4]
                    if rings:
                        polygons.append(rings)
                kept.append(f["id"])
        if len(set(kept)) != n_expected:
            raise RuntimeError(f"SNCZI: {len(set(kept))} láminas T=100 leídas de {n_expected} anunciadas")
        area = sum(_poly_km2(p) for p in polygons)
        return {
            "vintage": f"SNCZI láminas T=100 (MITECO), consultado {date.today().isoformat()}",
            "period": 100,
            "n": len(polygons),
            "area_km2_approx": round(area, 2),
            "polygons": polygons,
            "attributes_seen": sorted(attrs_seen),
            "_files": files,
        }
