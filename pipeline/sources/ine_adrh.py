"""Atlas de Distribución de Renta de los Hogares (INE), municipal layer "t" (year 2024).

ArcGIS MapServer layer 0 ("ADRH_municipios_t"), filtered to CCA = 12 (Galicia). Each row is
one municipality (CUMUN = 5-digit INE code) with 16 numbered indicators (datoN / indicadorN
/ unidadN). Only four are used here, and each is checked by its published name:

    dato1  "Renta neta media por persona"      Euros
    dato2  "Renta neta media por hogar"        Euros
    dato9  "Índice de Gini"                    Número (published scale, 0-100)
    dato16 "Distribución de la renta P80/P20"  Número

A 200 answer with {"error": ...}, a truncated page (exceededTransferLimit) or the wrong
number of concellos is never kept in the cache.
"""

from __future__ import annotations

import json

from ..core.fetch import UnexpectedContentError
from ..core.source import Source, SourceInfo
from . import _ige

URL = (
    "https://www.ine.es/servergis/rest/services/ws/ADRH_atlas_de_distribucion_de_renta_de_los_hogares"
    "/MapServer/0/query?where=CCA%3D%2712%27&outFields=*&returnGeometry=false&f=json&resultRecordCount=2000"
)
REL = "adrh_municipios_t_galicia.json"

# interim field -> (datoN index, published indicator name, unit)
FIELDS = {
    "net_income_pc": (1, "Renta neta media por persona", "Euros"),
    "net_income_hh": (2, "Renta neta media por hogar", "Euros"),
    "gini": (9, "Índice de Gini", "Número"),
    "p80p20": (16, "Distribución de la renta P80/P20", "Número"),
}


def _load(path) -> list[dict]:
    """Attributes of every row of the cached answer; raises if it is not a complete Galicia layer."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise UnexpectedContentError(f"{path.name}: not JSON ({exc})") from exc
    if not isinstance(data, dict) or "error" in data:
        raise UnexpectedContentError(f"{path.name}: service error {data.get('error') if isinstance(data, dict) else data!r}")
    if data.get("exceededTransferLimit"):
        raise UnexpectedContentError(f"{path.name}: exceededTransferLimit, the answer is truncated")
    rows = [f["attributes"] for f in data.get("features", [])]
    codes = [r.get("CUMUN") for r in rows]
    if len(set(codes)) != len(codes):
        raise UnexpectedContentError(f"{path.name}: repeated CUMUN codes")
    for code in codes:
        if not (isinstance(code, str) and len(code) == 5 and code.isdigit() and code[:2] in _ige.PROVINCES):
            raise UnexpectedContentError(f"{path.name}: unexpected CUMUN {code!r}")
    if len(rows) != _ige.N_CONCELLOS or not {"15902", "36902"} <= set(codes):
        raise UnexpectedContentError(f"{path.name}: {len(rows)} concellos, expected {_ige.N_CONCELLOS} (with 15902 and 36902)")
    for field, (i, name, unit) in FIELDS.items():
        for r in rows:
            if r.get(f"dato{i}") is not None and (r.get(f"indicador{i}"), r.get(f"unidad{i}")) != (name, unit):
                raise UnexpectedContentError(
                    f"{path.name}: {r['CUMUN']} dato{i} is {r.get(f'indicador{i}')!r} [{r.get(f'unidad{i}')}], expected {name!r} [{unit}] ({field})"
                )
    return rows


class IneAdrh(Source):
    info = SourceInfo(
        id="ine_adrh",
        title="Atlas de Distribución de Renta de los Hogares (ADRH), por municipio",
        publisher="Instituto Nacional de Estadística (INE)",
        homepage="https://www.ine.es/dyngs/INEbase/operacion.htm?c=Estadistica_C&cid=1254736177088&menu=ultiDatos&idp=1254735976608",
        license="INE, reutilización con cita de la fuente",
        description="Renta neta media por persona y por hogar (euros), índice de Gini (escala publicada, 0-100) "
        "y razón P80/P20 de cada concello gallego, año 2024. Capa municipal del servicio ArcGIS del INE.",
        used_for=["Rendimiento de Oro (renta)", "Desigualdad (Gini y P80/P20)"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        path = self.download(URL, REL, force=force)
        try:
            _load(path)
        except UnexpectedContentError:
            self.discard(REL)
            raise

    def process(self):
        path = self.raw_dir / REL
        if not path.exists():
            raise FileNotFoundError(f"ine_adrh: {path} is not cached; run fetch first")
        rows = _load(path)
        years = {r.get("periodo") for r in rows}
        if len(years) != 1 or not next(iter(years)):
            raise RuntimeError(f"ine_adrh: inconsistent periodo values {sorted(map(str, years))}")
        year = int(next(iter(years)))
        by = {}
        for r in sorted(rows, key=lambda r: r["CUMUN"]):
            by[r["CUMUN"]] = {
                field: (float(r[f"dato{i}"]) if r.get(f"dato{i}") is not None else None)
                for field, (i, _name, _unit) in FIELDS.items()
            }
        return {
            "vintage": f"INE ADRH {year}",
            "year": year,
            "by_concello": by,
            "_files": [REL],
        }
