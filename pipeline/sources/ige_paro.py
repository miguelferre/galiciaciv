"""Registered unemployment (paro rexistrado) by concello, sector and sex, IGE table 742 (SISPE)."""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 742
# Raw sector label (matched by prefix) -> key. "Sen emprego anterior" = no previous job.
SECTORS = {"Paro total": "total", "Agricultura": "agro", "Industria": "industria", "Construci": "construcion",
           "Servizos": "servizos", "Sen emprego": "sen_emprego_anterior"}


def _key(label: str):
    for k, v in SECTORS.items():
        if label.startswith(k):
            return v
    return None


class IgeParo(Source):
    info = SourceInfo(
        id="ige_paro",
        title="Paro registrado por concello y sector",
        publisher="Instituto Galego de Estatística (IGE), from SISPE",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=742",
        license="CC BY-SA 4.0 (IGE)",
        description="Parados registrados por concello, con periodicidad mensual, por sector de la actividad anterior, para ambos "
        "sexos (la tabla también separa hombres y mujeres). Se usa el último mes disponible.",
        used_for=["Lente de paro"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        _ige.fetch_latest(self, TABLE, 0, "month", force=force)

    def process(self):
        period, path = _ige.cached_latest(self, TABLE)
        rows = [r for r in _ige.read_rows(path) if r["Sexo"].strip() == "Total"]
        gal: dict[str, int] = {}
        by: dict[str, dict] = {}
        for r in rows:
            k = _key(r["Sector de actividade"].strip())
            if k is None:
                raise RuntimeError(f"ige_paro: unknown sector {r['Sector de actividade']!r}")
            if r["CodEspazo"].strip() == _ige.GALICIA and _ige.number(r) is not None:
                gal[k] = int(_ige.number(r))
        for k in SECTORS.values():
            for c, v in _ige.concello_values(rows, lambda r, k=k: _key(r["Sector de actividade"].strip()) == k).items():
                by.setdefault(c, {})[k] = int(v)
        _ige.check_count(by, "ige_paro")
        # Known gap: SISPE reports 0 for the merged concellos Oza-Cesuras (15902) and Cerdedo-Cotobade
        # (36902) while the province rows still include their unemployed. Reported, not repaired.
        prov = {r["CodEspazo"].strip(): int(_ige.number(r)) for r in rows
                if r["Sector de actividade"].startswith("Paro total") and r["CodEspazo"].strip() in _ige.PROVINCES}
        unassigned = {p: prov[p] - sum(d.get("total", 0) for c, d in by.items() if c[:2] == p) for p in prov}
        zero_total = sorted(c for c, d in by.items() if d.get("total") == 0)
        sums = {k: sum(d.get(k, 0) for d in by.values()) for k in SECTORS.values()}
        return {
            "vintage": f"IGE paro rexistrado {period[:4]}-{period[4:]} (SISPE)",
            "period": period,
            "unit": "persons",
            "sectors": list(SECTORS.values()),
            "galicia_total": gal,
            "concellos_sum": sums,
            "unassigned_by_province": unassigned,
            "zero_total_concellos": zero_total,
            "by_concello": by,
            "_files": [path.name],
        }
