"""Social Security affiliates by concello of residence and sector, IGE table 11497 (CNAE-2025)."""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 11497
# Raw label (latin-1 decoded; the accented one is matched by prefix) -> key
SECTORS = {"Agricultura e pesca": "agro", "Industria": "industria", "Construci": "construcion",
           "Servizos": "servizos", "Total": "total"}


def _key(label: str):
    for k, v in SECTORS.items():
        if label.startswith(k):
            return v
    return None


class IgeAfiliacion(Source):
    info = SourceInfo(
        id="ige_afiliacion",
        title="Afiliados a la Seguridad Social por concello y sector",
        publisher="Instituto Galego de Estatística (IGE), a partir de la Seguridade Social",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=11497",
        license="CC BY-SA 4.0 (IGE)",
        description="Afiliados por concello de residencia, con periodicidad mensual, por sector (Agricultura e pesca, Industria, "
        "Construción, Servizos, Total). Se usa el último mes disponible.",
        used_for=["Rendimiento de Alimento (agricultura y pesca)", "Rendimiento de Producción (industria + construcción)"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        _ige.fetch_latest(self, TABLE, 0, "month", force=force)

    def process(self):
        period, path = _ige.cached_latest(self, TABLE)
        rows = _ige.read_rows(path)
        by: dict[str, dict] = {}
        gal: dict[str, int] = {}
        for r in rows:
            k = _key(r["Sector de actividade"].strip())
            if k is None:
                raise RuntimeError(f"ige_afiliacion: unknown sector {r['Sector de actividade']!r}")
            if r["CodEspazo"].strip() == _ige.GALICIA and _ige.number(r) is not None:
                gal[k] = int(_ige.number(r))
        for k in SECTORS.values():
            for c, v in _ige.concello_values(rows, lambda r, k=k: _key(r["Sector de actividade"].strip()) == k).items():
                by.setdefault(c, {})[k] = int(v)
        _ige.check_count(by, "ige_afiliacion")
        sums = {k: sum(d.get(k, 0) for d in by.values()) for k in SECTORS.values()}
        return {
            "vintage": f"IGE afiliacións SS {period[:4]}-{period[4:]} (CNAE-2025)",
            "period": period,
            "unit": "affiliates",
            "sectors": list(SECTORS.values()),
            "galicia_total": gal,
            "concellos_sum": sums,
            "by_concello": by,
            "_files": [path.name],
        }
