"""Districts: the specialisation of each city and concello as strategy-game districts (IGE 9002, local units).

The data counts **local business units** (establishments) by CNAE-09 division, not jobs: a large factory counts as
one. It leaves out the primary sector and public administration, so there is no farming, fishing or government
district.

Location quotient (LQ) = (units of the district's divisions in the concello / all units of the concello) / (the same
ratio for Galicia). Expected units = units the concello would have at the Galician ratio; excess = units - expected.

The rule (published in the file as `rule`):
* A district **appears** when its LQ is at least MIN_LQ with at least MIN_UNITS units and an excess of at least
  max(MIN_EXCESS, Z * sqrt(expected)) ("broad"), or when one of its listed specialities (`sub`) has an LQ of at
  least SPECIALTY_LQ with the same floors ("specialty"). The floors keep a handful of establishments from naming a
  city: the data are small counts.
* Districts are ranked by strength = excess units (the larger of the district's and its speciality's); up to
  MAX_PER_CITY are kept.
* The city type `badge` comes from the strongest district, unless another listed district is extreme
  (LQ >= BADGE_LQ and >= BADGE_SHARE of the units). Its label is the speciality's when one qualifies, else the
  district's. No district -> no badge ("diversificada").
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from ..core.paths import WEB_DATA
from ..core.store import load_interim_payload, write_web

REQUIRES = ["ige_unidades", "cities.json"]
PRODUCES = ["districts.json"]

MIN_LQ = 1.25
MIN_UNITS = 10
MIN_EXCESS = 10
Z = 2.0
SPECIALTY_LQ = 3.0
MAX_PER_CITY = 5
TOP_DIVISIONS = 8
BADGE_LQ = 6.0
BADGE_SHARE = 0.03

# CNAE-09 division titles in Spanish (the IGE table gives them in Galician).
DIVISIONS = {
    "05": "Extracción de antracita, hulla y lignito", "06": "Extracción de crudo de petróleo y gas natural",
    "07": "Extracción de minerales metálicos", "08": "Otras industrias extractivas",
    "09": "Apoyo a las industrias extractivas", "10": "Alimentación", "11": "Bebidas", "12": "Tabaco", "13": "Textil",
    "14": "Confección de prendas de vestir", "15": "Cuero y calzado", "16": "Madera y corcho, salvo muebles",
    "17": "Papel", "18": "Artes gráficas", "19": "Coquerías y refino de petróleo", "20": "Química",
    "21": "Productos farmacéuticos", "22": "Caucho y plásticos", "23": "Otros productos minerales no metálicos",
    "24": "Metalurgia", "25": "Productos metálicos, salvo maquinaria", "26": "Informática, electrónica y óptica",
    "27": "Material y equipo eléctrico", "28": "Maquinaria y equipo", "29": "Vehículos de motor y remolques",
    "30": "Otro material de transporte", "31": "Muebles", "32": "Otras industrias manufactureras",
    "33": "Reparación e instalación de maquinaria", "35": "Energía eléctrica, gas y vapor",
    "36": "Captación y distribución de agua", "37": "Aguas residuales", "38": "Residuos y valorización",
    "39": "Descontaminación", "41": "Construcción de edificios", "42": "Ingeniería civil",
    "43": "Construcción especializada", "45": "Venta y reparación de vehículos", "46": "Comercio al por mayor",
    "47": "Comercio al por menor", "49": "Transporte terrestre y por tubería", "50": "Transporte marítimo y fluvial",
    "51": "Transporte aéreo", "52": "Almacenamiento y apoyo al transporte", "53": "Correos y mensajería",
    "55": "Alojamiento", "56": "Comidas y bebidas", "58": "Edición", "59": "Cine, vídeo, televisión y música",
    "60": "Radio y televisión", "61": "Telecomunicaciones", "62": "Programación y consultoría informática",
    "63": "Servicios de información", "64": "Servicios financieros", "65": "Seguros y fondos de pensiones",
    "66": "Actividades auxiliares financieras y de seguros", "68": "Actividades inmobiliarias",
    "69": "Actividades jurídicas y de contabilidad", "70": "Sedes centrales y consultoría de gestión",
    "71": "Arquitectura, ingeniería y ensayos técnicos", "72": "Investigación y desarrollo",
    "73": "Publicidad y estudios de mercado", "74": "Otras actividades profesionales y técnicas",
    "75": "Actividades veterinarias", "77": "Alquiler", "78": "Actividades relacionadas con el empleo", "79": "Agencias de viajes y reservas",
    "80": "Seguridad e investigación", "81": "Servicios a edificios y jardinería",
    "82": "Actividades administrativas de oficina", "85": "Educación", "86": "Actividades sanitarias",
    "87": "Asistencia en establecimientos residenciales", "88": "Servicios sociales sin alojamiento",
    "90": "Creación, artes y espectáculos", "91": "Bibliotecas, archivos y museos", "92": "Juegos de azar y apuestas",
    "93": "Deporte y ocio", "94": "Actividades asociativas", "95": "Reparación de ordenadores y artículos de uso",
    "96": "Otros servicios personales",
}


def _r(a: int, b: int) -> list[str]:
    return [f"{i:02d}" for i in range(a, b + 1)]


def _d(id, name, short, color, divisions, sub, badge, labels, description):
    return {
        "id": id, "name": name, "short": short, "icon": "d-" + id, "color": color, "divisions": divisions,
        "sub": sub, "badge": {"id": id, "label": badge, "labels": labels},
        "description": f"{description} Cuenta establecimientos, no empleos.",
    }


CATALOG = [
    _d("industry", "Zona industrial", "Industria", "#c2643a", _r(10, 33),
       {c: DIVISIONS[c] for c in ("10", "11", "13", "14", "16", "23", "24", "25", "28", "29", "30")},
       "Ciudad industrial",
       {"10": "Ciudad de la alimentación", "11": "Ciudad de las bebidas", "13": "Ciudad textil",
        "14": "Ciudad de la confección", "16": "Ciudad de la madera", "23": "Ciudad de minerales no metálicos",
        "24": "Ciudad metalúrgica", "25": "Ciudad del metal", "28": "Ciudad de la maquinaria",
        "29": "Ciudad del motor", "30": "Ciudad del material de transporte"},
       "Industria manufacturera: divisiones CNAE 10 a 33."),
    _d("quarry", "Canteras y extracción", "Canteras", "#8a7460", ["07", "08", "09"], {}, "Ciudad extractiva", {},
       "Extracción de minerales y rocas (CNAE 07 a 09). La tabla no separa la pizarra del granito."),
    _d("transport", "Distrito del transporte", "Transporte", "#6a8fb8", ["49", "52", "53"], {},
       "Ciudad del transporte", {},
       "Transporte terrestre, almacenamiento y correos (CNAE 49, 52 y 53). La mayoría son transporte por carretera."),
    _d("commerce", "Centro comercial", "Comercio", "#d0a23a", ["46", "47"], {"46": DIVISIONS["46"]},
       "Ciudad comercial", {"46": "Plaza mayorista"},
       "Comercio al por mayor y al por menor (CNAE 46 y 47), sin la venta de vehículos."),
    _d("offices", "Distrito de oficinas", "Oficinas", "#8a9a5b", ["64", "65", "66", "69", "70", "71", "73"], {},
       "Ciudad de servicios profesionales", {},
       "Finanzas, seguros, despachos, consultoría, ingeniería y publicidad (CNAE 64 a 66, 69 a 71 y 73)."),
    _d("tech", "Distrito tecnológico", "Tecnología", "#4a7bd0", ["62", "63", "72"], {"72": DIVISIONS["72"]},
       "Ciudad tecnológica", {"72": "Ciudad de la investigación"},
       "Informática, servicios de información e investigación y desarrollo (CNAE 62, 63 y 72)."),
    _d("tourism", "Distrito turístico", "Turismo", "#d0508a", ["55", "56"], {"55": DIVISIONS["55"]},
       "Ciudad de la hostelería", {"55": "Ciudad turística"},
       "Alojamiento, restaurantes y bares (CNAE 55 y 56)."),
    _d("culture", "Plaza de la cultura", "Cultura", "#a15bc4", ["59", "60", "90", "91"], {}, "Ciudad cultural", {},
       "Cine, música, radio y televisión, artes, bibliotecas y museos (CNAE 59, 60, 90 y 91)."),
    _d("utilities", "Energía y agua", "Energía y agua", "#3aa0a0", _r(35, 39), {}, "Ciudad de la energía y el agua", {},
       "Electricidad, gas, agua y residuos (CNAE 35 a 39)."),
]
BY_ID = {d["id"]: d for d in CATALOG}
IDS = [d["id"] for d in CATALOG]


def es(x: float, nd: int = 1) -> str:
    return f"{x:.{nd}f}".replace(".", ",")


RULE_TEXT = (
    f"Los distritos salen del cociente de localización: la parte de los establecimientos de un concello que se dedica "
    f"a unas actividades, dividida por la misma parte en Galicia. Se cuentan establecimientos (unidades locales), no "
    f"empleos: una gran fábrica cuenta como uno. Un distrito aparece con un cociente de al menos {es(MIN_LQ, 2)}, "
    f"{MIN_UNITS} establecimientos o más y un exceso sobre lo esperado de al menos {MIN_EXCESS} y de "
    f"{es(Z, 0)} veces la raíz de lo esperado; o cuando una de sus especialidades alcanza un cociente de "
    f"{es(SPECIALTY_LQ, 0)} con los mismos mínimos. Se ordenan por exceso y se muestran hasta {MAX_PER_CITY}. El "
    f"tipo de ciudad sale del distrito más fuerte, salvo que otro tenga un cociente de {es(BADGE_LQ, 0)} o más y al "
    f"menos el {BADGE_SHARE:.0%} de los establecimientos. Sin distrito, la ciudad es diversificada."
)


def units_of(rec: dict, codes: list[str]) -> int | None:
    """Units of a record in these divisions; None when the table hides one of them (never 0 for hidden)."""
    values = [rec["divisions"][c] for c in codes if c in rec["divisions"]]
    if any(v is None for v in values):
        return None
    return sum(values)


def measure(rec: dict, nat: dict, codes: list[str]) -> dict | None:
    u, gu = units_of(rec, codes), units_of(nat, codes)
    if u is None or not gu or not rec.get("total") or not nat.get("total"):
        return None
    expected = rec["total"] * gu / nat["total"]
    return {"units": u, "lq": u / expected, "excess": u - expected, "expected": expected}


def passes(m: dict | None, min_lq: float) -> bool:
    return (m is not None and m["lq"] >= min_lq and m["units"] >= MIN_UNITS
            and m["excess"] >= max(MIN_EXCESS, Z * math.sqrt(m["expected"])))


def evaluate(rec: dict, nat: dict) -> list[dict]:
    """Every district that passes the rule for this concello, strongest first (max MAX_PER_CITY)."""
    out = []
    for d in CATALOG:
        m = measure(rec, nat, d["divisions"])
        if m is None:
            continue
        broad = passes(m, MIN_LQ)
        subs = [(code, s) for code in d["sub"] if (s := measure(rec, nat, [code])) is not None]
        special = [(c, s) for c, s in subs if passes(s, SPECIALTY_LQ)]
        if not (broad or special):
            continue
        best = max(special, key=lambda t: t[1]["excess"], default=None)
        strength = max(m["excess"] if broad else 0.0, best[1]["excess"] if best else 0.0)
        out.append({
            "id": d["id"], "lq": round(m["lq"], 2), "units": m["units"], "share": round(m["units"] / rec["total"], 4),
            "excess": round(m["excess"], 1), "strength": round(strength, 1),
            "sub": best[0] if best else None, "sub_lq": round(best[1]["lq"], 2) if best else None,
            "sub_units": best[1]["units"] if best else None, "via": "broad" if broad else "specialty",
        })
    out.sort(key=lambda r: -r["strength"])
    return out[:MAX_PER_CITY]


def badge_district(dists: list[dict]) -> dict | None:
    """The district the city type is named after: the strongest, unless a listed district is extreme."""
    if not dists:
        return None
    extreme = [d for d in dists if d["lq"] >= BADGE_LQ and d["share"] >= BADGE_SHARE]
    return max(extreme, key=lambda d: d["strength"]) if extreme else dists[0]


def badge_for(best: dict | None) -> dict | None:
    if not best:
        return None
    d = BY_ID[best["id"]]
    sub = best["sub"]
    if sub:
        label = d["badge"]["labels"].get(sub, d["badge"]["label"])
        text = f"{d['sub'][sub]}: {es(best['sub_lq'])} veces la parte gallega de los establecimientos"
    else:
        label = d["badge"]["label"]
        text = f"{d['name']}: {es(best['lq'], 2)} veces la parte gallega de los establecimientos"
    return {"id": d["badge"]["id"], "label": label, "district": d["id"], "text": text}


def top_divisions(rec: dict, nat: dict) -> list[dict]:
    """The most specialised divisions with at least MIN_UNITS units, by location quotient."""
    out = []
    for code in sorted(rec["divisions"]):
        m = measure(rec, nat, [code])
        if m is None or m["units"] < MIN_UNITS:
            continue
        out.append({"div": code, "units": m["units"], "lq": round(m["lq"], 2)})
    out.sort(key=lambda r: (-r["lq"], -r["units"], r["div"]))
    return out[:TOP_DIVISIONS]


def build() -> None:
    payload = load_interim_payload("ige_unidades")
    data = payload["data"]
    cities = json.loads((WEB_DATA / "cities.json").read_text(encoding="utf-8"))
    nat, by = data["galicia"], data["by_concello"]
    unknown = sorted(set(data["divisions"]) - set(DIVISIONS))
    if unknown:
        raise ValueError(f"districts: divisions without a Spanish title: {unknown}")

    out_cities: dict[str, dict | None] = {}
    for c in cities:
        rec = by.get(c["id"])
        if rec is None:
            out_cities[c["id"]] = None
            continue
        dists = evaluate(rec, nat)
        out_cities[c["id"]] = {
            "units": rec["total"], "top": top_divisions(rec, nat), "districts": dists,
            "badge": badge_for(badge_district(dists)),
        }
    out_counties = {}
    for geoid, rec in sorted(by.items()):
        dists = evaluate(rec, nat)
        out_counties[geoid] = {"units": rec["total"], "districts": [[d["id"], d["lq"], d["units"]] for d in dists]}

    doc = {
        "version": 1,
        "vintage": payload.get("vintage") or data["vintage"],
        "year": data["year"],
        "sources": ["ige_unidades"],
        "rule": {"min_lq": MIN_LQ, "min_units": MIN_UNITS, "min_excess": MIN_EXCESS, "z": Z,
                 "specialty_lq": SPECIALTY_LQ, "max_per_city": MAX_PER_CITY, "badge_lq": BADGE_LQ,
                 "badge_share": BADGE_SHARE, "text": RULE_TEXT},
        "catalog": CATALOG,
        "divisions": {c: {"title": DIVISIONS[c], "units": nat["divisions"][c]} for c in data["divisions"]},
        "national": {"units": nat["total"]},
        "cities": out_cities,
        "counties": out_counties,
    }
    write_web("districts.json", doc)


# ---------------------------------------------------------------------------------------------- check


def check(web_dir: Path) -> list[tuple[str, str]]:
    web_dir = Path(web_dir)
    p = web_dir / "districts.json"
    if not p.exists():
        return [("NOTE", "districts.json: missing (optional, skipped)")]
    out: list[tuple[str, str]] = []
    bad = lambda m: out.append(("FAIL", f"districts.json: {m}"))  # noqa: E731
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except ValueError as exc:
        return [("FAIL", f"districts.json: invalid JSON ({exc})")]
    if not isinstance(doc, dict):
        return [("FAIL", "districts.json: top level is not an object")]
    for k in ("version", "vintage", "year", "sources", "rule", "catalog", "divisions", "national", "cities", "counties"):
        if k not in doc:
            bad(f"missing key {k!r}")
    if out:
        return out
    sp = web_dir / "sources.json"
    if sp.exists():
        known = {x.get("id") for x in json.loads(sp.read_text(encoding="utf-8")) if isinstance(x, dict)}
        if set(doc["sources"]) - known:
            out.append(("WARN", f"districts.json: sources missing from sources.json: {sorted(set(doc['sources']) - known)}"))
    if doc["version"] != 1:
        bad(f"version {doc['version']!r} != 1")
    if not isinstance(doc["rule"], dict) or not isinstance(doc["rule"].get("text"), str):
        bad("rule.text missing")
    cat = doc["catalog"]
    ids = [d.get("id") for d in cat] if isinstance(cat, list) else []
    if ids != IDS:
        bad(f"catalog ids {ids} != {IDS}")
    for d in cat if isinstance(cat, list) else []:
        for k in ("name", "short", "icon", "color", "divisions", "sub", "badge", "description"):
            if k not in d:
                bad(f"catalog {d.get('id')}: missing {k!r}")
    divisions = doc["divisions"] if isinstance(doc["divisions"], dict) else {}
    city_ids = None
    cp = web_dir / "cities.json"
    if cp.exists():
        city_ids = {c.get("id") for c in json.loads(cp.read_text(encoding="utf-8")) if isinstance(c, dict)}
    cities = doc["cities"] if isinstance(doc["cities"], dict) else {}
    if city_ids is not None:
        if city_ids - set(cities):
            bad(f"{len(city_ids - set(cities))} cities.json ids missing, e.g. {sorted(city_ids - set(cities))[:3]}")
        if set(cities) - city_ids:
            bad(f"{len(set(cities) - city_ids)} ids not in cities.json")
    n_null = n_badge = 0
    counts = {i: 0 for i in IDS}
    for cid, row in cities.items():
        if row is None:
            n_null += 1
            continue
        if not isinstance(row.get("units"), int) or row["units"] <= 0:
            bad(f"city {cid}: units must be a positive integer")
        dl = row.get("districts")
        if not isinstance(dl, list) or len(dl) > MAX_PER_CITY:
            bad(f"city {cid}: districts must be a list of at most {MAX_PER_CITY}")
            continue
        for d in dl:
            if d.get("id") not in counts:
                bad(f"city {cid}: unknown district {d.get('id')!r}")
                continue
            counts[d["id"]] += 1
            if (d.get("units") or 0) < MIN_UNITS:
                bad(f"city {cid}: district {d['id']} under {MIN_UNITS} units")
        for t in row.get("top") or []:
            if t.get("div") not in divisions:
                bad(f"city {cid}: top division {t.get('div')!r} not in divisions")
        b = row.get("badge")
        if b is not None:
            n_badge += 1
            if b.get("district") not in {d.get("id") for d in dl}:
                bad(f"city {cid}: badge does not name one of its districts")
        elif dl:
            bad(f"city {cid}: districts but no badge")
    if any(lv == "FAIL" for lv, _ in out):
        return out[:50]
    out.append(("PASS", f"districts.json: {len(cities)} cities ({n_null} without data), {n_badge} with a city type, "
                        f"{len(doc['counties'])} concellos"))
    out.append(("NOTE", "districts.json: cities per district: " + ", ".join(f"{k} {v}" for k, v in counts.items())))
    return out
