"""Tile resources: wind turbines, active quarries and fish auctions (lonjas), placed on the hex map.

Adapted from usaciv's build/resources.py (Karpathy, MIT). Like a strategic resource on a Civ tile:

* wind: turbines of the Xunta's layer counted per hex (the layer has no capacity, and it mixes parks in operation,
  authorised and under construction); a hex shows with at least WIND_PER_KM2 machines per km² of hex;
* quarries: IGME BDMIN workings marked active, grouped by their first substance and counted per hex; a hex shows
  with at least QUARRY_PER_KM2 workings of one group per km² of hex, never less than one (the register carries no
  size). Both thresholds follow the grid's hex radius (2 turbines and 1 quarry on 1 km hexes);
* lonjas: first-sale value of fresh fish in the year (Pesca de Galicia), summed per concello and drawn on the
  concello's coast hex (the files have no coordinates; a lonja that matches no concello is left out).

Dams, mussel rafts and forestry are left out: no download by script (D-002, tanda 2).
`types` is listed in rank order; `summary` totals the mapped items per type, for Galicia and per comarca.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

from ..core.store import load_interim, load_interim_payload, write_web
from .galicia import concello_info
from .placing import NEAR_KM, Placer

REQUIRES = ["_world", "xunta_eolica", "igme_bdmin", "pesca_lonxas", "ige_comarcas", "ign_limites", "cities.json"]
PRODUCES = ["resources.json"]

WIND_PER_KM2 = 0.62  # turbines per km² of hex for the hex to show
QUARRY_PER_KM2 = 0.123  # active workings of one group per km² of hex


def thresholds(radius: float) -> tuple[int, int]:
    """(turbines, quarries) a hex of this radius needs to show."""
    area = 1.5 * math.sqrt(3) * radius ** 2
    return max(2, round(WIND_PER_KM2 * area)), max(1, round(QUARRY_PER_KM2 * area))


def _t(id, name, category, emoji, icon, color, unit, description, source):
    return {"id": id, "name": name, "category": category, "emoji": emoji, "icon": icon, "color": color,
            "unit": unit, "description": description, "source": source}


def resource_types(wind_min: int, quarry_min: int) -> list[dict]:
    """The resource types in rank order, with the thresholds of this grid written in their descriptions."""
    many = f"{quarry_min} o más del mismo grupo" if quarry_min > 1 else "alguna del grupo"

    def quarry(id, name, emoji, icon, color, what):
        return _t(id, name, "mineral", emoji, icon, color, "explotaciones",
                  f"{what} Explotaciones marcadas como activas (continuas o intermitentes) en la base BDMIN del IGME, "
                  f"agrupadas por su primera sustancia. Se muestra un hexágono con {many}; la base no da tamaño ni "
                  "producción, y el servicio es de 2015: «activa» puede no serlo hoy.", "igme_bdmin")

    return [
        _t("eolico", "Parques eólicos", "energy", "🌬️", "r-wind", "#9fd8cb", "aerogeneradores",
           f"Aerogeneradores de la capa de energía eólica de la Xunta; se muestra un hexágono con {wind_min} o más. "
           "La capa junta parques en funcionamiento, autorizados y en obras, y no da potencia ni estado.",
           "xunta_eolica"),
        quarry("pizarra", "Pizarra", "🪨", "r-molybdenum", "#6f7f8f", "Canteras de pizarra."),
        quarry("granito", "Granito", "⛰️", "r-coal_mine", "#b9a99a", "Canteras de granito y granitoides."),
        quarry("cuarzo", "Cuarzo y cuarcita", "💎", "r-platinum", "#d9d4e6", "Cuarzo y cuarcita."),
        quarry("caliza", "Caliza y magnesita", "🧱", "r-iron", "#d8c9a3", "Caliza, dolomía y magnesita."),
        quarry("arcilla", "Arcilla y caolín", "🏺", "r-copper", "#b87333", "Arcilla y caolín."),
        quarry("otras_rocas", "Otras rocas y minerales", "⛏️", "r-lead_zinc", "#4a4038",
               "Esquisto, gneis, gravas, arenas y otras sustancias."),
        _t("lonja", "Lonja", "agri", "🐟", "r-lonja", "#3fa7d6", "€",
           "Lonjas de Galicia: valor de la primera venta de pesca fresca en el año, sumado por concello. Se dibuja en "
           "la casilla de costa del concello (los ficheros no dan coordenadas).", "pesca_lonxas"),
    ]

GROUPS = {"Pizarra": "pizarra", "Granito / Granitoide": "granito", "Cuarzo": "cuarzo", "Cuarcita": "cuarzo",
          "Caliza": "caliza", "Dolomía": "caliza", "Magnesita": "caliza", "Arcilla": "arcilla",
          "Caolín (grupo)": "arcilla"}


# ------------------------------------------------------------------ text helpers


def _fmt(n: float, d: int = 0) -> str:
    """es-ES number: 19484.4 → «19.484», with d decimals after a comma."""
    return f"{n:,.{d}f}".replace(",", " ").replace(".", ",").replace(" ", ".")


def _money(eur: float) -> str:
    return f"{_fmt(eur / 1e6, 1)} M €" if eur >= 1e6 else f"{_fmt(eur)} €"


SMALL = {"a", "o", "as", "os", "de", "do", "da", "dos", "das", "e", "y"}
ROMAN = {"i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi"}


def title(name: str) -> str:
    """Park names come in capitals: «SERRA DA PANDA II» → «Serra da Panda II»."""
    words = " ".join(name.split()).lower().split(" ")
    out = []
    for k, w in enumerate(words):
        core = w.strip("()")
        if core in ROMAN:
            out.append(w.upper())
        elif k and core in SMALL:
            out.append(w)
        else:  # capital at the start and after a hyphen or an opening mark
            out.append(re.sub(r"(^[(«\"]*|-)(\w)", lambda m: m.group(1) + m.group(2).upper(), w))
    return " ".join(out)


# ------------------------------------------------------------------ items


def _item(place: Placer, type_id: str, name: str, cell: int, value, detail: str, xy=None, concello=None) -> dict:
    x, y = xy or place.grid.center(*place.grid.col_row(cell))
    if place.grid.cell_at(round(x, 1), round(y, 1)) != cell:  # snapped or mean point outside its hex
        x, y = place.grid.center(*place.grid.col_row(cell))
    tags = place.tags(cell, concello)
    return {"type": type_id, "name": name, "x": round(x, 1), "y": round(y, 1), "cell": cell, "value": value,
            "detail": detail, "state": tags["state"], "cbsa": tags["cbsa"]}


def _main_concello(group: list[tuple]) -> str | None:
    """The concello holding most sites of a hex (the 4th field of each)."""
    found = Counter(g[3] for g in group if g[3])
    return found.most_common(1)[0][0] if found else None


def wind(place: Placer, turbines: list[dict]) -> tuple[list[dict], int]:
    cells = defaultdict(list)
    lost = 0
    for t in turbines:
        at = place.place(t["lon"], t["lat"], km=NEAR_KM)
        if at is None:
            lost += 1
        else:
            cells[at["cell"]].append((t["park"], at["x"], at["y"], at["county"]))
    items = []
    wind_min, _ = thresholds(place.grid.radius)
    for cell, group in sorted(cells.items()):
        if len(group) < wind_min:
            continue
        parks = Counter(title(g[0]) for g in group).most_common()
        name = parks[0][0] + (f" (+{len(parks) - 1})" if len(parks) > 1 else "")
        listed = ", ".join(f"{p} ({n})" for p, n in parks[:4]) + (f" y {len(parks) - 4} más" if len(parks) > 4 else "")
        xy = (sum(g[1] for g in group) / len(group), sum(g[2] for g in group) / len(group))
        items.append(_item(place, "eolico", name, cell, len(group),
                           f"{listed}. En marcha, autorizados o en obras.", xy, _main_concello(group)))
    return items, lost


def quarries(place: Placer, sites: list[dict], info: dict) -> tuple[list[dict], int]:
    cells = defaultdict(list)
    lost = 0
    for s in sites:
        if not (s["status"] or "").startswith("Activa"):
            continue
        at = place.place(s["lon"], s["lat"], km=NEAR_KM)
        if at is None:
            lost += 1
            continue
        first = (s["substance"] or "").split(",")[0].strip()
        cells[(at["cell"], GROUPS.get(first, "otras_rocas"))].append((s, at["x"], at["y"], at["county"]))
    wind_min, quarry_min = thresholds(place.grid.radius)
    labels = {t["id"]: t["name"] for t in resource_types(wind_min, quarry_min)}
    items = []
    for (cell, group_id), group in sorted(cells.items()):
        if len(group) < quarry_min:
            continue
        county = _main_concello(group)
        where = info[county]["name"] if county in info else "Galicia"
        subs = Counter(g[0]["substance"] for g in group).most_common(3)
        detail = f"{len(group)} explotaciones activas: " + ", ".join(f"{k.lower()} ({n})" for k, n in subs)
        xy = (sum(g[1] for g in group) / len(group), sum(g[2] for g in group) / len(group))
        items.append(_item(place, group_id, f"{labels[group_id]} en {where}", cell, len(group), detail, xy, county))
    return items, lost


def coast_cell(place: Placer, concello: str, lon: float, lat: float) -> int:
    """The concello's land hex touching water nearest to (lon, lat); without one, the hex at the point."""
    grid, owner, water = place.grid, place.owner, place.world["water"]
    ci = place.geoids.index(concello)
    x, y = place.proj(lon, lat)
    coast = [i for i, c in enumerate(place.county)
             if c == ci and owner[i] >= 0 and any(water[n] for n in grid.neighbours(i))]
    if coast:
        return min(coast, key=lambda i: math.dist(grid.center(*grid.col_row(i)), (x, y)))
    return place.land_cell(x, y)


def lonjas(place: Placer, doc: dict, info: dict) -> list[dict]:
    by = defaultdict(list)
    for l in doc["lonjas"]:
        by[l["concello"]].append(l)
    items = []
    for concello, group in sorted(by.items()):
        group.sort(key=lambda l: -l["eur"])
        c = info[concello]
        cell = coast_cell(place, concello, c["lon"], c["lat"])
        if cell < 0:
            print(f"    ! lonja without a hex: {group[0]['name']}")
            continue
        eur = sum(l["eur"] for l in group)
        kg = sum(l["kg"] for l in group)
        species = defaultdict(float)
        for l in group:
            for s in l["top_species"]:
                species[s["name"]] += s["eur"]
        top = sorted(species.items(), key=lambda kv: -kv[1])[:3]
        detail = (f"Primera venta {doc['year']}: {_money(eur)}, {_fmt(kg / 1000)} t. "
                  + "Destacan: " + ", ".join(f"{n} ({_money(v)})" for n, v in top))
        if len(group) > 1:
            detail += ". Lonjas: " + ", ".join(f"{l['name']} ({_money(l['eur'])})" for l in group)
        name = f"Lonja de {group[0]['name']}" + (f" (+{len(group) - 1})" if len(group) > 1 else "")
        items.append(_item(place, "lonja", name, cell, round(eur), detail, concello=concello))
    return items


# ------------------------------------------------------------------ summary


SUMMARY_NOTE = ("Suma solo de lo que se ve en el mapa: cada tipo tiene un umbral (ver su descripción), así que no es "
                "el total de una comarca ni de Galicia.")


def summarize(items: list[dict], types: list[dict]) -> dict:
    """Galicia-wide and per-comarca {type: {count, value, unit}} over the mapped items."""
    by_id = {t["id"]: t for t in types}

    def blank(t):
        return {"count": 0, "value": 0, "unit": t["unit"]}

    national = {t["id"]: blank(t) for t in types}
    states: dict[str, dict] = {}
    for it in items:
        t = by_id[it["type"]]
        rows = [national[t["id"]]]
        if it["state"]:
            rows.append(states.setdefault(it["state"], {}).setdefault(t["id"], blank(t)))
        for row in rows:
            row["count"] += 1
            row["value"] += it["value"] or 0
    return {"note": SUMMARY_NOTE, "national": national, "states": dict(sorted(states.items()))}


# ------------------------------------------------------------------ build


def build() -> None:
    place = Placer()
    info = concello_info()
    eol = load_interim_payload("xunta_eolica")
    mines = load_interim("igme_bdmin")
    fish = load_interim("pesca_lonxas")
    turbine_items, lost_t = wind(place, eol["data"]["turbines"])
    quarry_items, lost_q = quarries(place, mines["sites"], info)
    lonja_items = lonjas(place, fish, info)
    items = turbine_items + quarry_items + lonja_items
    all_types = resource_types(*thresholds(place.grid.radius))
    rank = {t["id"]: i for i, t in enumerate(all_types)}
    items.sort(key=lambda it: (rank[it["type"]], -(it["value"] or 0), it["cell"]))
    present = {it["type"] for it in items}
    types = [t for t in all_types if t["id"] in present]
    write_web("resources.json", {"types": types, "items": items, "summary": summarize(items, types)})
    counts = Counter(it["type"] for it in items)
    print("    " + ", ".join(f"{t['id']} {counts[t['id']]}" for t in types))
    for u in fish["unmatched"]:
        print(f"    ! lonja without a concello, left out: {u['name']} ({_money(u['eur'])})")
    if lost_t or lost_q:
        print(f"    ! outside Galician hexes: {lost_t} turbines, {lost_q} quarries")
