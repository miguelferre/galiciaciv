"""PIB (GDP) by concello, IGE table 9958 (statistical revision 2024)."""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 9958
UNIT = "Miles de euros"


class IgePib(Source):
    info = SourceInfo(
        id="ige_pib",
        title="Produto interior bruto por concello",
        publisher="Instituto Galego de Estatística (IGE)",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=9958",
        license="CC BY-SA 4.0 (IGE)",
        description="Producto interior bruto a precios corrientes de cada concello, en miles de euros "
        "en la fuente y guardado aquí en euros. Faltan los concellos anteriores a las fusiones.",
        used_for=["Rendimiento de Oro (PIB)"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        _ige.fetch_latest(self, TABLE, 0, "year", force=force)

    def process(self):
        year, path = _ige.cached_latest(self, TABLE)
        rows = [r for r in _ige.read_rows(path) if r["Unidade"].strip() == UNIT]
        if not rows:
            raise RuntimeError(f"ige_pib: no {UNIT!r} rows in {path.name}")
        by = {c: int(round(v * 1000)) for c, v in _ige.concello_values(rows).items()}
        _ige.check_count(by, "ige_pib")
        total = int(round(_ige.galicia_total(rows) * 1000))
        return {
            "vintage": f"IGE PIB por concello {year}",
            "year": int(year),
            "unit": "euros",
            "galicia_total": total,
            "concellos_sum": sum(by.values()),
            "by_concello": by,
            "_files": [path.name],
        }
