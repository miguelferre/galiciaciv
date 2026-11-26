"""The game-concept -> real-data mapping for Galicia, in one place.

Each yield is defined once here and exported to the browser (nation.json), so the UI and the
Almanac describe exactly what was computed.

Food, Production: Social Security affiliates (IGE table 11497) by sector, counted by the concello
where the affiliate LIVES (the table is "según el ayuntamiento de residencia de la persona afiliada").
Gold: GDP in euros (IGE table 9958, 2023).
Science and Culture (D-002): an ESTIMATE of affiliates = share of one activity branch in IGE table 10058
(affiliation by 13 branches, in %, by concello of residence, 2024) x total affiliates of IGE 11497 (2026-09).
There is no finer source by concello. Branch -> yield, by the 13 labels of table 10058:
  science <- "Actividades de información, financeiros, inmobiliarios e profesionais" (key info_financeiro):
             the closest branch to knowledge work by its label, but it also carries finance and real estate.
             (Which CNAE sections the IGE puts in each branch was not checked against its methodology.)
  culture <- "AAPP, Educación, Sanidade e outros servizos" (key aapp):
             the only branch whose label covers "other services"; by its label most of it is public
             administration, education and health.
The other 11 branches are not used by any yield. Change SCIENCE_BRANCHES / CULTURE_BRANCHES to remap.
"""

from __future__ import annotations

from .galicia import JOB_KEYS, JOB_LABELS

AFFILIATION_PERIOD = "2026-09"
GDP_YEAR = 2023
BRANCH_YEAR = 2024
SCIENCE_BRANCHES = ["info_financeiro"]
CULTURE_BRANCHES = ["aapp"]

YIELDS = [
    {
        "key": "food",
        "icon": "y-food",
        "emoji": "🌾",
        "label": "Alimento",
        "color": "#7fbf3f",
        "unit": "workers",
        "sectors": ["agro"],
        "industries": ["agricultura"],
        "description": "Personas afiliadas a la Seguridad Social en agricultura y pesca, contadas en el concello "
        "donde viven, no donde trabajan (IGE, tabla 11497, afiliaciones por concello de residencia y sector, "
        "septiembre de 2026). Solo cuenta empleo declarado en la Seguridad Social.",
    },
    {
        "key": "production",
        "icon": "y-production",
        "emoji": "⚙️",
        "label": "Producción",
        "color": "#d9823b",
        "unit": "workers",
        "sectors": ["industria", "construcion"],
        "industries": ["industria", "construccion"],
        "description": "Personas afiliadas a la Seguridad Social en industria y construcción, contadas en el "
        "concello donde viven, no donde trabajan (IGE, tabla 11497, septiembre de 2026). En algunos concellos "
        "pequeños el IGE oculta un sector por secreto estadístico: ahí el valor queda en blanco.",
    },
    {
        "key": "gold",
        "icon": "y-gold",
        "emoji": "💰",
        "label": "Oro",
        "color": "#f2c94c",
        "unit": "eur",
        "sectors": [],
        "industries": [],
        "description": "Producto interior bruto (PIB) anual en euros corrientes, estimado por el IGE para cada "
        "concello (IGE, tabla 9958, PIB municipal, 2023). Es una estimación por concello, no una cifra oficial "
        "de contabilidad regional.",
    },
    {
        "key": "science",
        "icon": "y-science",
        "emoji": "🔬",
        "label": "Ciencia",
        "color": "#4fa3e0",
        "unit": "workers",
        "sectors": [],
        "branches": SCIENCE_BRANCHES,
        "industries": [],
        "description": "Estimación de las personas afiliadas a la Seguridad Social en la rama «Actividades de "
        "información, financeiros, inmobiliarios e profesionais», la más cercana al trabajo de conocimiento: el porcentaje de esa rama en "
        "el concello (IGE, tabla 10058, afiliación por ramas, 2024) por el total de afiliados que viven en él "
        "(IGE, tabla 11497, septiembre de 2026). Es una estimación, no un recuento, y la rama incluye finanzas "
        "e inmobiliarias además del trabajo científico.",
    },
    {
        "key": "culture",
        "icon": "y-culture",
        "emoji": "🎭",
        "label": "Cultura",
        "color": "#b07ce0",
        "unit": "workers",
        "sectors": [],
        "branches": CULTURE_BRANCHES,
        "industries": [],
        "description": "Estimación de las personas afiliadas a la Seguridad Social en la rama «AAPP, Educación, "
        "Sanidade e outros servizos», la única que, por su nombre, recoge los otros servicios: el porcentaje de esa rama en el concello (IGE, tabla 10058, 2024) por el total de afiliados "
        "que viven en él (IGE, tabla 11497, septiembre de 2026). Es una estimación, no un recuento; la mayor "
        "parte de la rama, por su nombre, es administración, educación y sanidad, no cultura en sentido estricto.",
    },
]


def jobs_of(aff: dict | None) -> dict[str, int | None]:
    """Affiliates per sector (keys of JOB_LABELS); None where the IGE withholds the sector for that concello."""
    aff = aff or {}
    return {out: (int(aff[k]) if aff.get(k) is not None else None) for k, out in JOB_KEYS.items()}


def branch_affiliates(aff: dict | None, shares: dict | None) -> dict[str, float | None]:
    """{"science", "culture"}: estimated affiliates = branch % (IGE 10058) x total affiliates (IGE 11497)."""
    tot = (aff or {}).get("total")
    out = {}
    for key, branches in (("science", SCIENCE_BRANCHES), ("culture", CULTURE_BRANCHES)):
        vals = [(shares or {}).get(b) for b in branches]
        out[key] = None if tot is None or not shares or any(v is None for v in vals) else sum(vals) / 100 * tot
    return out


def yields_of(aff: dict | None, gdp: float | None, branch: dict | None = None) -> dict[str, float | None]:
    """The five yields for one concello, comarca or Galicia. `branch` = {"science", "culture"} estimated
    affiliates (branch_affiliates, or a sum of them for a comarca); None leaves both null."""
    aff = aff or {}
    branch = branch or {}
    out: dict = {"science": None if branch.get("science") is None else round(branch["science"]),
                 "culture": None if branch.get("culture") is None else round(branch["culture"]), "gold": gdp}
    for y in YIELDS:
        if y["key"] in ("food", "production"):
            vals = [aff.get(s) for s in y["sectors"]]
            out[y["key"]] = None if any(v is None for v in vals) else int(sum(vals))
    return {y["key"]: out[y["key"]] for y in YIELDS}


def economy(pop, aff, gdp, paro, gdp_year=GDP_YEAR, income=None, branch=None) -> dict:
    """The economic profile shared by cities, comarcas and the nation.

    `aff` {agro, industria, construcion, servizos, total}; `paro` registered unemployment total
    (None = missing; unemployment is then None). `income` = mean net income per person in euros (INE ADRH 2024;
    the key keeps the original name median_income, but the value is a MEAN, not a median). `unemployment` = registered unemployed / inhabitants (0..1),
    NOT the unemployment rate of the labour force.
    """
    return {
        "population": pop,
        "yields": yields_of(aff, gdp, branch),
        "jobs": jobs_of(aff),
        "employed": (aff or {}).get("total"),
        "median_income": round(income) if income is not None else None,
        "median_rent": None,
        "home_value": None,
        "unemployment": round(paro / pop, 4) if paro is not None and pop else None,
        "rent_burden": None,
        "gdp": gdp,
        "gdp_year": gdp_year,
        "gdp_by_industry": None,
        "gdp_undisclosed": None,
        "gdp_estimated": None,
    }


def mean_income(geoids, pop: dict, renta: dict) -> float | None:
    """Population-weighted mean of the concellos' mean net income per person (ine_adrh by_concello).

    For a comarca or Galicia this is total net income / people, the same as the INE mean would be if the
    ADRH person counts matched the padrón (they come from tax data, so it is an approximation)."""
    have = [(renta[g]["net_income_pc"], pop[g]) for g in geoids
            if g in renta and renta[g].get("net_income_pc") is not None and pop.get(g)]
    w = sum(p for _, p in have)
    return sum(v * p for v, p in have) / w if w else None


def industries() -> dict[str, str]:
    return dict(JOB_LABELS)
