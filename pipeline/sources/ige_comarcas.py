import csv
import io

from ..core.source import Source, SourceInfo

TABLE = 2246
URL = f"https://www.ige.gal/igebdt/igeapi/csv/datos/{TABLE}"
FILE = f"ige_{TABLE}_concellos_comarcas.csv"


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252")


class IgeComarcas(Source):
    info = SourceInfo(
        id="ige_comarcas",
        title="Relación de provincias, concellos e comarcas galegas (IGE, táboa 2246)",
        publisher="Instituto Galego de Estatística (IGE)",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=2246&idioma=gl",
        license="CC BY-SA 4.0 (IGE)",
        description="A cuál de las 53 comarcas pertenece cada uno de los 313 concellos (fecha de referencia: 1 de enero de 2017, "
        "la división comarcal oficial). En el juego, una comarca hace el papel de un estado.",
        used_for=["Comarca (estado) de cada hexágono", "Nombres de las comarcas y provincias"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force)

    def process(self):
        text = _decode((self.raw_dir / FILE).read_bytes())
        rows: dict[str, dict[str, str]] = {}
        for var, space, _name, _n, t in list(csv.reader(io.StringIO(text)))[1:]:
            if len(space) != 5:  # skip province / Galicia rows
                continue
            key = {"Código da provincia": "prov", "Código da comarca": "com", "Nome da comarca": "name",
                   "Nome da provincia": "prov_name"}.get(var)
            if key:
                rows.setdefault(space, {})[key] = t.strip()
        # The table lists 317 codes: the 313 current concellos plus the 4 that merged in 2013 and 2016 (Cesuras,
        # Oza dos Ríos, Cerdedo, Cotobade). The world builder only looks up the 313 that the IGN draws.
        if len(rows) < 313:
            raise ValueError(f"expected at least 313 concellos in IGE table {TABLE}, found {len(rows)}")
        comarcas: dict[str, dict] = {}
        concellos = {}
        for geoid in sorted(rows):
            r = rows[geoid]
            code = r["prov"] + r["com"]  # comarca numbers restart in each province
            comarcas.setdefault(code, {"code": code, "name": r["name"], "province": r["prov_name"], "province_code": r["prov"]})
            concellos[geoid] = code
        if len(comarcas) != 53:
            raise ValueError(f"expected 53 comarcas, found {len(comarcas)}")
        return {"vintage": "IGE tabla 2246 (1 de enero de 2017)", "_files": [FILE],
                "comarcas": sorted(comarcas.values(), key=lambda c: c["code"]), "concellos": concellos}
