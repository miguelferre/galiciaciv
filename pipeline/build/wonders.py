"""Wonders: World Heritage sites, the most extensively protected listed monuments and the national park (D-002).

Adapted from usaciv's build/wonders.py (Karpathy, MIT). Every wonder is chosen by a rule that is written in the file:

* unesco: sites on the World Heritage List with a number of their own in Galicia (347, 987, 1312) and the Galician
  parts of the serial property 669bis (the Caminos), from Wikidata. The 669-NNN elements of the Camino Francés are
  not wonders one by one;
* bic: monuments listed as Bien de Interés Cultural (category «Monumento») ranked by the size of their «área
  integral» of protection. The register grades no BIC above another: the size measures how much ground is protected,
  not how strictly. Monuments within UNESCO_KM of a World Heritage point are left to that wonder. As many as fit
  under MAX_WONDERS;
* parque_nacional: the Illas Atlánticas national park, drawn on its largest part, with the hexes it covers.

No monument is picked by hand.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

from ..core.hexgrid import HexGrid
from ..core.store import load_interim, load_interim_payload, write_web
from .galicia import comarca_tables, concello_info
from .placing import SITE_KM, Placer, inside

REQUIRES = ["_world", "wikidata_unesco", "visaf_bic", "ign_ppnn", "ige_comarcas", "ign_limites", "cities.json"]
PRODUCES = ["wonders.json"]

MAX_WONDERS = 25
UNESCO_KM = 0.6  # a BIC monument this close to a World Heritage point is that wonder
WORLD_HERITAGE_OWN = ("347", "987", "1312")  # properties with their own number
SERIAL_PREFIX = "669bis-"  # the Galician parts of the Caminos serial property
PARK_NAME = "Parque Nacional das Illas Atlánticas de Galicia"


def rules(n_bic: int, n_monuments: int, n_camino: int) -> list[dict]:
    return [
        {"id": "unesco", "kind": "landmark", "kinds": ["landmark"], "name": "Patrimonio Mundial", "year": 2026,
         "text": "Patrimonio Mundial de la UNESCO en Galicia según Wikidata (identificador P757): los bienes con número "
                 f"propio ({', '.join(WORLD_HERITAGE_OWN)}) y las partes gallegas del bien en serie 669bis (Caminos). "
                 f"Los {n_camino} elementos asociados al Camino Francés (669-…) no cuentan uno a uno. Orden alfabético."},
        {"id": "bic", "kind": "landmark", "kinds": ["landmark"], "name": "Bien de Interés Cultural", "year": 2026,
         "text": f"Los {n_bic} BIC de categoría Monumento (de {n_monuments}) con mayor área integral de protección en "
                 "el registro de la Xunta. El registro no gradúa los BIC: la superficie dice cuánto terreno se protege, "
                 "no con cuánta fuerza. Quedan fuera los que ya son Patrimonio Mundial. La superficie se asigna a cada "
                 "monumento por posición y nombre: revisar antes de publicar."},
        {"id": "parque_nacional", "kind": "natural", "kinds": ["natural"], "name": "Parque nacional", "year": 2002,
         "text": "El parque nacional de Galicia (límite del IGN y el OAPN), dibujado en su mayor parte. Incluye aguas."},
    ]


def motif_of(name: str) -> str:
    """Which sprite of render/art/sites.js stands for a monument, by the first word that names its kind."""
    low = name.lower()
    for words, motif in ((("faro", "torre de hércules"), "coast"), (("muralla",), "brickhall"),
                         (("casco", "cidade vella"), "quarter"), (("castro", "dolmen", "dólmen"), "mound"),
                         (("catedral", "colexiata"), "spire"),
                         (("mosteiro", "monasterio", "convento", "santuario", "igrexa", "templo"), "mission"),
                         (("pazo",), "rotunda"), (("torre", "torres", "castelo"), "obelisk"), (("ponte",), "bridge")):
        if any(low.startswith(w) for w in words):
            return motif
    return "memorial"


# ------------------------------------------------------------------ geometry


def area_centroid(ring: list) -> tuple[float, float, float]:
    """(area, x, y) of a projected ring (shoelace)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-12:
        return 0.0, ring[0][0], ring[0][1]
    return abs(a) / 2, cx / (3 * a), cy / (3 * a)


# ------------------------------------------------------------------ wonders


class Maker:
    def __init__(self):
        self.place = Placer()
        self.info = concello_info()
        comarcas, self.comarca_of = comarca_tables()
        self.comarcas = comarcas

    def wonder(self, id, name, kind, rule, lon, lat, concello, metrics) -> dict | None:
        at = self.place.place(lon, lat)
        if at is None:
            print(f"    ! wonder without a Galician hex: {name}")
            return None
        if concello in self.comarca_of:  # the publisher's concello wins over the hex centre's
            comarca = self.comarcas[self.comarca_of[concello]]
            at.update(county=concello, cbsa=concello if concello in self.place.city_ids else None,
                      state=comarca["abbr"])
        county = at["county"]
        comarca = self.comarcas[self.comarca_of[county]]["name"] if county in self.comarca_of else None
        return {"id": id, "name": name, "short": name, "kind": kind, "rule": rule, "rank": 0, "motif": motif_of(name),
                "metrics": {**metrics, "concello": self.info[county]["name"] if county in self.info else None},
                "cells": None, "curated": False, "state_name": comarca, **at}

    def unesco(self, items: list[dict]) -> list[dict]:
        out = []
        for it in items:
            uid = it["unesco_id"]
            if uid not in WORLD_HERITAGE_OWN and not uid.startswith(SERIAL_PREFIX):
                continue
            name = it["name_es"][:1].upper() + it["name_es"][1:]
            w = self.wonder(f"unesco-{uid}", name, "landmark", "unesco", it["lon"], it["lat"], it["concello_ine"],
                            {"unesco_id": uid})
            if w:
                out.append(w)
        out.sort(key=lambda w: w["name"])
        return out

    def monuments(self, items: list[dict], heritage: list[dict], room: int) -> list[dict]:
        ranked = sorted((i for i in items if i["category"] == "Monumento" and i["area_integral_ha"]),
                        key=lambda i: (-i["area_integral_ha"], i["name"]))
        out, used = [], set()
        for it in ranked:
            if len(out) == room:
                break
            x, y = self.place.proj(it["lon"], it["lat"])
            if any(math.dist((x, y), (h["x"], h["y"])) < UNESCO_KM for h in heritage):
                continue
            key = (it["id"], round(it["area_integral_ha"], 4))  # two rows sharing a register entry and its polygon
            if key in used:
                continue
            used.add(key)
            w = self.wonder(f"bic-{it['id']}-{it['attrs']['OBJECTID']}", it["name"], "landmark", "bic", it["lon"],
                            it["lat"], it["concello_ine"],
                            {"category": it["category"], "protected_km2": round(it["area_integral_ha"] / 100, 4),
                             "register_id": it["id"]})
            if w:
                out.append(w)
        return out

    def park(self, park: dict) -> dict:
        grid: HexGrid = self.place.grid
        rings = [[self.place.proj(lon, lat) for lon, lat in r] for r in park["rings"]]
        _, x, y = max((area_centroid(r) for r in rings), key=lambda t: t[0])
        cell = grid.cell_at(x, y)
        cells = {i for i in range(grid.size) if any(inside(grid.center(*grid.col_row(i)), r) for r in rings)}
        cells.add(cell)
        owner = self.place.owner
        tags = self.place.tags(cell) if owner[cell] >= 0 else {"county": None, "cbsa": None, "state": None}
        return {"id": "pn-illas-atlanticas", "name": PARK_NAME, "short": "Illas Atlánticas", "kind": "natural",
                "rule": "parque_nacional", "rank": 1, "motif": "coast",
                "metrics": {"area_km2": round(park["area_ha"] / 100, 1), "declared": park["declared"][:4]},
                "cells": sorted(cells), "curated": False, "state_name": None,
                "x": round(x, 1), "y": round(y, 1), "cell": cell, **tags}


def build() -> None:
    make = Maker()
    heritage_in = load_interim_payload("wikidata_unesco")
    bic_in = load_interim_payload("visaf_bic")
    park_in = load_interim_payload("ign_ppnn")
    items = heritage_in["data"]["items"]
    heritage = make.unesco(items)
    park = make.park(park_in["data"]["parks"][0])
    monuments = make.monuments(bic_in["data"]["items"], heritage, MAX_WONDERS - len(heritage) - 1)
    wonders = heritage + monuments + [park]
    rank = Counter()
    for w in wonders:
        rank[w["rule"]] += 1
        w["rank"] = rank[w["rule"]]

    n_monuments = sum(1 for i in bic_in["data"]["items"] if i["category"] == "Monumento")
    camino = len({i["qid"] for i in items if i["unesco_id"].startswith("669-")})
    doc = {
        "version": 1,
        "vintage": {"unesco": heritage_in["vintage"], "bic": bic_in["vintage"], "park": park_in["vintage"]},
        "sources": ["wikidata_unesco", "visaf_bic", "ign_ppnn"],
        "rules": rules(len(monuments), n_monuments, camino),
        "national": {"bic": len(bic_in["data"]["items"]), "bic_monuments": n_monuments,
                     "camino_elements": camino},
        "wonders": wonders,
    }
    write_web("wonders.json", doc)
    print(f"    {len(wonders)} wonders: {len(heritage)} World Heritage, {len(monuments)} BIC monuments, 1 national park "
          f"({len(park['cells'])} hexes)")
    for w in wonders:
        extra = w["metrics"].get("protected_km2")
        print(f"      {w['rule']:15} {w['rank']:2} {w['name']} ({w['metrics'].get('concello') or 'mar'})"
              + (f" {extra * 100:.1f} ha" if extra is not None else ""))


# ------------------------------------------------------------------ check


def check(web_dir: Path) -> list[tuple[str, str]]:
    path = Path(web_dir) / "wonders.json"
    if not path.exists():
        return [("NOTE", "wonders.json not built (optional; run: build wonders --deps)")]
    out = []
    doc = json.loads(path.read_text(encoding="utf-8"))
    for k in ("version", "vintage", "sources", "rules", "wonders"):
        if k not in doc:
            out.append(("FAIL", f"wonders.json lacks '{k}'"))
    if out:
        return out
    if doc["version"] != 1:
        out.append(("FAIL", f"wonders.json version {doc['version']!r} (expected 1)"))
    wpath = Path(web_dir) / "world.json"
    world = json.loads(wpath.read_text(encoding="utf-8")) if wpath.exists() else None
    if not world or "grid" not in world:
        return out + [("NOTE", "wonders.json: world.json unavailable, cell checks skipped")]
    grid = HexGrid(world["grid"]["radius"], world["grid"]["cols"], world["grid"]["rows"])
    owner = world.get("owner") or []
    county_ids = {c["geoid"] for c in world.get("counties", [])}
    cpath = Path(web_dir) / "cities.json"
    city_ids = {c["id"] for c in json.loads(cpath.read_text(encoding="utf-8"))} if cpath.exists() else None
    spath = Path(web_dir) / "sources.json"
    if spath.exists():
        ids = {s["id"] for s in json.loads(spath.read_text(encoding="utf-8"))}
        miss = [s for s in doc["sources"] if s not in ids]
        if miss:
            out.append(("WARN", f"wonders.json cites sources missing from sources.json: {miss}"))

    rule_by_id = {r.get("id"): r for r in doc["rules"]}
    probs = [f"rule {r.get('id')} lacks text" for r in doc["rules"] if not r.get("text")]
    ranks: dict[str, list] = {}
    for w in doc["wonders"]:
        lacking = [k for k in ("id", "name", "kind", "rule", "rank", "metrics", "x", "y", "cell") if k not in w]
        if lacking:
            probs.append(f"{w.get('id')}: lacks {lacking}")
            continue
        rule = rule_by_id.get(w["rule"])
        if rule is None or w["kind"] not in rule.get("kinds", []):
            probs.append(f"{w['id']}: rule or kind unknown")
        ranks.setdefault(w["rule"], []).append(w["rank"])
        c = w["cell"]
        if not isinstance(c, int) or not 0 <= c < grid.size:
            probs.append(f"{w['id']}: cell {c!r}")
            continue
        at_sea = w["rule"] == "parque_nacional"
        if len(owner) == grid.size and (owner[c] == -2 or (owner[c] < 0 and not at_sea)):
            probs.append(f"{w['id']}: cell {c} is not Galician land")
        if math.dist(grid.center(*grid.col_row(c)), (w["x"], w["y"])) > SITE_KM + 3 * grid.radius:
            probs.append(f"{w['id']}: x/y far from its cell")
        cells = w.get("cells")
        if cells is not None and not all(isinstance(i, int) and 0 <= i < grid.size for i in cells):
            probs.append(f"{w['id']}: bad cells")
        if w.get("county") is not None and county_ids and w["county"] not in county_ids:
            probs.append(f"{w['id']}: unknown county {w['county']}")
        if w.get("cbsa") is not None and city_ids is not None and w["cbsa"] not in city_ids:
            probs.append(f"{w['id']}: unknown cbsa {w['cbsa']}")
    ids = [w.get("id") for w in doc["wonders"]]
    if len(ids) != len(set(ids)):
        probs.append("duplicate ids")
    for rule, got in ranks.items():
        if sorted(got) != list(range(1, len(got) + 1)):
            probs.append(f"rule {rule}: ranks are not 1..N")
    if probs or not doc["wonders"]:
        out.append(("FAIL", f"wonders.json: {len(probs)} problems, e.g. {probs[:3]}"))
    else:
        per = Counter(w["rule"] for w in doc["wonders"])
        out.append(("PASS", f"wonders.json: {len(doc['wonders'])} wonders ("
                            + ", ".join(f"{k} {v}" for k, v in sorted(per.items())) + ")"))
    if not 20 <= len(doc["wonders"]) <= MAX_WONDERS:
        out.append(("WARN", f"wonders.json holds {len(doc['wonders'])} wonders (expected 20-{MAX_WONDERS})"))
    size = path.stat().st_size
    if size > 300_000:
        out.append(("WARN", f"wonders.json is {size / 1e3:.0f} kB (eager files should stay under ~300 kB)"))
    return out
