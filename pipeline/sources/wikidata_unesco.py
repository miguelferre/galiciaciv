"""Elementos de Wikidata con identificador del Patrimonio Mundial (P757) situados en Galicia.

La lista de candidatos sale de una consulta SPARQL (P757 en la jerarquía de Galicia o con punto en la caja).
Los detalles salen de la API de Wikidata (wbgetentities, 50 QID por petición): el servicio SPARQL limita las
peticiones y daba 502, 504 y 429 con las consultas de detalle.

Regla de «situado en Galicia»:
  1. el elemento llega a Galicia (Q3908) subiendo por P131, o bien
  2. no tiene ninguna P131 y su punto (P625) cae en la caja lon -9,4 a -6,7 y lat 41,8 a 43,8.
La caja sola trae elementos de León, y P131 solo trae rutas cuyo punto está lejos de Galicia: por eso, además,
se deja fuera (y se imprime) todo elemento sin punto o con el punto fuera de la caja.

El concello es el único antepasado por P131 cuyo código INE (P772) tiene 5 dígitos y empieza por 15, 27, 32 o
36. Si hay cero o varios, queda en null. De cada propiedad se usan las declaraciones de mejor rango (como wdt:).
Un elemento con dos identificadores UNESCO da dos filas (una por par qid + unesco_id). `sitelinks` es el número
de artículos de Wikipedia.
"""

import json
import re
import time
import urllib.error
import urllib.parse

from ..core.fetch import UnexpectedContentError, read_manifest
from ..core.source import Source, SourceInfo

SPARQL = "https://query.wikidata.org/sparql"
API = "https://www.wikidata.org/w/api.php"
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)", "Accept": "application/json"}
WEST, SOUTH, EAST, NORTH = -9.4, 41.8, -6.7, 43.8
GALICIA = "Q3908"
MERGED = {"15026", "15063", "36011", "36012"}  # concellos desaparecidos por fusión
LANGS = ("es", "gl", "en")
BATCH = 50
DEPTH = 8  # niveles de P131 como máximo
# claves de sitelink acabadas en «wiki» que no son una Wikipedia
NOT_WIKIPEDIA = {"commonswiki", "specieswiki", "metawiki", "wikidatawiki", "mediawikiwiki", "sourceswiki",
                 "wikimaniawiki", "outreachwiki", "incubatorwiki", "wikifunctionswiki"}
CANDIDATES = "candidatos.json"
CANDIDATES_QUERY = f"""SELECT DISTINCT ?item WHERE {{
  {{ ?item wdt:P757 ?x ; wdt:P131* wd:{GALICIA} . }}
  UNION
  {{ SERVICE wikibase:box {{ ?item wdt:P625 ?c .
       bd:serviceParam wikibase:cornerWest "Point({WEST} {SOUTH})"^^geo:wktLiteral .
       bd:serviceParam wikibase:cornerEast "Point({EAST} {NORTH})"^^geo:wktLiteral . }}
     ?item wdt:P757 ?x . }}
}}"""


def _candidates(path) -> list[str]:
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))["results"]["bindings"]
        qids = sorted({r["item"]["value"].rsplit("/", 1)[-1] for r in rows})
    except (ValueError, KeyError, TypeError) as exc:
        raise UnexpectedContentError(f"{path.name}: respuesta SPARQL incompleta o no válida ({exc})") from exc
    if not qids:
        raise UnexpectedContentError(f"{path.name}: respuesta SPARQL sin filas")
    return qids


def _entities(path) -> dict:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        return doc["entities"]
    except (ValueError, KeyError, TypeError) as exc:
        raise UnexpectedContentError(f"{path.name}: respuesta de la API no válida ({exc})") from exc


def _values(entity, prop) -> list:
    """Valores de las declaraciones de mejor rango (preferred; si no hay, normal)."""
    claims = [c for c in entity.get("claims", {}).get(prop, []) if c.get("rank") != "deprecated"]
    best = [c for c in claims if c.get("rank") == "preferred"] or claims
    return [c["mainsnak"]["datavalue"]["value"] for c in best if c["mainsnak"].get("datavalue")]


def _parents(entity) -> list[str]:
    return [v["id"] for v in _values(entity, "P131")]


def _label(entity, lang):
    return entity.get("labels", {}).get(lang, {}).get("value")


def _walk(qids, get):
    """Pide los candidatos, sus antepasados por P131 (nivel a nivel) y sus tipos. `get(qids, props, fichero)`."""

    def level(ids, props, tag):
        found = {}
        for k in range(0, len(ids), BATCH):
            found.update(get(ids[k : k + BATCH], props, f"{tag}_{k // BATCH:02d}.json"))
        return found

    elements = level(qids, "labels|claims|sitelinks", "elementos")
    known = dict(elements)
    frontier = elements
    for depth in range(1, DEPTH + 1):
        todo = sorted({p for q, e in frontier.items() if q != GALICIA for p in _parents(e)} - set(known))
        if not todo:
            break
        frontier = level(todo, "claims", f"p131_{depth}")
        known.update(frontier)
    types = sorted({v["id"] for e in elements.values() for v in _values(e, "P31")})
    return elements, known, level(types, "labels", "tipos")


class WikidataUnesco(Source):
    info = SourceInfo(
        id="wikidata_unesco",
        title="Elementos del Patrimonio Mundial UNESCO en Galicia (Wikidata)",
        publisher="Wikidata (Fundación Wikimedia)",
        homepage="https://www.wikidata.org/wiki/Property:P757",
        license="CC0 (datos estructurados de Wikidata, según Wikidata:Licensing)",
        description="Elementos de Wikidata con identificador del Patrimonio Mundial (P757) en la jerarquía "
        "administrativa de Galicia, con su punto, concello, tipo y número de artículos de Wikipedia. No es la "
        "lista oficial de la UNESCO: puede faltar o sobrar algún elemento.",
        used_for=["Maravillas (Patrimonio Mundial)"],
    )

    def _get(self, url, rel, force, check):
        """download() que espera y repite ante un 429; no deja en caché una respuesta no válida."""
        for attempt in range(4):
            try:
                path = self.download(url, rel, force=force, headers=HEADERS)
                break
            except urllib.error.HTTPError as exc:
                if exc.code != 429 or attempt == 3:
                    raise
                after = (exc.headers.get("Retry-After") or "").strip()
                wait = min(int(after) if after.isdigit() else 65, 300) + 1
                print(f"      429 de Wikidata; espera de {wait} s")
                time.sleep(wait)
        try:
            return check(path)
        except UnexpectedContentError:
            self.discard(rel)
            raise

    def fetch(self, force=False):
        url = f"{SPARQL}?{urllib.parse.urlencode({'query': CANDIDATES_QUERY, 'format': 'json'})}"
        qids = self._get(url, CANDIDATES, force, _candidates)

        def get(ids, props, rel):
            params = {"action": "wbgetentities", "ids": "|".join(ids), "props": props,
                      "languages": "|".join(LANGS), "format": "json"}
            return self._get(f"{API}?{urllib.parse.urlencode(params)}", rel, force, _entities)

        _walk(qids, get)

    def process(self):
        files = [CANDIDATES]

        def get(ids, _props, rel):
            files.append(rel)
            found = _entities(self.raw_dir / rel)
            missing = set(ids) - set(found)
            if missing:  # redirecciones o caché de otra lista de candidatos
                raise RuntimeError(f"wikidata_unesco: {rel} no contiene {sorted(missing)}; usa fetch --force")
            return found

        elements, known, types = _walk(_candidates(self.raw_dir / CANDIDATES), get)

        items, outside_hierarchy = [], 0
        for qid, e in elements.items():
            ids = sorted(set(_values(e, "P757")))
            name_es, name_gl = _label(e, "es"), _label(e, "gl")
            label = name_es or name_gl or qid
            ancestors, todo = set(), [qid]
            while todo:
                q = todo.pop()
                if q in ancestors or q not in known:
                    continue
                ancestors.add(q)
                if q != GALICIA:
                    todo += _parents(known[q])
            has_p131 = bool(_parents(e))
            if GALICIA not in ancestors and has_p131:
                outside_hierarchy += 1  # de la caja, pero administrativamente fuera de Galicia
                print(f"      fuera (P131 no es Galicia): {qid} {', '.join(ids)} {label}")
                continue
            points = sorted({(round(v["longitude"], 6), round(v["latitude"], 6)) for v in _values(e, "P625")})
            inside = [p for p in points if WEST <= p[0] <= EAST and SOUTH <= p[1] <= NORTH]
            if not inside:
                print(f"      fuera (sin punto en la caja de Galicia): {qid} {', '.join(ids)} {label} {points}")
                continue
            if len(points) > 1:
                print(f"      aviso: {qid} tiene {len(points)} puntos; se usa {inside[0]}")
            if not has_p131:
                print(f"      aviso: {qid} {', '.join(ids)} {label} no tiene P131; entra por la caja, sin concello")
            found = sorted({
                (code, q) for q in ancestors for code in _values(known[q], "P772")
                if re.fullmatch(r"(15|27|32|36)\d{3}", code) and code not in MERGED
            })
            if len(found) != 1:
                print(f"      aviso: {qid} {', '.join(ids)} {label}: concellos en P131 = {found}; concello null")
            ine, concello_qid = found[0] if len(found) == 1 else (None, None)
            kinds = [v["id"] for v in _values(e, "P31")]
            instance_of = sorted(
                next((x for x in (_label(types.get(k, {}), lang) for lang in LANGS) if x), k) for k in kinds
            )
            sitelinks = sum(1 for s in e.get("sitelinks", {}) if s.endswith("wiki") and s not in NOT_WIKIPEDIA)
            for unesco_id in ids:
                items.append({
                    "qid": qid,
                    "name_es": name_es,
                    "name_gl": name_gl,
                    "unesco_id": unesco_id,
                    "instance_of": instance_of,
                    "concello_qid": concello_qid,
                    "concello_ine": ine,
                    "lon": inside[0][0],
                    "lat": inside[0][1],
                    "sitelinks": sitelinks,
                })
        items.sort(key=lambda i: (i["unesco_id"], i["qid"]))
        print(
            f"    {len(items)} filas, {len({i['qid'] for i in items})} elementos; "
            f"{outside_hierarchy} de la caja fuera de Galicia"
        )
        when = read_manifest(self.id).get(CANDIDATES, {}).get("retrieved", "")[:10]
        return {"vintage": f"Wikidata, consultado {when}", "items": items, "_files": files}
