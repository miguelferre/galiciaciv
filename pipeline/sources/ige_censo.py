"""Studies and occupation of the population of each concello, Censo 2021 (IGE tables 11253 and 11265).

* 11253: population 15+ by level of studies (4 levels), annual updates 2021-2024; the Census year 2021 is used.
* 11265: employed people by occupation (CNO, groups 1-9 plus "Non consta"), 2021-2022; 2021 is used.
The URL filters time and sex (``0:2021,1:0`` = Census year, sex Total).
"""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from . import _ige

T_STUDIES, T_OCC = 11253, 11265
YEAR = 2021
FILTER = f"0:{YEAR},1:0"
MERGED = {"15026", "15063", "36011", "36012"}
STUDIES = [
    ("primary", "Educación primaria e inferior"),
    ("lower_secondary", "Primeira etapa de Educación Secundaria e similar"),
    ("upper_secondary", "Segunda etapa de Educación Secundaria e Educación Postsecundaria non superior"),
    ("higher", "Educación superior"),
]
OCCUPATIONS = [
    ("cno1", "1 Directores e xerentes"),
    ("cno2", "2 Técnicos e profesionais científicos e intelectuais"),
    ("cno3", "3 Técnicos; profesionais de apoio"),
    ("cno4", "4 Empregados contables, administrativos e outros empregados de oficina"),
    ("cno5", "5 Traballadores dos servizos de restauración, personais, protección e vendedores"),
    ("cno6", "6 Traballadores cualificados no sector agrícola, ganadeiro, forestal e pesqueiro"),
    ("cno7", "7 Artesáns e traballadores cualificados das industrias manufactureiras e a construcción (agás operadores de instalacións e maquinaria)"),
    ("cno8", "8 Operadores de instalacións e maquinaria e montadores"),
    ("cno9", "9 Ocupacións elementais"),
    ("nc", "Non consta"),
]


def _table(rows, col, cats):
    """{code: {"cats": {key: int|None}, "total": int|None}} for sex Total, concellos and Galicia."""
    by = {}
    lookup = {label: key for key, label in cats}
    for r in rows:
        code = r["CodEspazo"].strip()
        if (code != _ige.GALICIA and _ige.concello_code(r) is None) or r["Sexo"].strip() != "Total":
            continue
        lab = r[col].strip()
        v = _ige.number(r)
        v = None if v is None else int(v)
        d = by.setdefault(code, {"cats": {k: None for k, _ in cats}, "total": None})
        if lab == "Total":
            d["total"] = v
        elif lab in lookup:
            d["cats"][lookup[lab]] = v
        else:
            raise RuntimeError(f"ige_censo: unknown label {lab!r} in column {col!r}")
    return by


class IgeCenso(Source):
    info = SourceInfo(
        id="ige_censo",
        title="Estudios y ocupación por concello (Censo 2021)",
        publisher="Instituto Galego de Estatística (IGE), a partir del Censo de población 2021 del INE",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=11253",
        license="CC BY-SA 4.0 (IGE)",
        description="Población de 15 y más años por nivel de estudios (tabla 11253, 4 niveles) y ocupados por ocupación CNO "
        "(tabla 11265, grupos 1 a 9 y no consta). Año 2021, sexo = Total. Los valores ocultos por secreto estadístico son nulos.",
        used_for=["Ciudadanos: nivel de estudios", "Ciudadanos: ocupación"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        for t in (T_STUDIES, T_OCC):
            rel = f"t{t}_{YEAR}_total.csv"
            path = self.download(_ige.url(t, FILTER), rel, force=force, expect_binary=True)
            if not _ige.has_data(path):
                self.discard(rel)
                raise RuntimeError(f"ige_censo: table {t} answered no data for filter {FILTER!r}")

    def process(self):
        p_s = self.raw_dir / f"t{T_STUDIES}_{YEAR}_total.csv"
        p_o = self.raw_dir / f"t{T_OCC}_{YEAR}_total.csv"
        for p in (p_s, p_o):
            if not p.exists():
                raise FileNotFoundError(f"{p}; run fetch first")
        studies = _table(_ige.read_rows(p_s), "Nivel de estudos", STUDIES)
        occ = _table(_ige.read_rows(p_o), "Ocupación", OCCUPATIONS)

        def entry(code):
            s, o = studies.get(code), occ.get(code)
            st = s["total"] if s else None
            hs = s["cats"]["higher"] / st if s and st and s["cats"]["higher"] is not None else None
            return {
                "studies": s["cats"] if s else {k: None for k, _ in STUDIES},
                "studies_total": st,
                "higher_share": round(hs, 4) if hs is not None else None,
                "occupation": o["cats"] if o else {k: None for k, _ in OCCUPATIONS},
                "occupation_total": o["total"] if o else None,
            }

        codes = sorted(c for c in set(studies) | set(occ) if c != _ige.GALICIA and c not in MERGED)
        out = {c: entry(c) for c in codes}
        _ige.check_count(out, "ige_censo")
        return {
            "vintage": f"IGE Censo 2021 (táboas {T_STUDIES}, {T_OCC})",
            "year": YEAR,
            "studies_levels": [{"key": k, "label": l} for k, l in STUDIES],
            "occupations": [{"key": k, "label": l} for k, l in OCCUPATIONS],
            "by_concello": out,
            "galicia": entry(_ige.GALICIA),
            "_files": [p_s.name, p_o.name],
        }
