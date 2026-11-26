"""Local business units of each concello by CNAE-09 division (IGE table 9002).

A local unit is one establishment of a company in one place: it says nothing about how many people work in it. The
table covers industry, construction and services; it leaves out the primary sector (divisions 01-03) and public
administration (84). The URL filters time only (dimension 1, ``1:<year>``): about 3.5 MB instead of 38 MB.
Section rows ("C INDUSTRIA MANUFACTUREIRA") and the three broad sectors are dropped; only the 2-digit divisions
and the total are kept.
"""

from __future__ import annotations

import re
import urllib.error
from datetime import date

from ..core.fetch import UnexpectedContentError
from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 9002
N_DIVISIONS = 81  # CNAE-09 divisions the table lists (05-96 without 01-03, 84 and unused numbers)
LABEL = re.compile(r"^(\d{2}) (.+)$")


def _rel(year: int) -> str:
    return f"t{TABLE}_{year}.csv"


class IgeUnidades(Source):
    info = SourceInfo(
        id="ige_unidades",
        title="Unidades locales por actividad (CNAE-09) y concello",
        publisher="Instituto Galego de Estatística (IGE), Directorio de empresas",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=9002",
        license="CC BY-SA 4.0 (IGE)",
        description="Número de unidades locales (establecimientos) por división CNAE-09 en cada concello (tabla 9002). "
        "Cuenta establecimientos, no empleos. No incluye el sector primario ni la administración pública.",
        used_for=["Distritos de ciudad y de concello", "Tipo de ciudad"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        for year in range(date.today().year, date.today().year - 6, -1):
            rel = _rel(year)
            try:
                path = self.download(_ige.url(TABLE, f"1:{year}"), rel, force=force, expect_binary=True)
            except (UnexpectedContentError, urllib.error.HTTPError):
                continue
            if _ige.has_data(path):
                return
            self.discard(rel)
        raise RuntimeError(f"ige_unidades: table {TABLE} has no data for the last years")

    def process(self):
        files = sorted(self.raw_dir.glob(f"t{TABLE}_*.csv"))
        if not files:
            raise FileNotFoundError(f"no cached IGE table {TABLE} in {self.raw_dir}; run fetch first")
        path = files[-1]
        year = int(path.stem.split("_")[1])
        divisions: dict[str, str] = {}
        by: dict[str, dict] = {}
        for r in _ige.read_rows(path):
            code = r["CodEspazo"].strip()
            if code != _ige.GALICIA and _ige.concello_code(r) is None:
                continue
            lab = r["CNAE 2009"].strip()
            m = LABEL.match(lab)
            if lab != "Total" and not m:
                continue
            v = _ige.number(r)
            v = None if v is None else int(v)
            d = by.setdefault(code, {"total": None, "divisions": {}})
            if lab == "Total":
                d["total"] = v
            else:
                divisions[m.group(1)] = m.group(2)
                d["divisions"][m.group(1)] = v
        galicia = by.pop(_ige.GALICIA, None)
        # The four merged concellos stay in the table with empty cells.
        out = {c: d for c, d in sorted(by.items()) if d["total"] is not None}
        _ige.check_count(out, "ige_unidades")
        if galicia is None or len(divisions) != N_DIVISIONS:
            raise RuntimeError(f"ige_unidades: {len(divisions)} divisions (expected {N_DIVISIONS}) or no Galicia row")
        return {
            "vintage": f"IGE Directorio de empresas, unidades locais {year} (táboa {TABLE})",
            "year": year,
            "divisions": dict(sorted(divisions.items())),
            "by_concello": out,
            "galicia": galicia,
            "_files": [path.name],
        }
