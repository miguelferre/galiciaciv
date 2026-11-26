"""Padrón municipal: official population figures at 1 January, by concello.

INE table 29005 (servicios.ine.es Tempus API) returns names, not municipality codes,
for all of Spain (5.6 MB). The IGE republishes the same INE padrón (table 589,
"Cifras oficiais da poboación a 1 de xaneiro") with the 5-digit INE code, so that is
used here. The IGE table 589 gives the Galicia total, which this source checks.

The series: the same table for every year from SERIES_FROM to the latest year (one file per year,
about 40 KB each). pipeline/build/growth.py turns it into growth = pop(latest) / pop(SERIES_FROM) - 1.
"""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 589
SERIES_FROM = 2021  # the growth baseline (pipeline/build/growth.py BASELINE_YEAR)


def _year_counts(path) -> tuple[dict[str, int], int]:
    """{concello code: population} and the Galicia total of one cached year (sex = Total)."""
    rows = [r for r in _ige.read_rows(path) if r["Sexo"].strip() == "Total"]
    by = {}
    for r in rows:
        c = _ige.concello_code(r)
        # The IGE keeps the 4 concellos that merged (15026, 15063, 36011, 36012) with empty values.
        if c and _ige.number(r) is not None:
            by[c] = int(_ige.number(r))
    _ige.check_count(by, "ine_padron")
    total = int(_ige.galicia_total(rows))
    if sum(by.values()) != total:
        raise RuntimeError(f"ine_padron: concellos sum {sum(by.values())} != Galicia {total} ({path.name})")
    return by, total


class InePadron(Source):
    info = SourceInfo(
        id="ine_padron",
        title="Padrón municipal: población por concello",
        publisher="INE (Padrón municipal de habitantes), distribuido por el IGE",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=589",
        license="CC BY-SA 4.0 (IGE); datos del INE, citar la fuente",
        description="Cifras oficiales de población a 1 de enero de cada uno de los 313 concellos de Galicia "
        "(ambos sexos), del padrón del INE a través de la API de datos abiertos del IGE.",
        used_for=["Población", "Demanda de alimento y mano de obra"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        latest = int(_ige.fetch_latest(self, TABLE, 1, "year", force=force))
        for y in range(SERIES_FROM, latest):
            rel = _ige.rel_name(TABLE, str(y))
            path = self.download(_ige.url(TABLE, f"1:{y}"), rel, force=force, expect_binary=True)
            if not _ige.has_data(path):
                self.discard(rel)
                raise RuntimeError(f"ine_padron: IGE 589 has no data for {y}")

    def process(self):
        year, path = _ige.cached_latest(self, TABLE)
        year = int(year)
        by, total = _year_counts(path)
        series, galicia_series, files = {}, {}, []
        for y in range(SERIES_FROM, year + 1):
            p = self.raw_dir / _ige.rel_name(TABLE, str(y))
            if not p.exists():
                raise FileNotFoundError(f"ine_padron: no cached {p.name}; run fetch")
            counts, tot = (by, total) if y == year else _year_counts(p)
            for c, v in counts.items():
                series.setdefault(c, {})[str(y)] = v
            galicia_series[str(y)] = tot
            files.append(p.name)
        return {
            "vintage": f"INE padrón, 1 de enero de {year}; serie {SERIES_FROM}-{year} (vía IGE 589)",
            "year": year,
            "unit": "persons",
            "galicia_total": total,
            "by_concello": by,
            "series_years": list(range(SERIES_FROM, year + 1)),
            "series_by_concello": series,
            "galicia_series": galicia_series,
            "_files": files,
        }
