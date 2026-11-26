"""Citizens: the mix of people of each city for the City View's person figures, from IGE concello tables.

Four rows per city: employed people by occupation (Censo 2021, table 11265, CNO groups), residents by age (Padron,
table 144), people 15 and over by level of studies (Censo 2021, table 11253) and residents by place of birth
(Padron, table 143). There is no commuting data by concello, so there is no commuting row.

Figure counts (`figures`) are computed here with largest-remainder rounding, so each row's figures add up exactly to
its figure count and the frontend only draws them. A row with a hidden value (statistical secrecy) is null, never
zeros. Occupation shares are over the people with a known occupation: "Non consta" is left out and reported apart
(`unclassified`).

`specialists` lists the categories whose share is at least SPECIALIST_HIGH or at most SPECIALIST_LOW times the share
in Galicia (up to MAX_HIGH over-represented, strongest first, then up to MAX_LOW under-represented; categories under
MIN_SHARE both here and in Galicia are skipped as noise).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from ..core.paths import WEB_DATA
from ..core.store import load_interim, write_web

REQUIRES = ["ige_poboacion", "ige_censo", "cities.json"]
PRODUCES = ["citizens.json"]

SOURCES = ["ige_poboacion", "ige_censo"]
FIGURES = {"workforce": 20, "age": 10, "education": 10, "nativity": 10}
SPECIALIST_HIGH = 1.25
SPECIALIST_LOW = 0.8
MIN_SHARE = 0.01
MAX_HIGH, MAX_LOW = 4, 2


def _g(key, label, short, art, parts):
    """A category: `art` = the figure the viewer draws; `parts` = the interim keys it adds up."""
    return {"key": key, "label": label, "short": short, "art": art, "parts": parts}


def _ages(lo: int, hi: int) -> list[str]:
    return [f"{a}-{a + 4}" if a < 100 else "100+" for a in range(lo, hi + 1, 5)]


GROUPS = {
    "workforce": [
        _g("cno1", "Directores y gerentes", "Dirección", "executive", ["cno1"]),
        _g("cno2", "Técnicos y profesionales científicos e intelectuales", "Profesionales", "scholar", ["cno2"]),
        _g("cno3", "Técnicos y profesionales de apoyo", "Técnicos", "engineer", ["cno3"]),
        _g("cno4", "Empleados de oficina y administrativos", "Oficina", "clerk", ["cno4"]),
        _g("cno5", "Hostelería, servicios personales, protección y comercio", "Servicios y comercio", "service", ["cno5"]),
        _g("cno6", "Trabajadores cualificados del campo, el monte y la pesca", "Campo y mar", "farmer", ["cno6"]),
        _g("cno7", "Artesanos y oficios de la industria y la construcción", "Oficios", "builder", ["cno7"]),
        _g("cno8", "Operadores de instalaciones y maquinaria, y montadores", "Operadores", "maker", ["cno8"]),
        _g("cno9", "Ocupaciones elementales", "Elementales", "elementary", ["cno9"]),
    ],
    "age": [
        _g("child", "Menores de 15 años", "0-14", "child", _ages(0, 10)),
        _g("young", "De 15 a 34 años", "15-34", "young", _ages(15, 30)),
        _g("midlife", "De 35 a 64 años", "35-64", "midlife", _ages(35, 60)),
        _g("elder", "De 65 años o más", "65 y más", "elder", _ages(65, 100)),
    ],
    "education": [
        _g("primary", "Educación primaria o inferior", "Primaria", "less_than_hs", ["primary"]),
        _g("lower_secondary", "Primera etapa de secundaria", "Secundaria 1ª", "high_school", ["lower_secondary"]),
        _g("upper_secondary", "Segunda etapa de secundaria y postsecundaria no superior", "Secundaria 2ª", "some_college",
           ["upper_secondary"]),
        _g("higher", "Educación superior", "Superior", "bachelors", ["higher"]),
    ],
    "nativity": [
        _g("same_concello", "Nacidos en el concello donde viven", "Este concello", "born_in_state", ["same_concello"]),
        _g("galicia", "Nacidos en otro concello de Galicia", "Resto de Galicia", "other_state",
           ["same_province", "other_province"]),
        _g("spain", "Nacidos en otra comunidad autónoma", "Resto de España", "native_abroad", ["other_ccaa"]),
        _g("abroad", "Nacidos en el extranjero", "Extranjero", "foreign_born", ["abroad"]),
    ],
}
ROW_LABELS = {
    "workforce": "Personas ocupadas por ocupación (Censo 2021)",
    "age": "Habitantes por edad (Padrón a 1 de enero de {year})",
    "education": "Personas de 15 años o más por nivel de estudios (Censo 2021)",
    "nativity": "Habitantes por lugar de nacimiento (Padrón a 1 de enero de {year_birth})",
}


def largest_remainder(values: dict[str, float], n: int) -> dict[str, int]:
    """Integer counts summing exactly to n, proportional to `values` (Hamilton's method).

    Ties in the remainders go to the larger value, then to the earlier key, so the result is deterministic.
    Negative values count as 0. All-zero input -> all zeros.
    """
    keys = list(values)
    vals = [max(0.0, float(values[k] or 0)) for k in keys]
    total = sum(vals)
    if total <= 0 or n <= 0:
        return {k: 0 for k in keys}
    quotas = [v * n / total for v in vals]
    base = [math.floor(q) for q in quotas]
    left = n - sum(base)
    order = sorted(range(len(keys)), key=lambda i: (-(quotas[i] - base[i]), -vals[i], i))
    for i in order[:left]:
        base[i] += 1
    return dict(zip(keys, base))


def row(source: dict | None, name: str) -> dict | None:
    """One row from the interim values of one concello, or None if any value it needs is missing."""
    if not source:
        return None
    counts = {}
    for g in GROUPS[name]:
        vals = [source.get(p) for p in g["parts"]]
        if any(v is None for v in vals):
            return None
        counts[g["key"]] = int(sum(vals))
    total = sum(counts.values())
    if total <= 0:
        return None
    return {
        "total": total,
        "counts": counts,
        "shares": {k: round(v / total, 4) for k, v in counts.items()},
        "figures": largest_remainder(counts, FIGURES[name]),
    }


def specialists(parts: dict, nat: dict) -> list[dict]:
    hi, lo = [], []
    for name in GROUPS:
        a, b = parts.get(name), nat.get(name)
        if not a or not b:
            continue
        for k, n in a["counts"].items():
            s, ns = n / a["total"], b["counts"][k] / b["total"]
            if not ns or (s < MIN_SHARE and ns < MIN_SHARE):
                continue
            ratio = s / ns
            item = {"row": name, "key": k, "share": round(s, 4), "national": round(ns, 4), "ratio": round(ratio, 2)}
            if ratio >= SPECIALIST_HIGH:
                hi.append(item)
            elif ratio <= SPECIALIST_LOW:
                lo.append(item)
    hi.sort(key=lambda x: -x["ratio"])
    lo.sort(key=lambda x: x["ratio"])
    return hi[:MAX_HIGH] + lo[:MAX_LOW]


def full_row(pop: dict | None, census: dict | None, nat: dict | None) -> dict | None:
    pop, census = pop or {}, census or {}
    parts = {
        "workforce": row(census.get("occupation"), "workforce"),
        "age": row(pop.get("age_groups"), "age"),
        "education": row(census.get("studies"), "education"),
        "nativity": row(pop.get("birth"), "nativity"),
    }
    if all(v is None for v in parts.values()):
        return None
    if parts["workforce"] is not None:
        parts["workforce"]["unclassified"] = (census.get("occupation") or {}).get("nc")
    if parts["age"] is not None:
        parts["age"]["mean"] = pop.get("mean_age")
    nationality = pop.get("nationality") or {}
    total = pop.get("total")
    parts["foreign_nationals"] = (round(nationality["foreign"] / total, 4)
                                  if total and nationality.get("foreign") is not None else None)
    parts["specialists"] = specialists(parts, nat) if nat is not None else []
    return parts


def build() -> None:
    pop = load_interim("ige_poboacion")
    census = load_interim("ige_censo")
    cities = json.loads((WEB_DATA / "cities.json").read_text(encoding="utf-8"))
    national = full_row(pop["galicia"], census["galicia"], None)
    if national is None:
        raise ValueError("citizens: no Galicia row in ige_poboacion / ige_censo")
    out = {
        c["id"]: full_row(pop["by_concello"].get(c["id"]), census["by_concello"].get(c["id"]), national)
        for c in cities
    }
    year, year_birth = pop["year"], pop["year_birth"]
    groups = {name: [{k: v for k, v in g.items() if k != "parts"} for g in gs] for name, gs in GROUPS.items()}
    labels = {k: v.format(year=year, year_birth=year_birth) for k, v in ROW_LABELS.items()}
    doc = {
        "version": 1,
        "vintage": f"IGE: Padrón a 1 de enero de {year} y Censo {census['year']}",
        "year": year,
        "census_year": census["year"],
        "sources": SOURCES,
        "figures": dict(FIGURES),
        "rows": labels,
        "groups": groups,
        "rule": {
            "specialist_high": SPECIALIST_HIGH, "specialist_low": SPECIALIST_LOW, "min_share": MIN_SHARE,
            "max_high": MAX_HIGH, "max_low": MAX_LOW,
            "text": f"Las figuras se redondean por restos mayores, así cada fila suma justo. Destaca una categoría "
                    f"cuando su parte es al menos {_es(SPECIALIST_HIGH)} veces, o como mucho {_es(SPECIALIST_LOW)} veces, "
                    f"la parte de Galicia. Se listan hasta {MAX_HIGH} por encima y {MAX_LOW} por debajo. La fila de "
                    f"ocupación deja fuera a las personas sin ocupación declarada.",
        },
        "national": national,
        "cities": out,
    }
    write_web("citizens.json", doc)


def _es(x: float) -> str:
    return f"{x:g}".replace(".", ",")


# ---------------------------------------------------------------------------------------------- check


def _check_row(cid: str, r: dict, bad) -> None:
    for name in GROUPS:
        if name not in r:
            bad(f"{cid}: missing row {name!r}")
            continue
        v = r[name]
        if v is None:
            continue
        keys = [g["key"] for g in GROUPS[name]]
        if list(v.get("counts", {})) != keys or list(v.get("shares", {})) != keys:
            bad(f"{cid}: {name} categories differ from groups")
            continue
        if any(x is None or x < 0 for x in v["counts"].values()):
            bad(f"{cid}: {name} has negative or null counts")
        if sum(v["counts"].values()) != v["total"]:
            bad(f"{cid}: {name} counts sum {sum(v['counts'].values())} != total {v['total']}")
        f = v.get("figures") or {}
        if list(f) != keys or sum(f.values()) != FIGURES[name]:
            bad(f"{cid}: {name} figures must cover every category and sum to {FIGURES[name]}")


def check(web_dir: Path) -> list[tuple[str, str]]:
    web_dir = Path(web_dir)
    p = web_dir / "citizens.json"
    if not p.exists():
        return [("NOTE", "citizens.json: missing (optional, skipped)")]
    out: list[tuple[str, str]] = []
    bad = lambda m: out.append(("FAIL", f"citizens.json: {m}"))  # noqa: E731
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except ValueError as exc:
        return [("FAIL", f"citizens.json: invalid JSON ({exc})")]
    if not isinstance(doc, dict):
        return [("FAIL", "citizens.json: top level is not an object")]
    for k in ("version", "vintage", "year", "census_year", "sources", "figures", "rows", "groups", "rule",
              "national", "cities"):
        if k not in doc:
            bad(f"missing key {k!r}")
    if out:
        return out
    sp = web_dir / "sources.json"
    if sp.exists():
        known = {x.get("id") for x in json.loads(sp.read_text(encoding="utf-8")) if isinstance(x, dict)}
        if set(doc["sources"]) - known:
            out.append(("WARN", f"citizens.json: sources missing from sources.json: {sorted(set(doc['sources']) - known)}"))
    if doc["version"] != 1:
        bad(f"version {doc['version']!r} != 1")
    if doc["figures"] != FIGURES:
        bad(f"figures {doc['figures']} != {FIGURES}")
    for name, gs in GROUPS.items():
        got = [g.get("key") for g in doc["groups"].get(name, [])]
        if got != [g["key"] for g in gs]:
            bad(f"groups.{name} keys {got} differ from the contract")
        for g in doc["groups"].get(name, []):
            if not g.get("label") or not g.get("art"):
                bad(f"groups.{name}.{g.get('key')}: label and art are required")
    if not isinstance(doc["national"], dict):
        bad("national row missing")
    else:
        _check_row("national", doc["national"], bad)
    cities = doc["cities"] if isinstance(doc["cities"], dict) else {}
    cp = web_dir / "cities.json"
    if cp.exists():
        ids = {c.get("id") for c in json.loads(cp.read_text(encoding="utf-8")) if isinstance(c, dict)}
        if ids - set(cities):
            bad(f"{len(ids - set(cities))} cities.json ids missing, e.g. {sorted(ids - set(cities))[:3]}")
        if set(cities) - ids:
            bad(f"{len(set(cities) - ids)} ids not in cities.json")
    n_null = 0
    row_null = {name: 0 for name in GROUPS}
    for cid, r in cities.items():
        if r is None:
            n_null += 1
            continue
        _check_row(cid, r, bad)
        for name in GROUPS:
            if r.get(name) is None:
                row_null[name] += 1
    if any(lv == "FAIL" for lv, _ in out):
        return out[:50]
    out.append(("PASS", f"citizens.json: {len(cities)} cities, {n_null} with no citizen rows"))
    out.append(("NOTE", "citizens.json: cities without a row: " + ", ".join(f"{k} {v}" for k, v in row_null.items())))
    return out
