"""CNAE-2009 division -> familia profesional de FP (helper of `fp.py`; no build(): not a builder).

Why this table exists: the FP offer is counted by professional family and the business directory (IGE 9002) by CNAE-2009
division, so comparing them needs a bridge. The plan asked for the INCUAL one first (Observatorio Profesional nº 9,
«Variación datos Familias Profesionales, diciembre 2014», anexo CNAE a cuatro dígitos con pesos por familia).

Licence finding (2026-11-27): that report is an official publication of the Ministerio de Educación (© Secretaría
General Técnica, NIPO 030-15-032-1) with no reuse licence of its own. The Ministry's aviso legal
(https://www.educacionfpydeportes.gob.es/comunes/aviso-legal.html) authorises reproducing the *texts of the portal* with
attribution and says that the rest of the content is limited to download and private use, with use, reproduction,
distribution, communication and transformation prohibited without express authorisation. A table derived from the
annex (even aggregated to divisions) would be a transformation of that content, so **nothing here is copied or derived
from the INCUAL annex**. Asking the Ministry for authorisation (publicaciones@educacion.gob.es) would allow replacing
this table with the official weights.

What this is instead: an own table, built by hand from two public things: the structure of CNAE-2009 (INE, Real Decreto
475/2007) and the scope of each professional family as its qualifications and titles describe it (the 26 classic
families of the Catálogo Nacional de Cualificaciones Profesionales plus Inteligencia artificial e data, IAD, which
appears in the 2026-27 offer). Each division lists the families whose graduates work there, with weights that add up to 1.
**The weights are a judgement**, not a measurement: round values (0.05 steps) that say which family dominates. A division
with no family has an empty list and drops out of the family shares. IAD has no CNAE division of its own and gets no
establishments: its ratio is always null.

Known limits, also written to fp.json:
* IGE 9002 counts establishments (unidades locales), not jobs, and leaves out the primary sector (CNAE 01-03) and public
  administration (84). Families that live in the primary sector (AGA, MAP) and in public services are therefore
  under-counted on the business side: their offer-to-business ratio reads too high.
* A division split over several families splits its establishments by weight: the share is an estimate.
"""

from __future__ import annotations

FAMILIES = [
    ("ADG", "Administración y gestión"), ("AFD", "Actividades físicas y deportivas"), ("AGA", "Agraria"),
    ("ARG", "Artes gráficas"), ("ART", "Artes y artesanías"), ("COM", "Comercio y marketing"),
    ("ELE", "Electricidad y electrónica"), ("ENA", "Energía y agua"), ("EOC", "Edificación y obra civil"),
    ("FME", "Fabricación mecánica"), ("HOT", "Hostelería y turismo"), ("IAD", "Inteligencia artificial y datos"),
    ("IEX", "Industrias extractivas"), ("IFC", "Informática y comunicaciones"), ("IMA", "Instalación y mantenimiento"),
    ("IMP", "Imagen personal"), ("IMS", "Imagen y sonido"), ("INA", "Industrias alimentarias"),
    ("MAM", "Madera, mueble y corcho"), ("MAP", "Marítimo-pesquera"), ("QUI", "Química"), ("SAN", "Sanidad"),
    ("SEA", "Seguridad y medio ambiente"), ("SSC", "Servicios socioculturales y a la comunidad"),
    ("TCP", "Textil, confección y piel"), ("TMV", "Transporte y mantenimiento de vehículos"), ("VIC", "Vidrio y cerámica"),
]
FAMILY_IDS = [f for f, _ in FAMILIES]
# Families whose business side IGE 9002 sees only in part (no primary sector, no public administration).
PARTIAL = {
    "AGA": "El directorio de empresas no incluye el sector primario: las empresas agrarias quedan fuera y el cociente sale alto.",
    "MAP": "El directorio de empresas no incluye la pesca ni la acuicultura primaria: el cociente sale alto.",
    "SAN": "Parte de la sanidad es pública y el directorio cuenta un solo establecimiento por centro: el cociente sale alto.",
    "SSC": "Parte de la educación y de los servicios sociales es pública y el directorio cuenta un solo establecimiento por centro: el cociente sale alto.",
    "IAD": "Familia nueva sin actividad CNAE propia: no tiene cifra de empresas.",
}

# division -> [(family, weight)], weights add up to 1; [] = no family. Judgement, see the module docstring.
DIVISION_FAMILIES: dict[str, list[tuple[str, float]]] = {
    "05": [], "06": [], "07": [("IEX", 1.0)], "08": [("IEX", 1.0)], "09": [("IEX", 1.0)],
    "10": [("INA", 1.0)], "11": [("INA", 1.0)], "12": [("INA", 1.0)],
    "13": [("TCP", 1.0)], "14": [("TCP", 1.0)], "15": [("TCP", 1.0)],
    "16": [("MAM", 1.0)], "17": [("QUI", 0.5), ("ARG", 0.5)], "18": [("ARG", 1.0)],
    "19": [("QUI", 1.0)], "20": [("QUI", 1.0)], "21": [("QUI", 1.0)], "22": [("QUI", 1.0)],
    "23": [("VIC", 0.4), ("IEX", 0.3), ("EOC", 0.3)],
    "24": [("FME", 1.0)], "25": [("FME", 1.0)], "26": [("ELE", 0.8), ("IFC", 0.2)], "27": [("ELE", 1.0)],
    "28": [("FME", 0.7), ("IMA", 0.3)], "29": [("TMV", 0.5), ("FME", 0.5)],
    "30": [("FME", 0.6), ("TMV", 0.3), ("MAP", 0.1)], "31": [("MAM", 1.0)],
    "32": [("ART", 0.5), ("FME", 0.3), ("SAN", 0.2)], "33": [("IMA", 0.6), ("FME", 0.2), ("ELE", 0.2)],
    "35": [("ENA", 0.6), ("ELE", 0.4)], "36": [("ENA", 1.0)], "37": [("ENA", 0.5), ("SEA", 0.5)],
    "38": [("SEA", 1.0)], "39": [("SEA", 1.0)],
    "41": [("EOC", 1.0)], "42": [("EOC", 1.0)], "43": [("EOC", 0.5), ("IMA", 0.25), ("ELE", 0.25)],
    "45": [("TMV", 0.8), ("COM", 0.2)], "46": [("COM", 0.85), ("ADG", 0.15)], "47": [("COM", 0.9), ("ADG", 0.1)],
    "49": [("COM", 0.5), ("TMV", 0.5)], "50": [("MAP", 1.0)], "51": [("TMV", 0.6), ("COM", 0.4)],
    "52": [("COM", 0.8), ("MAP", 0.2)], "53": [("COM", 0.5), ("ADG", 0.5)],
    "55": [("HOT", 1.0)], "56": [("HOT", 1.0)],
    "58": [("ARG", 0.5), ("IMS", 0.5)], "59": [("IMS", 1.0)], "60": [("IMS", 1.0)],
    "61": [("IFC", 0.7), ("ELE", 0.3)], "62": [("IFC", 1.0)], "63": [("IFC", 1.0)],
    "64": [("ADG", 1.0)], "65": [("ADG", 1.0)], "66": [("ADG", 1.0)], "68": [("COM", 0.5), ("ADG", 0.5)],
    "69": [("ADG", 1.0)], "70": [("ADG", 1.0)], "71": [("EOC", 0.5), ("IMA", 0.2), ("ELE", 0.15), ("QUI", 0.15)],
    "72": [("QUI", 0.3), ("SAN", 0.3), ("IFC", 0.2), ("ELE", 0.2)], "73": [("COM", 0.6), ("IMS", 0.2), ("ARG", 0.2)],
    "74": [("IMS", 0.5), ("ART", 0.3), ("ADG", 0.2)], "75": [("AGA", 0.5), ("SAN", 0.5)],
    "77": [("COM", 0.4), ("TMV", 0.3), ("ADG", 0.3)], "78": [("ADG", 1.0)], "79": [("HOT", 0.7), ("COM", 0.3)],
    "80": [("SEA", 1.0)], "81": [("SSC", 0.4), ("AGA", 0.3), ("IMA", 0.3)], "82": [("ADG", 1.0)],
    "85": [("SSC", 0.7), ("AFD", 0.3)], "86": [("SAN", 0.9), ("SSC", 0.1)], "87": [("SSC", 0.5), ("SAN", 0.5)],
    "88": [("SSC", 1.0)],
    "90": [("IMS", 0.4), ("ART", 0.4), ("AFD", 0.2)], "91": [("SSC", 0.5), ("ADG", 0.3), ("ART", 0.2)],
    "92": [("HOT", 0.5), ("ADG", 0.5)], "93": [("AFD", 0.8), ("HOT", 0.2)], "94": [("ADG", 0.5), ("SSC", 0.5)],
    "95": [("IFC", 0.4), ("ELE", 0.4), ("IMA", 0.2)], "96": [("IMP", 0.7), ("TCP", 0.2), ("SSC", 0.1)],
}


def problems() -> list[str]:
    """Self-check of the table: unknown family, weights that do not add up to 1."""
    out = []
    for div, items in DIVISION_FAMILIES.items():
        for fam, w in items:
            if fam not in FAMILY_IDS or not 0 < w <= 1:
                out.append(f"division {div}: bad family or weight {fam!r} {w!r}")
        if items and abs(sum(w for _, w in items) - 1) > 1e-9:
            out.append(f"division {div}: weights add up to {sum(w for _, w in items)}")
    return out


def family_units(units_by_division: dict[str, float | None]) -> dict[str, float]:
    """{family: weighted establishments} from {division: establishments}. A division missing from the table raises KeyError."""
    out = {f: 0.0 for f in FAMILY_IDS}
    for div, n in units_by_division.items():
        for fam, w in DIVISION_FAMILIES[div]:
            out[fam] += (n or 0) * w
    return out
