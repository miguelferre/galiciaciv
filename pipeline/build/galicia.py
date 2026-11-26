"""Shared helpers of the Galician builders (no build(): not a builder).

* comarca_abbrs: a unique short code per comarca (the viewer shows it as a label fallback).
* concello_info: name, province, area and centroid of each concello, from the IGN límites interim.
* Spanish labels and the exact sector keys used by cities, comarcas and the nation.
"""

from __future__ import annotations

import re
import unicodedata

from ..core.store import load_interim

# Words that carry no identity in a comarca name ("A Barcala", "O Salnés", "Terra de Melide").
SKIP = {"a", "o", "as", "os", "de", "do", "da", "dos", "das", "e", "terra", "val", "ou"}

# Job sectors (IGE 11497 keys -> key used in cities/states/nation "jobs", Spanish label).
JOB_KEYS = {"agro": "agricultura", "industria": "industria", "construcion": "construccion", "servizos": "servicios"}
JOB_LABELS = {
    "agricultura": "Agricultura e pesca",
    "industria": "Industria",
    "construccion": "Construcción",
    "servicios": "Servicios",
}


def display_name(name: str) -> str:
    """'Coruna, A' -> 'A Coruna': the registers file names with the article last; the official name has it first."""
    m = re.fullmatch(r"(.+), (A|O|As|Os)", name.strip())
    return f"{m.group(2)} {m.group(1)}" if m else name.strip()


def _fold(s: str) -> str:
    return re.sub(r"[^A-Z]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper())


def comarca_abbrs(comarcas: list[dict]) -> dict[str, str]:
    """{comarca code: abbr}. Unique, 2-6 capital ASCII letters, stable (decided in code order)."""
    used: set[str] = set()
    out: dict[str, str] = {}
    for c in sorted(comarcas, key=lambda c: c["code"]):
        words = [_fold(w) for w in re.split(r"[\s\-']+", c["name"]) if w]
        words = [w for w in words if w]
        strong = [w for w in words if w.lower() not in SKIP] or words
        w0 = strong[0]
        cands = [w0[:4], w0[:3], w0[:5], w0[:6]]
        if len(strong) > 1:
            cands += [w0[:2] + strong[1][:2], w0[:3] + strong[1][:1], w0[:3] + strong[1][:2]]
        cands += [w0[:3] + p for p in ("2", "3", "4", "5")]
        pick = next((k for k in cands if len(k) >= 2 and k not in used), None)
        if pick is None:
            pick = c["code"]
        used.add(pick)
        out[c["code"]] = pick
    return out


def ring_centroid(ring) -> tuple[float, float, float]:
    """(lon, lat, |area|) of one ring by the shoelace formula (planar, fine at this scale)."""
    a = cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        cr = x0 * y1 - x1 * y0
        a += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    if abs(a) < 1e-12:
        return sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n, 0.0
    return cx / (3 * a), cy / (3 * a), abs(a) / 2


def concello_info() -> dict[str, dict]:
    """{INE code: {name, province, area_km2, lon, lat}}; the point is the centroid of the concello's largest ring."""
    out = {}
    for c in load_interim("ign_limites")["counties"]:
        best = max((ring_centroid(r) for r in c["rings"]), key=lambda t: t[2])
        out[c["geoid"]] = {"name": display_name(c["name"]), "province": c["province"], "area_km2": c["area_km2"],
                           "lon": best[0], "lat": best[1]}
    return out


def comarca_tables() -> tuple[dict[str, dict], dict[str, str]]:
    """({comarca code: comarca record + abbr}, {concello code: comarca code}) from ige_comarcas."""
    ige = load_interim("ige_comarcas")
    abbr = comarca_abbrs(ige["comarcas"])
    return {c["code"]: {**c, "abbr": abbr[c["code"]]} for c in ige["comarcas"]}, ige["concellos"]
