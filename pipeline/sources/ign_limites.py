"""Límites administrativos de Galicia y vecinos (IGN, servicio WFS INSPIRE «Unidades administrativas», CC BY 4.0).

Sustituye a GISCO LAU (EuroGeographics, solo uso no comercial). Mismas claves interinas que tenía `gisco_lau`:
`counties` (313 concellos, `geoid` = código INE de 5 dígitos) y `neighbours` (Asturias, León y Zamora más Portugal).

* Concellos: au:AdministrativeUnit de nivel 4 (Municipio), filtrados por `nationalCode`. El código IGN tiene 11 cifras:
  «34» (España) + comunidad (2) + provincia (2) + provincia (2) + municipio (3); el INE de 5 cifras son las últimas 5.
  Se piden por provincia y en páginas de PAGE, ordenados por código; cada página se guarda tal como llega.
* España vecina: las tres provincias (nivel 3) del mismo servicio, para que sus bordes coincidan con los de Galicia.
* Portugal: Natural Earth 1:10m, países (dominio público), fijado al mismo tag que `natural_earth`.

El IGN da la geometría a escala 1:25 000 aprox. Para el mapa de hexágonos de 1 km sobra: `process` simplifica cada anillo
(Douglas-Peucker, TOLERANCE_DEG). La superficie se mide antes de simplificar.
"""

import json
import math
import urllib.parse

from ..core.fetch import UnexpectedContentError
from ..core.geo import bbox_intersects, geojson_rings, load_geojson
from ..core.source import Source, SourceInfo

WFS = "https://www.ign.es/wfs-inspire/unidades-administrativas"  # servicios.idee.es resetea la conexión desde algunas redes
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
PROVINCES = {"15": "A Coruña", "27": "Lugo", "32": "Ourense", "36": "Pontevedra"}
GALICIA_CCAA = "12"
# Vecinos: provincias de Asturias (33), León (24) y Zamora (49), con su código IGN de provincia (34 + comunidad + provincia + 00000).
NEIGHBOUR_PROVINCES = {"33": "34033300000", "24": "34072400000", "49": "34074900000"}
WINDOW = (-10.6, 40.6, -5.4, 44.8)
PAGE = 20
NE_TAG = "v5.1.2"
NE_FILE = "ne_10m_admin_0_countries"
NE_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{NE_TAG}/geojson/{NE_FILE}.geojson"
NE_REL = f"{NE_TAG}/{NE_FILE}.geojson"
TOLERANCE_DEG = 0.0005  # ~55 m
EARTH_RADIUS_KM = 6371.0088


def polygon_area_km2(geometry: dict) -> float:
    """Area of a GeoJSON (Multi)Polygon in lon/lat, holes subtracted, on the sinusoidal (equal-area) projection."""
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    total = 0.0
    for polygon in polygons:
        for k, ring in enumerate(polygon):
            pts = [(math.radians(p[0]) * math.cos(math.radians(p[1])) * EARTH_RADIUS_KM,
                    math.radians(p[1]) * EARTH_RADIUS_KM) for p in ring]
            twice = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
            total += abs(twice) / 2 * (1 if k == 0 else -1)
    return total


def simplify_ring(ring: list, tol: float = TOLERANCE_DEG) -> list:
    """Douglas-Peucker on a closed ring (first point == last). Distances in degrees, longitude scaled by cos(lat)."""
    if len(ring) <= 4:
        return list(ring)
    k = math.cos(math.radians(ring[0][1]))
    pts = [(x * k, y) for x, y in ring]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        far, far_d = -1, tol
        for i in range(a + 1, b):
            px, py = pts[i]
            d = math.hypot(px - ax, py - ay) if norm == 0 else abs(dy * (px - ax) - dx * (py - ay)) / norm
            if d > far_d:
                far, far_d = i, d
        if far >= 0:
            keep[far] = True
            stack.append((a, far))
            stack.append((far, b))
    out = [ring[i] for i, kept in enumerate(keep) if kept]
    return out if len(out) >= 4 else list(ring)


def _simple_rings(geometry: dict) -> list:
    return [simplify_ring(r) for r in geojson_rings(geometry)]


def _name(p: dict) -> str:
    g = p["name"]["GeographicalName"]
    g = g[0] if isinstance(g, list) else g
    s = g["spelling"]
    s = s[0] if isinstance(s, list) else s
    return s["SpellingOfName"]["text"].strip()


def _like(prefix: str) -> str:
    return ('<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"><fes:PropertyIsLike wildCard="*" singleChar="?" '
            f'escapeChar="\\"><fes:ValueReference>nationalCode</fes:ValueReference><fes:Literal>{prefix}*</fes:Literal>'
            "</fes:PropertyIsLike></fes:Filter>")


def _url(prefix: str, start: int, count: int) -> str:
    q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": "au:AdministrativeUnit",
         "outputFormat": "application/geo+json", "srsName": "urn:ogc:def:crs:EPSG::4326", "sortBy": "nationalCode",
         "filter": _like(prefix), "startIndex": start, "count": count}
    return f"{WFS}?{urllib.parse.urlencode(q)}"


def _load(path) -> list:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise UnexpectedContentError(f"{path.name}: no es JSON ({exc})") from exc
    if not isinstance(data, dict) or "features" not in data:
        raise UnexpectedContentError(f"{path.name}: respuesta sin entidades {str(data)[:200]}")
    return data["features"]


class IgnLimites(Source):
    info = SourceInfo(
        id="ign_limites",
        title="Unidades administrativas (INSPIRE AU) del IGN: concellos de Galicia, provincias vecinas y Portugal",
        publisher="Instituto Geográfico Nacional (IGN); Portugal: Natural Earth",
        homepage="https://www.ign.es/web/ign/portal/ide-area-nodo-ide-ign",
        license="CC BY 4.0, «© Instituto Geográfico Nacional» (campo AccessConstraints del WFS). Portugal: Natural Earth, "
        "dominio público",
        description="Contornos de los 313 municipios gallegos (concellos; el código INE son las 5 últimas cifras del "
        "nationalCode) y de las provincias de Asturias, León y Zamora, del WFS INSPIRE del IGN, simplificados a ~55 m; "
        "Portugal sale de Natural Earth 1:10m. Deciden a qué concello (y, mediante la tabla del IGE, a qué comarca) "
        "pertenece cada hexágono.",
        used_for=["Mapa: tierra frente a agua", "Concello y comarca de cada hexágono"],
    )

    @staticmethod
    def _page(tag: str, k: int) -> str:
        return f"{tag}_{k:03d}.json"

    def _pages(self, tag: str, prefix: str, force: bool):
        """Download every page of one filter; returns the relative file names."""
        names, start = [], 0
        while True:
            rel = self._page(tag, start // PAGE)
            path = self.download(_url(prefix, start, PAGE), rel, force=force, headers=HEADERS)
            try:
                n = len(_load(path))
            except UnexpectedContentError:
                self.discard(rel)
                raise
            names.append(rel)
            if n < PAGE:
                return names
            start += n

    def fetch(self, force=False):
        for pp in PROVINCES:
            self._pages(f"mun_{pp}", f"34{GALICIA_CCAA}{pp}{pp}", force)
        for pp, code in NEIGHBOUR_PROVINCES.items():
            self.download(_url(code, 0, 5), f"prov_{pp}.json", force=force, headers=HEADERS)
        self.download(NE_URL, NE_REL, force=force)

    def process(self):
        files, counties = [], []
        for pp, province in PROVINCES.items():
            k = 0
            while (self.raw_dir / self._page(f"mun_{pp}", k)).exists():
                rel = self._page(f"mun_{pp}", k)
                files.append(rel)
                for f in _load(self.raw_dir / rel):
                    p = f["properties"]
                    code = str(p["nationalCode"])
                    if p["nationalLevel"]["href"].rsplit("/", 1)[-1] != "4thOrder" or len(code) != 11 or code[-5:-3] != pp:
                        continue
                    counties.append({"geoid": code[-5:], "name": _name(p), "province": province,
                                     "area_km2": round(polygon_area_km2(f["geometry"]), 2),
                                     "rings": _simple_rings(f["geometry"])})
                k += 1
        counties.sort(key=lambda c: c["geoid"])
        ids = [c["geoid"] for c in counties]
        if len(counties) != 313 or len(set(ids)) != 313 or not {"15902", "36902"} <= set(ids):
            raise ValueError(f"expected 313 distinct Galician concellos incl. 15902 and 36902, found {len(counties)}")

        neighbours = []
        for pp, code in NEIGHBOUR_PROVINCES.items():
            rel = f"prov_{pp}.json"
            files.append(rel)
            for f in _load(self.raw_dir / rel):
                p = f["properties"]
                if str(p["nationalCode"]) != code:
                    continue
                rings = [r for r in _simple_rings(f["geometry"]) if bbox_intersects(r, WINDOW)]
                if rings:
                    neighbours.append({"geoid": f"ES{pp}", "name": _name(p), "rings": rings})
        if len(neighbours) != len(NEIGHBOUR_PROVINCES):
            raise ValueError(f"expected {len(NEIGHBOUR_PROVINCES)} neighbouring provinces, found {len(neighbours)}")

        files.append(NE_REL)
        for f in load_geojson(self.raw_dir / NE_REL):
            if f["properties"].get("ADM0_A3") == "PRT":
                rings = [simplify_ring(r) for r in geojson_rings(f["geometry"]) if bbox_intersects(r, WINDOW)]
                neighbours.append({"geoid": "PT", "name": "Portugal", "rings": rings})
                break
        else:
            raise ValueError("Portugal not found in Natural Earth countries")
        return {"vintage": f"IGN, Unidades administrativas (WFS INSPIRE); Natural Earth {NE_TAG}", "_files": files,
                "counties": counties, "neighbours": neighbours}
