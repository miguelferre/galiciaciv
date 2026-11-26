"""Ríos y embalses de Galicia desde OpenStreetMap (Overpass API).

Natural Earth no trae Miño, Sil, Ulla ni Tambre, así que los ríos y los embalses salen de OSM.
Dos consultas Overpass (GET con `data=`), cacheadas en data/raw/osm_rios/ como cualquier otra descarga.
"""

import json
import math
import re
import urllib.parse

from ..core.source import Source, SourceInfo

OVERPASS = "https://overpass-api.de/api/interpreter"
BBOX = (41.7, -9.5, 43.9, -6.6)  # sur, oeste, norte, este (orden de Overpass): Galicia y un margen
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}

MIN_RIVER_KM = 25.0  # los ríos más cortos quedan fuera (afluentes menores)
MIN_LAKE_KM2 = 2.0  # embalses y lagos menores de 2 km² no llegan a un hexágono (2,6 km²)
# Rangos como los de Natural Earth (1 = el mayor): el visor ancha la boca del río con (10 - rango).
# Por longitud total de las vías con nombre dentro de la ventana (incluye el tramo fuera de Galicia).
RANK_BY_KM = [(200, 2), (100, 3), (60, 4), (40, 5), (0, 6)]


def _q(body):
    s, w, n, e = BBOX
    return f"[out:json][timeout:180][bbox:{s},{w},{n},{e}];({body});out geom;"


QUERIES = {
    "rios": _q('way["waterway"="river"]["name"];'),
    "embalses": _q('way["natural"="water"]["water"~"reservoir|lake"];relation["natural"="water"]["water"~"reservoir|lake"];'),
}


def _km(line):
    """Longitud en km de una línea [(lon, lat)] (haversine)."""
    t = 0.0
    for (x0, y0), (x1, y1) in zip(line, line[1:]):
        p0, p1 = math.radians(y0), math.radians(y1)
        a = math.sin((p1 - p0) / 2) ** 2 + math.cos(p0) * math.cos(p1) * math.sin(math.radians(x1 - x0) / 2) ** 2
        t += 12742.0176 * math.asin(math.sqrt(a))
    return t


def _pts(geom):
    return [(round(g["lon"], 5), round(g["lat"], 5)) for g in geom]


def _ring_km2(ring):
    """Área aproximada en km² (proyección equirrectangular local; basta para un umbral)."""
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = 111.320 * math.cos(math.radians(lat0)), 110.574
    s = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        s += x0 * kx * y1 * ky - x1 * kx * y0 * ky
    return abs(s) / 2


def _assemble(ways):
    """Une vías abiertas que comparten nodos extremos en anillos cerrados (los miembros de una relación)."""
    rings, open_ = [], [list(w) for w in ways if len(w) >= 2]
    while open_:
        cur = open_.pop()
        while cur[0] != cur[-1]:
            for k, w in enumerate(open_):
                if w[0] == cur[-1]:
                    cur += w[1:]
                elif w[-1] == cur[-1]:
                    cur += w[::-1][1:]
                elif w[-1] == cur[0]:
                    cur = w + cur[1:]
                elif w[0] == cur[0]:
                    cur = w[::-1] + cur[1:]
                else:
                    continue
                open_.pop(k)
                break
            else:
                break  # anillo sin cerrar (relación cortada por la ventana): se descarta
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur[:-1])
    return rings


# El mismo río con nombre portugués: el Minho es el Miño y el Lima es la Limia.
ALIAS = {"minho": "miño", "lima": "limia"}


def _aliased(name):
    return _plain(name) in ALIAS


def _plain(name):
    return re.sub(r"^(r[ií]o|rio|ribeira|r[ií]a)\s+(de\s+|do\s+|da\s+)?", "", name.split("/")[0].strip(), flags=re.I).casefold()


def _key(name):
    """«Río Sil», «Rio Sil» y «Sil» son el mismo río; de «A / B» vale A."""
    k = _plain(name)
    return ALIAS.get(k, k)


class OsmRios(Source):
    info = SourceInfo(
        id="osm_rios",
        title="Ríos y embalses de OpenStreetMap",
        publisher="OpenStreetMap contributors",
        homepage="https://www.openstreetmap.org/copyright",
        license="ODbL 1.0 (atribución «© colaboradores de OpenStreetMap»)",
        description="Vías `waterway=river` con nombre y masas de agua `natural=water` con `water=reservoir|lake`, "
        "pedidas a la API Overpass para Galicia y un margen (lat 41,7 a 43,9; lon -9,5 a -6,6). Se unen las vías por nombre; "
        f"se conservan los ríos de al menos {MIN_RIVER_KM:g} km y las masas de agua de al menos {MIN_LAKE_KM2:g} km². "
        "Natural Earth no trae el Miño, el Sil, el Ulla ni el Tambre.",
        used_for=["Ríos del mapa (nombre y rango por longitud)", "Embalses y lagos (celdas de agua)"],
    )

    def _path(self, name):
        return f"{name}.json"

    def fetch(self, force=False):
        for name, query in QUERIES.items():
            url = f"{OVERPASS}?data={urllib.parse.quote(query)}"
            p = self.download(url, self._path(name), force=force, headers=HEADERS)
            # Overpass contesta 200 con un `remark` si se pasa del tiempo o de memoria: no se cachea un resultado cortado.
            if json.loads(p.read_text(encoding="utf-8")).get("remark"):
                self.discard(self._path(name))
                raise RuntimeError(f"Overpass devolvió un aviso en {name}; vuelve a intentarlo más tarde")

    def _elements(self, name):
        return json.loads((self.raw_dir / self._path(name)).read_text(encoding="utf-8"))["elements"]

    def process(self):
        by_name: dict[str, dict] = {}
        for el in self._elements("rios"):
            if el["type"] != "way" or "geometry" not in el:
                continue
            name = el["tags"]["name"]
            d = by_name.setdefault(_key(name), {"name": name, "lines": [], "n": {}})
            d["lines"].append(_pts(el["geometry"]))
            # el nombre del río manda sobre su alias portugués (Miño sobre Minho, Limia sobre Lima)
            d["n"][name] = d["n"].get(name, 0) + (1 if _aliased(name) else 1000)
        rivers = []
        for d in by_name.values():
            km = sum(_km(l) for l in d["lines"])
            if km < MIN_RIVER_KM:
                continue
            rank = next(r for lim, r in RANK_BY_KM if km >= lim)
            rivers.append({"name": max(d["n"], key=d["n"].get), "rank": rank, "km": round(km, 1), "lines": d["lines"]})
        rivers.sort(key=lambda r: -r["km"])

        lakes = []
        for el in self._elements("embalses"):
            tags = el.get("tags", {})
            if el["type"] == "way" and "geometry" in el:
                outer, inner = [_pts(el["geometry"])], []
                outer = [o[:-1] if o[0] == o[-1] else o for o in outer]
            elif el["type"] == "relation":
                ow = [_pts(m["geometry"]) for m in el.get("members", []) if m.get("type") == "way" and m.get("role") == "outer" and "geometry" in m]
                iw = [_pts(m["geometry"]) for m in el.get("members", []) if m.get("type") == "way" and m.get("role") == "inner" and "geometry" in m]
                outer, inner = _assemble(ow), _assemble(iw)
            else:
                continue
            outer = [r for r in outer if len(r) >= 3]
            km2 = sum(_ring_km2(r) for r in outer) - sum(_ring_km2(r) for r in inner)
            if km2 >= MIN_LAKE_KM2:
                rings = [r + [r[0]] for r in outer + inner]
                lakes.append({"name": tags.get("name"), "km2": round(km2, 2), "water": tags.get("water"), "rings": rings})
        lakes.sort(key=lambda l: -l["km2"])
        return {
            "vintage": "OpenStreetMap vía Overpass",
            "_files": [self._path(n) for n in QUERIES],
            "rivers": rivers,
            "lakes": lakes,
        }
