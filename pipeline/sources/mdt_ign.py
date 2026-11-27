import json

from ..core.source import Source, SourceInfo

FILE = "relief_grid.json"
VINTAGE = "IGN MDT 200 m (tierra, España) + ETOPO1 (mar y Portugal) interpolado a los píxeles del MDT (~0,15 x 0,20 km)"


class MdtIgn(Source):
    """Relief points prepared by tools/prep_raster.py (needs rasterio, so it lives outside the stdlib pipeline)."""

    info = SourceInfo(
        id="mdt_ign",
        title="Modelo Digital del Terreno 200 m (+ ETOPO1 para el mar y Portugal)",
        publisher="Instituto Geográfico Nacional (IGN/CNIG); NOAA NCEI (ETOPO1)",
        homepage="https://servicios.idee.es/wcs-inspire/mdt",
        license="CC BY 4.0 (IGN, CNIG): «Obra derivada de MDT200 2015 CC-BY 4.0 ign.es»; ETOPO1 (NOAA) de uso libre",
        description="Altitud del terreno del MDT del IGN (cobertura WCS Elevacion4258_200), muestreada cada ~0,15 x 0,20 km, "
        "más ETOPO1, interpolado a esa misma rejilla, donde el MDT no tiene datos (fondo marino y Portugal). La clase de relieve de cada hexágono sale de la "
        "media y la rugosidad de sus muestras de tierra.",
        used_for=["Relieve (colinas, montañas)", "Sombreado del relieve", "Profundidad del mar"],
    )

    def fetch(self, force=False):
        if not (self.raw_dir / FILE).exists():
            raise FileNotFoundError(
                f"{self.raw_dir / FILE} missing - run: uv run --with rasterio --with numpy python tools/prep_raster.py relief"
            )

    def process(self):
        d = json.loads((self.raw_dir / FILE).read_text())
        keys = ("x0", "dx", "y0", "dy", "cols", "rows")  # a lon/lat grid; (x0, y0) = centre of the first pixel
        return {"vintage": VINTAGE, "_files": [FILE], **{k: d[k] for k in keys}}
