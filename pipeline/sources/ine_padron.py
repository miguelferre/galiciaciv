"""Padrón municipal: official population figures at 1 January, by concello.

INE table 29005 (servicios.ine.es Tempus API) returns names, not municipality codes,
for all of Spain (5.6 MB). The IGE republishes the same INE padrón (table 589,
"Cifras oficiais da poboación a 1 de xaneiro") with the 5-digit INE code, so that is
used here. The IGE table 589 gives the Galicia total, which this source checks.
"""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 589


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
        _ige.fetch_latest(self, TABLE, 1, "year", force=force)

    def process(self):
        year, path = _ige.cached_latest(self, TABLE)
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
            raise RuntimeError(f"ine_padron: concellos sum {sum(by.values())} != Galicia {total}")
        return {
            "vintage": f"INE padrón, 1 de enero de {year} (vía IGE 589)",
            "year": int(year),
            "unit": "persons",
            "galicia_total": total,
            "by_concello": by,
            "_files": [path.name],
        }
