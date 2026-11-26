from ..core.geo import bbox_intersects, geojson_lines, geojson_rings, load_geojson
from ..core.source import Source, SourceInfo

# Pinned to a release tag so the content (and sha256) cannot change under the same URL.
TAG = "v5.1.2"
BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{TAG}/geojson"
BBOX = (-10.8, 40.6, -5.2, 44.8)  # lon/lat window around Galicia and the map margin


class NaturalEarth(Source):
    info = SourceInfo(
        id="natural_earth",
        title="Natural Earth 1:50m (lagos y ríos)",
        publisher="Natural Earth",
        homepage="https://www.naturalearthdata.com/",
        license="Dominio público",
        description="Lagos y ríos principales a escala 1:50m (también se leen los países, pero ya no se usan: los vecinos "
        "salen de ign_limites). En la ventana de Galicia no aporta ningún lago ni río al mapa actual. "
        f"Los ficheros están fijados a la versión {TAG} de natural-earth-vector.",
        used_for=["Lagos (ninguno en la ventana)", "Ríos (ninguno en el mapa actual)"],
    )

    FILES = ["ne_50m_admin_0_countries", "ne_50m_lakes", "ne_50m_rivers_lake_centerlines"]

    def _path(self, name):
        return f"{TAG}/{name}.geojson"

    def fetch(self, force=False):
        for name in self.FILES:
            self.download(f"{BASE}/{name}.geojson", self._path(name), force=force)

    def _features(self, name):
        return load_geojson(self.raw_dir / self._path(name))

    def process(self):
        # Every non-US country with land in the window (Canada, Mexico, Cuba, the Bahamas, Bermuda...),
        # keeping only its rings there, so foreign coasts inside the map are land rather than sea.
        countries = []
        for f in self._features("ne_50m_admin_0_countries"):
            if f["properties"].get("ADM0_A3") == "ESP":  # Spain is drawn from IGN (see ign_limites)
                continue
            rings = [r for r in geojson_rings(f["geometry"]) if bbox_intersects(r, BBOX)]
            if rings:
                countries.append({"name": f["properties"]["ADMIN"], "rings": rings})
        lakes = []
        for f in self._features("ne_50m_lakes"):
            rings = geojson_rings(f["geometry"])
            if rings and bbox_intersects(rings[0], BBOX):
                lakes.append({"name": f["properties"].get("name"), "rings": rings})
        rivers = []
        for f in self._features("ne_50m_rivers_lake_centerlines"):
            p = f["properties"]
            for line in geojson_lines(f["geometry"]):
                if bbox_intersects(line, BBOX):
                    rivers.append(
                        {"name": p.get("name"), "rank": p.get("scalerank", 10), "featurecla": p.get("featurecla"), "line": line}
                    )
        return {
            "vintage": f"Natural Earth {TAG} (1:50m)",
            "_files": [self._path(n) for n in self.FILES],
            "countries": countries,
            "lakes": lakes,
            "rivers": rivers,
        }

