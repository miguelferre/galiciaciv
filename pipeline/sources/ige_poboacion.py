"""Population of every concello by age, nationality, place of birth and mean age (IGE tables 144, 143 and 723).

* 144: padron by 5-year age group x nationality (Total / Española / Estranxeira) x sex. Table 144 weighs 27 MB
  whole, so the URL filters time and sex (``0:<year>,1:0`` = one year, sex Total): about 2 MB.
* 143: place of birth (same concello, rest of the province, other province of Galicia, other community, abroad).
* 723: demographic indicators; "Idade media no 1 de xaneiro" is the official mean age (padron).

A wrong filter answers HTTP 200 with an empty body, so every file is checked with ``_ige.has_data``.
"""

from __future__ import annotations

import urllib.error
from datetime import date

from ..core.fetch import UnexpectedContentError
from ..core.source import Source, SourceInfo
from . import _ige

T_AGE, T_BIRTH, T_IND = 144, 143, 723
FILTERS = {T_AGE: "0:{y},1:0", T_BIRTH: "0:{y},1:0", T_IND: "0:{y},1:0,2:2"}
AGE_GROUPS = [f"{a}-{a + 4}" for a in range(0, 100, 5)] + ["100+"]
RAW_AGE = {"100 e máis": "100+"}  # label in the CSV -> key
MID = {g: float(g.split("-")[0]) + 2.5 for g in AGE_GROUPS[:-1]}
MID["100+"] = 102.5  # assumption for the open group: 100 + 2.5, the width of a quinquennial group
NATIONALITY = {"Española": "spanish", "Estranxeira": "foreign"}
BIRTH = {"No concello de residencia": "same_concello", "Noutro concello da mesma provincia": "same_province",
         "Noutra provincia de Galicia": "other_province", "Noutra comunidade autónoma": "other_ccaa",
         "No estranxeiro": "abroad"}
MEAN_AGE_LABEL = "Idade media no 1 de xaneiro"
MERGED = {"15026", "15063", "36011", "36012"}


def _rel(table: int, year: int) -> str:
    return f"t{table}_{year}_total.csv"


def _fetch_table(src, table: int, year: int, force: bool) -> bool:
    rel = _rel(table, year)
    try:
        path = src.download(_ige.url(table, FILTERS[table].format(y=year)), rel, force=force, expect_binary=True)
    except (UnexpectedContentError, urllib.error.HTTPError):
        return False
    if _ige.has_data(path):
        return True
    src.discard(rel)
    return False


def _cached(src, table: int):
    files = sorted(src.raw_dir.glob(f"t{table}_*_total.csv"))
    if not files:
        raise FileNotFoundError(f"no cached IGE table {table} in {src.raw_dir}; run fetch first")
    return int(files[-1].stem.split("_")[1]), files[-1]


def _wanted(r) -> bool:
    code = r["CodEspazo"].strip()
    return r["Sexo"].strip() == "Total" and (code == _ige.GALICIA or _ige.concello_code(r) is not None)


class IgePoboacion(Source):
    info = SourceInfo(
        id="ige_poboacion",
        title="Población por concello: edad, nacionalidad, lugar de nacimiento y edad media",
        publisher="Instituto Galego de Estatística (IGE), a partir del Padrón municipal",
        homepage="https://www.ige.gal/igebdt/selector.jsp?COD=144",
        license="CC BY-SA 4.0 (IGE)",
        description="Población a 1 de enero por grupo quinquenal de edad y nacionalidad (tabla 144), por lugar de nacimiento "
        "(143) y edad media oficial (723). Se usa el último año con datos y sexo = Total.",
        used_for=["Ciudadanos: mezcla por edad", "Ciudadanos: españoles y extranjeros", "Ciudadanos: lugar de nacimiento"],
    )

    def fetch(self, force=False):
        if self.offline:
            return
        for year in range(date.today().year, date.today().year - 5, -1):
            if all(_fetch_table(self, t, year, force) for t in FILTERS):
                return
            for t in FILTERS:  # a partial year must not stay cached: process needs one year in all three
                if _ige.has_data(self.raw_dir / _rel(t, year)) if (self.raw_dir / _rel(t, year)).exists() else False:
                    self.discard(_rel(t, year))
        raise RuntimeError("ige_poboacion: no recent year has data in tables 144, 143 and 723")

    def process(self):
        year, p_age = _cached(self, T_AGE)
        year_b, p_birth = _cached(self, T_BIRTH)
        year_i, p_ind = _cached(self, T_IND)
        if not year == year_b == year_i:
            raise RuntimeError(f"ige_poboacion: years differ ({year}, {year_b}, {year_i}); re-run fetch --force")
        by: dict[str, dict] = {}

        def rec(code):
            return by.setdefault(code, {"total": None, "age_groups": {}, "nationality": {}, "birth": {}})

        for r in _ige.read_rows(p_age):
            v = _ige.number(r)
            if not _wanted(r) or v is None:
                continue
            nat, age = r["Nacionalidade"].strip(), r["Grupos de idade"].strip()
            age = RAW_AGE.get(age, age)
            d = rec(r["CodEspazo"].strip())
            if nat == "Total" and age == "Total":
                d["total"] = int(v)
            elif nat == "Total" and age in MID:
                d["age_groups"][age] = int(v)
            elif nat in NATIONALITY and age == "Total":
                d["nationality"][NATIONALITY[nat]] = int(v)
        for r in _ige.read_rows(p_birth):
            v = _ige.number(r)
            if not _wanted(r) or v is None:
                continue
            lab = r["Lugar de nacemento"].strip()
            if lab == "Total":
                rec(r["CodEspazo"].strip())["birth"]["total"] = int(v)
            elif lab in BIRTH:
                rec(r["CodEspazo"].strip())["birth"][BIRTH[lab]] = int(v)
            else:
                raise RuntimeError(f"ige_poboacion: unknown birth place {lab!r}")
        official = {}
        for r in _ige.read_rows(p_ind):
            if r["Indicadores"].strip() == MEAN_AGE_LABEL and r["Sexo"].strip() == "Total" and _ige.number(r) is not None:
                official[r["CodEspazo"].strip()] = _ige.number(r)

        galicia, out = None, {}
        for code, d in by.items():
            if not d["total"] or code in MERGED:
                continue
            b = d["birth"]
            if sorted(d["age_groups"]) != sorted(AGE_GROUPS) or sorted(b) != sorted(["total", *BIRTH.values()]) \
                    or sorted(d["nationality"]) != ["foreign", "spanish"]:
                raise RuntimeError(f"ige_poboacion: incomplete data for {code}")
            if sum(d["age_groups"].values()) != d["total"] or sum(d["nationality"].values()) != d["total"]:
                raise RuntimeError(f"ige_poboacion: age or nationality does not add up to the total for {code}")
            quint = round(sum(MID[g] * n for g, n in d["age_groups"].items()) / d["total"], 2)
            res = {
                "total": d["total"],
                "age_groups": {g: d["age_groups"][g] for g in AGE_GROUPS},
                "mean_age": official.get(code, quint),
                "mean_age_quinquennial": quint,
                "nationality": {"spanish": d["nationality"]["spanish"], "foreign": d["nationality"]["foreign"]},
                "birth": {k: b[k] for k in ["total", *BIRTH.values()]},
                "born_outside_galicia_share": round((b["other_ccaa"] + b["abroad"]) / b["total"], 4) if b["total"] else None,
            }
            if code == _ige.GALICIA:
                galicia = res
            else:
                out[code] = res
        _ige.check_count(out, "ige_poboacion")
        if galicia is None:
            raise RuntimeError("ige_poboacion: no Galicia row")
        return {
            "vintage": f"IGE Padrón, poboación a 1 de xaneiro de {year} (táboas 144, 143, 723)",
            "year": year,
            "year_birth": year_b,
            "mean_age_source": "IGE 723 'Idade media no 1 de xaneiro'; mean_age_quinquennial = midpoints (open group 100+ = 102.5)",
            "by_concello": out,
            "galicia": galicia,
            "_files": [p_age.name, p_birth.name, p_ind.name],
        }
