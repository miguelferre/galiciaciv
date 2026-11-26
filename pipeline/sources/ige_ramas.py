"""Share of Social Security affiliations by branch of activity (rama) in each concello, IGE table 10058.

Percent (0-100) of the affiliations of the concello. The table has annual data 2011-2024; the newest year is
used (URL filter ``0:<year>``). The four pre-merger concellos are empty and dropped.
"""

from __future__ import annotations

from datetime import date

from ..core.source import Source, SourceInfo
from . import _ige

TABLE = 10058
# key (short, ascii) -> exact label of the table
RAMAS = [
    ("agricultura", "Agricultura, gandería e silvicultura"),
    ("pesca", "Pesca e acuicultura"),
    ("extractivas", "Industrias extractivas e fabricación doutros produtos minerais non metálicos"),
    ("agroalimentaria", "Industria agroalimentaria"),
    ("madeira", "Madeira, papel e mobles"),
    ("metalurxia", "Metalurxia e produtos metálicos, electrónicos, eléctricos e maquinaria"),
    ("transporte_ind", "Fabricación de material de transporte e grandes reparacións industriais"),
    ("resto_industria", "Resto da industria"),
    ("enerxia", "Enerxía, subministración de auga e xestión de residuos"),
    ("construcion", "Construción"),
    ("comercio", "Comercio, transporte e hostalería"),
    ("info_financeiro", "Actividades de información, financeiros, inmobiliarios e profesionais"),
    ("aapp", "AAPP, Educación, Sanidade e outros servizos"),
]
BY_LABEL = {l: k for k, l in RAMAS}


class IgeRamas(Source):
    info = SourceInfo(
        id="ige_ramas",
        title="Afiliación a la Seguridad Social por rama de actividad (porcentaje por concello)",
        publisher="Instituto Galego de Estatística (IGE), a partir de la Seguridade Social",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=10058",
        license="CC BY-SA 4.0 (IGE)",
        description="Porcentaje de afiliaciones por rama de actividad (13 ramas, agrupación propia del IGE) y concello. "
        "Se usa el último año disponible.",
        used_for=["Ciudadanos: ocupación por rama", "Detalle sectorial por concello"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        for y in range(date.today().year, date.today().year - 6, -1):
            rel = f"t{TABLE}_{y}.csv"
            try:
                path = self.download(_ige.url(TABLE, f"0:{y}"), rel, force=force, expect_binary=True)
            except Exception as exc:  # a missing year may answer a redirect or an HTML page
                print(f"      {y}: {exc}")
                continue
            if _ige.has_data(path):
                return
            self.discard(rel)
        raise RuntimeError("ige_ramas: no recent year has data")

    def process(self):
        year, path = _ige.cached_latest(self, TABLE)
        by: dict[str, dict] = {}
        gal: dict[str, float] = {}
        for r in _ige.read_rows(path):
            lab = r["Rama de actividade"].strip()
            if lab not in BY_LABEL:
                raise RuntimeError(f"ige_ramas: unknown rama {lab!r}")
            k, v, code = BY_LABEL[lab], _ige.number(r), r["CodEspazo"].strip()
            if code == _ige.GALICIA:
                if v is not None:
                    gal[k] = v
            elif _ige.concello_code(r):
                by.setdefault(code, {kk: None for kk, _ in RAMAS})[k] = v
        out = {c: d for c, d in by.items() if any(v is not None for v in d.values())}
        _ige.check_count(out, "ige_ramas")
        return {
            "vintage": f"IGE afiliacións SS por rama de actividade {year} (táboa {TABLE})",
            "year": int(year),
            "ramas": [{"key": k, "label": l} for k, l in RAMAS],
            "by_concello": out,
            "galicia": gal,
            "_files": [path.name],
        }
