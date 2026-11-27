"""Formación profesional por comarca: centros con oferta, oferta por familia, jóvenes y empresas (fp.json).

Qué junta (todo por comarca, 53, y para Galicia):
* Centros: los que tienen oferta ordinaria de FP en 2026-27 (PDF de la Consellería, `xunta_oferta_fp`), con tipo,
  titularidad, dirección y posición del directorio Abert@s (`xunta_centros`). El concello de cada centro sale del punto
  (contornos municipales del IGN, como en camino.py); si el centro no tiene coordenadas o el punto cae fuera de todo
  contorno (costa: los contornos están simplificados), se busca por el nombre del concello, y si tampoco, por el centro
  de concello más cercano. Si el punto y el nombre del directorio dan concellos distintos, manda el nombre (un error de
  coordenadas es lo habitual). Con el nombre solo, el centro se dibuja en el centro del concello (`located: "concello"`).
* Plazas: las del primer curso de cada ciclo, curso completo ordinario. No cuentan la matrícula modular, la dual
  intensiva, la acelerada ni la semipresencial.
* Jóvenes de 15 a 24 años: grupos 15-19 y 20-24 del padrón (`ige_poboacion`), sumados por comarca.
  `places_per_1000` = plazas por cada 1 000 jóvenes de la comarca (donde está el centro, no donde vive el alumno).
* Empresas: establecimientos por división CNAE-09 (`ige_unidades`, IGE 9002, serie 2014-2024) repartidos entre familias
  con la tabla de `fp_bridge.py` (criterio propio: la del INCUAL no se puede reutilizar). `est_share` es el peso de la
  familia en los establecimientos de la comarca que tienen familia; `offer_share` el de sus plazas en las plazas de la
  comarca; `ratio = offer_share / est_share` (1 = la oferta sigue el tejido de empresas; menos de 1 = falta oferta;
  más de 1 = sobra). Es `null` cuando `est_share` < EST_MIN_SHARE (cuenta casi nula) o la comarca no tiene plazas.
  `trend` = est_2024 / est_2014 - 1, `null` si `est_2014` < TREND_MIN_UNITS.
* `nearest_km`: distancia en línea recta, en km, desde el centro de población de la comarca (centros de concello
  ponderados por habitantes) hasta el centro más cercano que ofrece la familia (cualquier grado). No es distancia por
  carretera.
* PIE: los proyectos industriales estratégicos de la Xunta, con el concello (su centro, no la parcela), el empleo
  total anunciado (directo más indirecto) y las familias afines, que son criterio propio por tipo de proyecto.

Licencia de la salida: CC BY-SA 4.0 (obra derivada de Abert@s, que pide compartir igual).
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from ..core.geo import MapProjection, Shape, ShapeIndex
from ..core.store import load_interim, load_interim_payload, write_web
from . import fp_bridge as bridge
from .galicia import comarca_tables, concello_info

REQUIRES = ["_world", "ign_limites", "ige_comarcas", "ige_poboacion", "ige_unidades", "xunta_centros", "xunta_oferta_fp", "xunta_pie"]
PRODUCES = ["fp.json"]

EST_MIN_SHARE = 0.02
TREND_MIN_UNITS = 10
FIRST_YEAR, LAST_YEAR = 2014, 2024
GRADES = ["basico", "medio", "superior", "especializacion"]
LICENSE = "CC BY-SA 4.0"
ATTRIBUTION = {
    "xunta_centros": "Fonte dos datos: Xunta de Galicia (Abert@s, centros educativos, actualización {centros})",
    "xunta_oferta_fp": "Fonte: Xunta de Galicia, Consellería de Educación (oferta ordinaria de FP 2026-27)",
    "xunta_pie": "Fonte: Xunta de Galicia, Consellería de Economía e Industria (proyectos industriales estratégicos, consultado el {pie})",
    "ige": "Fuente: IGE: https://www.ige.gal (padrón y directorio de empresas)",
}
LIMITS = [
    "Las plazas son las del curso completo ordinario del curso 2026-27: no incluyen modular, dual intensiva, acelerada ni semipresencial. La Consellería avisa de que pueden variar.",
    "Las empresas son establecimientos (unidades locales) del directorio del IGE, no empleos; faltan el sector primario y la administración pública.",
    "El reparto de los sectores CNAE entre familias profesionales es criterio propio (la tabla del INCUAL no se puede reutilizar): sirve para comparar, no para medir.",
    "Los centros cuentan donde están, no donde vive el alumnado: la oferta de una ciudad sirve a su entorno.",
    "El empleo de los PIE es el total anunciado, directo más indirecto, y las familias afines son criterio propio.",
]
# Related families of each project, own judgement by project type (the Xunta list has no sector). Key = company start.
PIE_FAMILIES = {
    "Forestal del Atl": ["QUI", "ENA"], "Stolt Sea Farm": ["INA", "MAP"], "Xallas": ["QUI", "MAM"],
    "Galicia Green Data": ["IFC", "ELE", "IMA"], "Coventina": ["ENA", "ELE", "EOC"], "H2Pole": ["QUI", "ENA", "IMA"],
    "Biofibras": ["QUI", "IMA", "ELE"], "Congalsa": ["INA", "IMA"], "Betunes": ["QUI", "COM"],
    "AccionaPlug": ["QUI", "ENA", "ELE"], "Cobre San Rafael": ["IEX", "IMA", "SEA"], "Norbiogas": ["ENA", "QUI", "SEA"],
    "Saic": ["FME", "TMV", "ELE", "COM"], "Pescanova": ["INA", "MAP"], "Uro Veh": ["FME", "TMV", "ELE"],
    "Alternative Fats": ["AGA", "INA", "QUI"], "Av": ["AGA", "INA"],
}


def _fold(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())


def _km(a, b) -> float:
    """Great-circle km between (lon, lat) points."""
    (lo0, la0), (lo1, la1) = a, b
    p0, p1 = math.radians(la0), math.radians(la1)
    h = math.sin((p1 - p0) / 2) ** 2 + math.cos(p0) * math.cos(p1) * math.sin(math.radians(lo1 - lo0) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def _kind(code: str) -> str:
    return code if code in ("CIFP", "IES") else "otro"


def _family_block(places: dict, est_first: dict, est_last: dict, total_places: int) -> dict:
    """by_family of one area: places, offer_share, est_share, ratio, est_2014, est_2024, trend."""
    mapped = sum(est_last.values())
    out = {}
    for f in bridge.FAMILY_IDS:
        p, e0, e1 = places.get(f, 0), est_first.get(f, 0.0), est_last.get(f, 0.0)
        if not p and not e1:
            continue
        osh = p / total_places if total_places else None
        esh = e1 / mapped if mapped else None
        out[f] = {
            "places": p,
            "offer_share": None if osh is None else round(osh, 4),
            "est_share": None if esh is None else round(esh, 4),
            "ratio": round(osh / esh, 3) if osh is not None and esh is not None and esh >= EST_MIN_SHARE else None,
            "est_2014": round(e0, 1), "est_2024": round(e1, 1),
            "trend": round(e1 / e0 - 1, 4) if e0 >= TREND_MIN_UNITS else None,
        }
    return out


def build() -> None:
    world = load_interim("_world")
    lau = load_interim("ign_limites")
    cen = load_interim("xunta_centros")
    cen_pl = load_interim_payload("xunta_centros")
    off = load_interim("xunta_oferta_fp")
    pie = load_interim("xunta_pie")
    pob = load_interim("ige_poboacion")
    uni = load_interim("ige_unidades")
    ige_c = load_interim("ige_comarcas")
    bad = bridge.problems()
    if bad:
        raise RuntimeError(f"fp_bridge: {bad[:3]}")
    years = uni["series"]["years"]
    if years[0] != FIRST_YEAR or years[-1] != LAST_YEAR:
        raise RuntimeError(f"ige_unidades series is {years[0]}-{years[-1]}, fp.json names est_{FIRST_YEAR}/est_{LAST_YEAR}: update the contract")

    proj = MapProjection(**world["projection"])
    by_geoid = {c["geoid"]: c for c in lau["counties"]}
    geoids = list(world["counties"])
    idx = ShapeIndex([Shape([[proj(lon, lat) for lon, lat in r] for r in by_geoid[g]["rings"]]) for g in geoids], cell_km=20)
    info = concello_info()
    centroid = {g: (info[g]["lon"], info[g]["lat"]) for g in geoids}
    by_name = {_fold(info[g]["name"]): g for g in geoids}
    comarcas, comarca_of = comarca_tables()
    comarca_of = dict(comarca_of)  # 317 codes: the 4 merged concellos too (their old series count in the right comarca)

    # --- centres with offer -------------------------------------------------------------------------------------------
    directory = {c["code"]: c for c in cen["centres"]}
    missing = [c["code"] for c in off["centres"] if c["code"] not in directory]
    if missing:
        raise RuntimeError(f"fp: {len(missing)} centres of the offer are not in the directory: {missing[:5]}")
    rows_by_centre = defaultdict(list)
    for r in off["rows"]:
        rows_by_centre[r["centre"]].append(r)
    how, disagree, centres = Counter(), [], []
    for oc in off["centres"]:
        d = directory[oc["code"]]
        g_pt = g_name = None
        if d["lat"] is not None:
            x, y = proj(d["lon"], d["lat"])
            k = idx.locate(x, y)
            g_pt = geoids[k] if k >= 0 else None
        g_name = by_name.get(_fold(d["concello"]))
        point_ok = True
        if g_pt and g_name and g_name != g_pt:
            # The register's concello and its coordinates disagree: the typed name wins (a wrong coordinate is the usual
            # slip) and the centre goes to the centre of that concello.
            disagree.append((oc["code"], d["concello"], info[g_pt]["name"]))
            g, why, point_ok = g_name, "name", False
        elif g_pt:
            g, why = g_pt, "point"
        elif g_name:
            g, why = g_name, "name"
        elif d["lat"] is not None:
            g = min(geoids, key=lambda c: _km((d["lon"], d["lat"]), centroid[c]))
            why = "nearest"
        else:
            raise RuntimeError(f"fp: cannot place centre {oc['code']} ({d['concello']!r})")
        how[why] += 1
        if d["lat"] is not None and point_ok:
            lon, lat, located = d["lon"], d["lat"], "point"
        else:
            (lon, lat), located = centroid[g], "concello"
        x, y = proj(lon, lat)
        offer = [{"family": r["family"], "grade": r["grade"], "level": r["level"], "cycle": r["cycle"], "places": r["places"],
                  "shift": r["shift"], "code": r["code"]} for r in rows_by_centre[oc["code"]]]
        centres.append({
            "code": oc["code"], "name": d["name"], "type": _kind(d["type"]), "type_code": d["type"],
            "ownership": d["ownership"], "concertado": d["concertado"], "address": d["address"], "concello": g,
            "comarca": comarca_of[g], "x": round(x, 2), "y": round(y, 2), "lon": round(lon, 5), "lat": round(lat, 5),
            "located": located, "places": sum(o["places"] for o in offer), "offer": offer,
        })
    centres.sort(key=lambda c: c["code"])

    # --- population and businesses by comarca --------------------------------------------------------------------------
    young = defaultdict(int)
    pop_w = defaultdict(lambda: [0.0, 0.0, 0.0])  # lon*pop, lat*pop, pop
    for g, p in pob["by_concello"].items():
        c = comarca_of[g]
        young[c] += p["age_groups"]["15-19"] + p["age_groups"]["20-24"]
        w = pop_w[c]
        w[0] += centroid[g][0] * p["total"]
        w[1] += centroid[g][1] * p["total"]
        w[2] += p["total"]
    pop_centre = {c: (w[0] / w[2], w[1] / w[2]) for c, w in pop_w.items()}

    ser = uni["series"]
    n_years = len(years)

    def est(codes):
        """({family: units first year}, {family: units last year}) summed over the concellos `codes` of the series."""
        out = []
        for yi in (0, n_years - 1):
            by_div = defaultdict(float)
            for c in codes:
                s = ser["by_concello"].get(c)
                if s:
                    for dv, vals in s["divisions"].items():
                        by_div[dv] += vals[yi] or 0
            out.append(bridge.family_units(by_div))
        return out

    members = defaultdict(list)
    for c, cc in comarca_of.items():
        members[cc].append(c)

    # --- by comarca -----------------------------------------------------------------------------------------------------
    offering = defaultdict(list)  # family -> [(lon, lat)] of centres that offer it
    for c in centres:
        for f in {o["family"] for o in c["offer"]}:
            offering[f].append((c["lon"], c["lat"]))
    by_comarca = {}
    for cc in sorted(comarcas):
        here = [c for c in centres if c["comarca"] == cc]
        places = Counter()
        grades = Counter()
        for c in here:
            for o in c["offer"]:
                places[o["family"]] += o["places"]
                grades[o["grade"]] += o["places"]
        total = sum(places.values())
        e0, e1 = est(members[cc])
        yg = young[cc]
        by_comarca[cc] = {
            "name": comarcas[cc]["name"], "abbr": comarcas[cc]["abbr"], "centres": len(here),
            "young_15_24": yg, "places": total, "places_per_1000": round(total / yg * 1000, 1) if yg else None,
            "by_grade": {g: grades[g] for g in GRADES}, "by_family": _family_block(places, e0, e1, total),
            "nearest_km": {f: round(min(_km(pop_centre[cc], p) for p in pts), 1) for f, pts in sorted(offering.items())},
        }

    # --- Galicia ----------------------------------------------------------------------------------------------------------
    gp, gg = Counter(), Counter()
    for c in centres:
        for o in c["offer"]:
            gp[o["family"]] += o["places"]
            gg[o["grade"]] += o["places"]
    g0, g1 = est(list(comarca_of))
    gtotal, gyoung = sum(gp.values()), sum(young.values())
    galicia = {
        "centres": len(centres), "cifp": sum(c["type"] == "CIFP" for c in centres), "young_15_24": gyoung, "places": gtotal,
        "places_per_1000": round(gtotal / gyoung * 1000, 1), "by_grade": {g: gg[g] for g in GRADES},
        "by_family": _family_block(gp, g0, g1, gtotal),
        "establishments": {"first": ser["galicia"]["total"][0], "last": ser["galicia"]["total"][-1],
                           "mapped_to_family_last": round(sum(g1.values()), 1)},
    }

    # --- PIE --------------------------------------------------------------------------------------------------------------
    projects, unplaced = [], []
    for p in pie["projects"]:
        codes = [by_name.get(_fold(n)) for n in p["concellos"]]
        if not all(codes):
            unplaced.append(p["company"])
            continue
        pts = [proj(*centroid[c]) for c in codes]
        fams = next((v for k, v in PIE_FAMILIES.items() if p["company"].startswith(k)), [])
        projects.append({
            "company": p["company"], "project": p["project"], "concello": codes[0], "concellos": codes,
            "comarca": comarca_of[codes[0]], "x": round(sum(q[0] for q in pts) / len(pts), 2),
            "y": round(sum(q[1] for q in pts) / len(pts), 2), "investment_meur": p["investment_meur"],
            "jobs_total": p["jobs_total"], "jobs_note": p["jobs_text"] if p["jobs_text"] != str(p["jobs_total"]) else None,
            "status": p["status"], "status_text": p["status_text"], "dog": p["dog"], "families": fams,
            "concello_note": p["concello_note"],
        })
    if unplaced:
        raise RuntimeError(f"fp: PIE concellos not found for {unplaced}")

    families = [{"id": f, "name": n, "places": gp.get(f, 0), "centres": len(offering.get(f, [])),
                 **({"note": bridge.PARTIAL[f]} if f in bridge.PARTIAL else {})} for f, n in bridge.FAMILIES]
    bridge_doc = {d: [[f, w] for f, w in items] for d, items in sorted(bridge.DIVISION_FAMILIES.items())}
    attribution = " · ".join(v.format(centros=cen["retrieved"], pie=pie["retrieved"]) for v in ATTRIBUTION.values())
    write_web("fp.json", {
        "version": 1,
        "vintage": f"Xunta de Galicia: centros (Abert@s 0257, {cen['retrieved']}), oferta de FP 2026-27 (PDF de {off['retrieved']}), PIE "
                   f"(consultados el {pie['retrieved']}); IGE: padrón {pob['year']} y directorio de empresas {years[0]}-{years[-1]} (9002)",
        "sources": ["xunta_centros", "xunta_oferta_fp", "xunta_pie", "ige_unidades", "ige_poboacion", "ige_comarcas", "ign_limites"],
        "license": LICENSE,
        "attribution": attribution,
        "rule": "Plazas de primer curso del curso completo ordinario 2026-27 por centro, familia y grado; jóvenes de 15 a 24 del padrón; "
                "establecimientos por división CNAE-09 repartidos entre familias con una tabla propia. ratio = peso de la familia en las "
                "plazas dividido entre su peso en los establecimientos de la comarca (1 = oferta como el tejido de empresas).",
        "limits": LIMITS,
        "est_years": [years[0], years[-1]],
        "thresholds": {"est_min_share": EST_MIN_SHARE, "trend_min_units": TREND_MIN_UNITS},
        "families": families,
        "bridge": bridge_doc,
        "centres": centres,
        "by_comarca": by_comarca,
        "galicia": galicia,
        "pie": projects,
    })
    print(f"    {len(centres)} centros ({galicia['cifp']} CIFP, {gtotal} plazas, {sum(len(c['offer']) for c in centres)} ciclos), "
          f"{len(by_comarca)} comarcas, {len(projects)} PIE; concello por {dict(how)}; sin coordenadas: "
          f"{sum(c['located'] == 'concello' for c in centres)}")
    if disagree:
        print(f"    NOTE: {len(disagree)} centros cuyo punto cae en otro concello que el del directorio (manda el nombre del directorio): {disagree[:4]}")


def _near(a, b, tol=0.06):
    return a is not None and b is not None and abs(a - b) <= tol


def check(web_dir: Path) -> list[tuple[str, str]]:
    path = Path(web_dir) / "fp.json"
    if not path.exists():
        return [("NOTE", "fp.json not built (optional; run: build fp --deps)")]
    doc = json.loads(path.read_text(encoding="utf-8"))
    need = ("version", "vintage", "sources", "license", "attribution", "rule", "limits", "est_years", "families", "bridge",
            "centres", "by_comarca", "galicia", "pie")
    out = [("FAIL", f"fp.json lacks '{k}'") for k in need if k not in doc]
    if out:
        return out
    if doc["version"] != 1:
        out.append(("FAIL", f"fp.json version {doc['version']!r} (expected 1)"))
    if doc["license"] != LICENSE or "Xunta de Galicia" not in doc["attribution"] or "IGE" not in doc["attribution"]:
        out.append(("FAIL", "fp.json license or attribution is incomplete"))
    fam_ids = [f["id"] for f in doc["families"]]
    if len(set(fam_ids)) != len(fam_ids) or fam_ids != bridge.FAMILY_IDS:
        out.append(("FAIL", "fp.json families are not the bridge's families"))
    famset = set(fam_ids)
    centres = doc["centres"]
    codes = [c["code"] for c in centres]
    if len(set(codes)) != len(codes) or not centres:
        out.append(("FAIL", "fp.json centres are empty or repeated"))
    world_p, comarca_ok, geoids = Path(web_dir) / "world.json", None, None
    w = None
    if world_p.exists():
        w = json.loads(world_p.read_text(encoding="utf-8"))
        comarca_ok = {s["fips"] for s in w["states"]}
        geoids = {c["geoid"] for c in w["counties"]}
    keys = set(doc["by_comarca"])
    if len(keys) != 53 or (comarca_ok is not None and keys != comarca_ok):
        out.append(("FAIL", f"fp.json by_comarca has {len(keys)} comarcas, not the 53 of world.json"))
    badc = []
    for c in centres:
        offer = c["offer"]
        if (not offer or c["places"] != sum(o["places"] for o in offer) or c["comarca"] not in keys or c["type"] not in ("CIFP", "IES", "otro")
                or c["ownership"] not in ("publica", "privada") or c["located"] not in ("point", "concello")
                or any(o["family"] not in famset or o["grade"] not in GRADES or o["places"] <= 0 for o in offer)):
            badc.append(c["code"])
        elif geoids is not None and c["concello"] not in geoids:
            badc.append(c["code"])
        elif w is not None and not (0 <= c["x"] <= w["width"] and 0 <= c["y"] <= w["height"]):
            badc.append(c["code"])
        elif not (41.5 < c["lat"] < 44 and -9.6 < c["lon"] < -6.6):
            badc.append(c["code"])
    if badc:
        out.append(("FAIL", f"fp.json {len(badc)} centres are incomplete, out of Galicia or inconsistent: {badc[:5]}"))
    g = doc["galicia"]
    total = sum(c["places"] for c in centres)
    if g["places"] != total or g["centres"] != len(centres) or sum(g["by_grade"].values()) != total:
        out.append(("FAIL", f"fp.json galicia places {g['places']} differ from the centres' {total}"))
    if g["cifp"] != sum(c["type"] == "CIFP" for c in centres):
        out.append(("FAIL", "fp.json galicia cifp count differs from the centres"))
    if not _near(g["places_per_1000"], g["places"] / g["young_15_24"] * 1000, 0.06):
        out.append(("FAIL", "fp.json galicia places_per_1000 is wrong"))
    if sum(v["places"] for v in g["by_family"].values()) != total:
        out.append(("FAIL", "fp.json galicia by_family places do not add up"))
    offered = {o["family"] for c in centres for o in c["offer"]}
    sp = sy = sc = 0
    for cc, b in doc["by_comarca"].items():
        sp, sy, sc = sp + b["places"], sy + b["young_15_24"], sc + b["centres"]
        mine = [c for c in centres if c["comarca"] == cc]
        if b["centres"] != len(mine) or b["places"] != sum(c["places"] for c in mine):
            out.append(("FAIL", f"fp.json comarca {cc} centres or places differ from the centre list"))
        if not b["young_15_24"] or not _near(b["places_per_1000"], b["places"] / b["young_15_24"] * 1000, 0.06):
            out.append(("FAIL", f"fp.json comarca {cc} places_per_1000 is wrong"))
        if sum(v["places"] for v in b["by_family"].values()) != b["places"] or sum(b["by_grade"].values()) != b["places"]:
            out.append(("FAIL", f"fp.json comarca {cc} by_family or by_grade places do not add up"))
        if not set(b["by_family"]) <= famset or not set(b["nearest_km"]) <= famset:
            out.append(("FAIL", f"fp.json comarca {cc} has unknown families"))
        if b["places"] and abs(sum(v["offer_share"] for v in b["by_family"].values()) - 1) > 0.01:
            out.append(("FAIL", f"fp.json comarca {cc} offer_share does not add up to 1"))
        es = sum(v["est_share"] or 0 for v in b["by_family"].values())
        if es and abs(es - 1) > 0.01 and any(v["est_2024"] for v in b["by_family"].values()):
            if abs(es - 1) > 0.05:  # families with no offer and no units are left out; a larger gap is a bug
                out.append(("FAIL", f"fp.json comarca {cc} est_share adds up to {es:.3f}"))
        for f, v in b["by_family"].items():
            if v["ratio"] is not None and (v["offer_share"] is None or not v["est_share"] or not _near(v["ratio"], v["offer_share"] / v["est_share"], 0.002 + 0.01 * v["ratio"])):
                out.append(("FAIL", f"fp.json comarca {cc} family {f} ratio is not offer_share/est_share"))
            if v["ratio"] is not None and v["est_share"] < EST_MIN_SHARE:
                out.append(("FAIL", f"fp.json comarca {cc} family {f} has a ratio with a tiny est_share"))
            if v["trend"] is not None and v["est_2014"] < TREND_MIN_UNITS:
                out.append(("FAIL", f"fp.json comarca {cc} family {f} has a trend from a tiny base"))
            if v["places"] and f in b["nearest_km"] and b["nearest_km"][f] > 150:
                out.append(("FAIL", f"fp.json comarca {cc} offers {f} but nearest_km is {b['nearest_km'][f]}"))
        if any(not 0 <= d < 400 for d in b["nearest_km"].values()):
            out.append(("FAIL", f"fp.json comarca {cc} nearest_km out of range"))
        if set(b["nearest_km"]) != offered:
            out.append(("FAIL", f"fp.json comarca {cc} nearest_km families differ from the offered ones"))
    if sp != total or sc != len(centres) or sy != g["young_15_24"]:
        out.append(("FAIL", f"fp.json comarcas add up to {sp} places, {sc} centres, {sy} young (Galicia {total}, {len(centres)}, {g['young_15_24']})"))
    if len(doc["pie"]) < 10:
        out.append(("FAIL", f"fp.json has only {len(doc['pie'])} PIE"))
    for p in doc["pie"]:
        if (p["comarca"] not in keys or p["jobs_total"] < 0 or p["investment_meur"] is None or not set(p["families"]) <= famset
                or (w is not None and not (0 <= p["x"] <= w["width"] and 0 <= p["y"] <= w["height"]))):
            out.append(("FAIL", f"fp.json PIE {p.get('company')!r} is incomplete or out of the map"))
        elif not p["families"]:
            out.append(("WARN", f"fp.json PIE {p['company']!r} has no related families"))
    # Counts that depend on the 2026-11-27 sources: they warn instead of failing (the sources change).
    n = len(centres)
    if n != 216:
        out.append(("WARN", f"fp.json has {n} centres with FP offer (216 on 2026-11-27)"))
    if g["cifp"] != 28:
        out.append(("WARN", f"fp.json has {g['cifp']} CIFP (the Xunta lists 28)"))
    if not 28_000 <= total <= 31_000:
        out.append(("WARN", f"fp.json has {total} places (the ordinary-course offer was 29 071 per the Xunta dossier)"))
    if any(c["located"] == "concello" for c in centres):
        out.append(("NOTE", f"fp.json: {sum(c['located'] == 'concello' for c in centres)} centres have no coordinates and sit on their concello's centre"))
    if any(o["level"] not in ("basico", "medio", "superior") for c in centres for o in c["offer"]):
        out.append(("FAIL", "fp.json offer has a bad level"))
    if not any(x[0] == "FAIL" for x in out):
        out.append(("PASS", f"fp.json: {n} centres, {total} places, {len(doc['by_comarca'])} comarcas, {len(doc['pie'])} PIE"))
    return out
