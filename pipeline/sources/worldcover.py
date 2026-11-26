import json

from ..core.source import Source, SourceInfo

FILE = "cover_grid.json"


class WorldCover(Source):
    """Land-cover grid prepared by tools/prep_raster.py (needs rasterio). Classes are already mapped to the NLCD
    codes that world.py uses (mapping stored in the interim as "mapping")."""

    info = SourceInfo(
        id="worldcover",
        title="ESA WorldCover 2021 v200 (cobertura del suelo a 10 m)",
        publisher="European Space Agency (ESA) / Copernicus",
        homepage="https://esa-worldcover.org/",
        license="CC BY 4.0 (ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data)",
        description="Cobertura del suelo a 10 m leída de las teselas S3 públicas mediante vistas reducidas y muestreada cada ~0,2 km. "
        "Arbolado, matorral, pastizal, cultivos, suelo construido, suelo desnudo, agua y humedal se asignan a las clases de cobertura del juego.",
        used_for=["Cobertura del suelo de cada hexágono (biomas)", "Proporciones de bosque, cultivo y suelo construido"],
    )

    def fetch(self, force=False):
        if not (self.raw_dir / FILE).exists():
            raise FileNotFoundError(
                f"{self.raw_dir / FILE} missing - run: uv run --with rasterio --with numpy python tools/prep_raster.py cover"
            )

    def process(self):
        d = json.loads((self.raw_dir / FILE).read_text())
        d["_files"] = [FILE]
        return d
