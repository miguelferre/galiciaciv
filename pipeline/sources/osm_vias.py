"""Autopistas, autovías, vías rápidas y ferrocarril de Galicia desde OpenStreetMap (Overpass API).

Una consulta de Galicia entera da 502, así que la ventana se pide en 3 x 3 cajas pequeñas. Una vía que cruza dos
cajas llega dos veces: se quita la repetida por su id.
"""

import json
import urllib.parse

from ..core.source import Source, SourceInfo

OVERPASS = "https://overpass-api.de/api/interpreter"
BBOX = (41.7, -9.5, 43.9, -6.6)  # sur, oeste, norte, este (orden de Overpass): Galicia y un margen
SPLIT = 3
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)", "Accept": "*/*"}
# Sin vías de servicio (apartaderos, depósitos) ni usos que no son de red: industrial, militar, turístico.
QUERY = ('way["highway"~"^(motorway|trunk)$"];'
         'way["railway"~"^(rail|narrow_gauge)$"][!"service"]["usage"!~"^(industrial|military|tourism|test)$"];')
KEEP = ("highway", "railway", "ref", "name", "usage", "highspeed", "toll")


def _boxes():
    s, w, n, e = BBOX
    dy, dx = (n - s) / SPLIT, (e - w) / SPLIT
    for i in range(SPLIT):
        for j in range(SPLIT):
            yield f"{i}{j}", (round(s + i * dy, 4), round(w + j * dx, 4), round(s + (i + 1) * dy, 4),
                              round(w + (j + 1) * dx, 4))


class OsmVias(Source):
    info = SourceInfo(
        id="osm_vias",
        title="Vías y ferrocarril de OpenStreetMap",
        publisher="OpenStreetMap contributors",
        homepage="https://www.openstreetmap.org/copyright",
        license="ODbL 1.0 (atribución «© colaboradores de OpenStreetMap»)",
        description="Vías `highway=motorway|trunk` y `railway=rail|narrow_gauge` (sin vías de servicio ni usos "
        "industrial, militar, turístico o de pruebas), pedidas a la API Overpass para Galicia y un margen "
        "(lat 41,7 a 43,9; lon -9,5 a -6,6).",
        used_for=["Autopistas, autovías y vías rápidas del mapa", "Ferrocarril del mapa"],
    )

    def _path(self, key):
        return f"vias-{key}.json"

    def fetch(self, force=False):
        for key, (s, w, n, e) in _boxes():
            query = f"[out:json][timeout:180][bbox:{s},{w},{n},{e}];({QUERY});out tags geom;"
            url = f"{OVERPASS}?data={urllib.parse.quote(query)}"
            p = self.download(url, self._path(key), force=force, headers=HEADERS)
            # Overpass contesta 200 con un `remark` si se pasa del tiempo o de memoria: no se cachea un resultado cortado.
            if json.loads(p.read_text(encoding="utf-8")).get("remark"):
                self.discard(self._path(key))
                raise RuntimeError(f"Overpass devolvió un aviso en la caja {key}; vuelve a intentarlo más tarde")

    def process(self):
        ways, stamps, files = {}, [], []
        for key, _ in _boxes():
            files.append(self._path(key))
            doc = json.loads((self.raw_dir / self._path(key)).read_text(encoding="utf-8"))
            stamps.append(doc.get("osm3s", {}).get("timestamp_osm_base", ""))
            for el in doc["elements"]:
                if el["type"] == "way" and "geometry" in el:
                    ways[el["id"]] = {
                        "id": el["id"],
                        **{k: v for k, v in el.get("tags", {}).items() if k in KEEP},
                        "line": [(round(g["lon"], 5), round(g["lat"], 5)) for g in el["geometry"]],
                    }
        day = max(stamps)[:10]
        return {"vintage": f"OpenStreetMap vía Overpass, base de {day}", "_files": files,
                "ways": [ways[k] for k in sorted(ways)]}
