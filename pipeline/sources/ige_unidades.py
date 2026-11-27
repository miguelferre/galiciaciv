"""Local business units of each concello by CNAE-09 division (IGE table 9002).

A local unit is one establishment of a company in one place: it says nothing about how many people work in it. The
table covers industry, construction and services; it leaves out the primary sector (divisions 01-03) and public
administration (84). The URL filters time only (dimension 1, ``1:<year>``): about 3.5 MB instead of 38 MB.
Section rows ("C INDUSTRIA MANUFACTUREIRA") and the three broad sectors are dropped; only the 2-digit divisions
and the total are kept.

The series covers FIRST_YEAR..latest (2014-2024 at the time of writing; the IGE answers empty before). The top-level keys
(`year`, `divisions`, `by_concello`, `galicia`) describe the latest year only and are the contract the builders read;
`series` adds every year: per concello and for Galicia, a list of totals and one list per division, aligned with
`series["years"]`, with `None` where the cell is empty (statistical secrecy, or a concello that did not exist that year).
"""

from __future__ import annotations

import re
import urllib.error
from datetime import date

from ..core.fetch import UnexpectedContentError
from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 9002
FIRST_YEAR = 2014  # earliest year with data (probed 2026-11-27: 2013 answers empty)
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
        description="Número de unidades locales (establecimientos) por división CNAE-09 en cada concello (tabla 9002), "
        "serie 2014 a 2024. Cuenta establecimientos, no empleos. No incluye el sector primario ni la administración pública.",
        used_for=["Distritos de ciudad y de concello", "Tipo de ciudad", "Formación profesional: peso y tendencia de cada familia"],
    )

    def _get(self, year: int, force: bool) -> bool:
        rel = _rel(year)
        try:
            path = self.download(_ige.url(TABLE, f"1:{year}"), rel, force=force, expect_binary=True)
        except (UnexpectedContentError, urllib.error.HTTPError):
            return False
        if _ige.has_data(path):
            return True
        self.discard(rel)
        return False

    def fetch(self, force=False):
        if self.offline:
            return
        latest = next((y for y in range(date.today().year, date.today().year - 6, -1) if self._get(y, force)), None)
        if latest is None:
            raise RuntimeError(f"ige_unidades: table {TABLE} has no data for the last years")
        for year in range(latest - 1, FIRST_YEAR - 1, -1):
            if not self._get(year, force):
                raise RuntimeError(f"ige_unidades: table {TABLE} has no data for {year} (series {FIRST_YEAR}-{latest})")

    @staticmethod
    def _read(path):
        """({division: name}, {code: {"total", "divisions"}}) of one year's file; code 12 = Galicia."""
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
        return divisions, by

    def process(self):
        files = sorted(self.raw_dir.glob(f"t{TABLE}_*.csv"))
        if not files:
            raise FileNotFoundError(f"no cached IGE table {TABLE} in {self.raw_dir}; run fetch first")
        path = files[-1]
        year = int(path.stem.split("_")[1])
        divisions, by = self._read(path)
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
            "series": self._series(files, divisions),
            "_files": [f.name for f in files],
        }

    def _series(self, files, divisions):
        """Every cached year: {"years": [...], "galicia": S, "by_concello": {code: S}}, S = {"total": [...], "divisions": {div: [...]}}.
        A concello that has no row or an empty cell in a year gets None there (the 2013 and 2016 mergers change the code set)."""
        years, data = [], []
        for f in files:
            years.append(int(f.stem.split("_")[1]))
            data.append(self._read(f)[1])
        codes = sorted({c for by in data for c in by})

        def build(code):
            rows = [by.get(code) for by in data]
            return {"total": [r["total"] if r else None for r in rows],
                    "divisions": {dv: [r["divisions"].get(dv) if r else None for r in rows] for dv in sorted(divisions)}}

        return {"years": years, "galicia": build(_ige.GALICIA),
                "by_concello": {c: build(c) for c in codes if c != _ige.GALICIA}}
