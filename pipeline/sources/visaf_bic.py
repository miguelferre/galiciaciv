"""Bienes de Interés Cultural (BIC) de Galicia: capa 2 («BIC. Elementos», puntos) del servicio VISAF.

`attrs` guarda todos los atributos tal como llegan. `name`, `concello` y `category` se limpian: parte de los
textos del servicio llegan con la codificación rota (bytes CP850 leídos como CP1252: «Xen‚rica» por
«Xenérica») y con saltos de línea finales. `id` es ID_BIC, que no es único (un bien en serie tiene varios
puntos); la clave única de fila es attrs.OBJECTID. El servicio no tiene campo de grado de protección.

`area_integral_ha` es la superficie del polígono de la capa 4 («BIC. Área integral») cruzado con el punto, en
EPSG:25829 (nativo). No hay clave común fiable, así que el cruce es heurístico y `area_match` dice la regla:
  «nombre»  el polígono contiene el punto, el nombre se parece y no es un conjunto o territorio;
  «ri»      si no, contiene el punto y casa el número de registro (R.I.);
  «cerca»   si no, está a menos de 300 m (a un vértice), no es un conjunto y se parece el nombre o casa el R.I.
Sin ninguna de las tres, ambos campos quedan en null. Dos filas pueden compartir polígono. La regla se revisó
solo en los bienes de categoría «Monumento».
"""

import difflib
import json
import re
import unicodedata
import urllib.parse

from ..core.fetch import UnexpectedContentError, read_manifest
from ..core.source import Source, SourceInfo

SERVICE = "https://ideg.xunta.gal/servizos/rest/services/VISAF/PatrimonioCultural/MapServer"
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
PAGE = 1000  # maxRecordCount del servicio
# carácter roto -> carácter original (CP850 mostrado como CP1252); solo los vistos o equivalentes
MOJIBAKE = str.maketrans({"‚": "é", "¢": "ó", "¡": "í", "£": "ú", "¤": "ñ", "\xa0": "á"})
COUNT, COUNT_AREA = "count.json", "count_area.json"
# descargas paginadas: prefijo -> (capa, fichero de recuento, tamaño de página, parámetros)
QUERIES = {
    "bic": (2, COUNT, PAGE, {"outFields": "*", "outSR": 4326, "orderByFields": "OBJECTID"}),
    "utm": (2, COUNT, PAGE, {"outFields": "OBJECTID", "outSR": 25829, "orderByFields": "OBJECTID"}),
    "area": (4, COUNT_AREA, 200, {"outFields": "OBJECTID_1,IDE_DENOM,IDE_CAT,IDE_MINIS,IDE_MINIS2",
                                  "outSR": 25829, "orderByFields": "OBJECTID_1"}),
}
NEAR_M = 300
RI = re.compile(r"(\d{2})\s*-\s*(\d{7})\s*-\s*(\d{5})")  # número del Registro de Interés Cultural
# palabras que no distinguen un nombre, y palabras de tipo de bien (ya sin tildes, con v -> b)
STOP = {"de", "do", "da", "das", "dos", "del", "san", "santa", "santo", "nosa", "senora", "los", "las", "con", "que"}
GENERIC = {w.replace("v", "b").rstrip("s") for w in (
    "igrexa iglesia mosteiro mosterio monasterio convento pazo castelo castillo castro torre torres capela capilla "
    "ponte puente catedral colexiata museo ruinas casa santuario conxunto conjunto murallas muralla petroglifo "
    "grabado gravado rupestre hospital fortaleza"
).split()}


def _url(layer, params):
    return f"{SERVICE}/{layer}/query?{urllib.parse.urlencode(params)}"


def _page(prefix, k):
    return f"{prefix}_{k:03d}.json"


def _load(path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise UnexpectedContentError(f"{path.name}: no es JSON ({exc})") from exc
    if not isinstance(data, dict) or "error" in data or not ("features" in data or "count" in data):
        raise UnexpectedContentError(f"{path.name}: respuesta de error {str(data)[:200]}")
    return data


def _text(value):
    """Texto limpio: repara la codificación, quita espacios repetidos o finales."""
    if value is None:
        return None
    return re.sub(r"\s+", " ", value.translate(MOJIBAKE)).strip() or None


def _category(value):
    """Como _text y además unifica «XenÉrica» y «Xen‚érica» (acento duplicado) en «Xenérica»."""
    t = _text(value)
    return t and re.sub("é+", "é", t[0] + t[1:].lower())


def _tokens(text):
    plain = unicodedata.normalize("NFD", text or "").encode("ascii", "ignore").decode().lower().replace("v", "b")
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", plain) if len(w) > 2 and w not in STOP}


def _similar(name, concello, other):
    """(¿se parecen?, puntuación) entre las palabras del bien y las del polígono. Una palabra que solo es el
    nombre del concello cuenta únicamente si además coincide el tipo de bien."""
    match = {w for w in name if difflib.get_close_matches(w, other, 1, 0.84)}
    generic = match & GENERIC
    place = (match - GENERIC) & concello
    own = match - GENERIC - concello
    return bool(own) or bool(place and generic), (len(own), len(generic), len(match))


def _register(*values):
    return {"-".join(m) for v in values for m in RI.findall(str(v or ""))}


def _area_m2(rings):
    """Área de un polígono ArcGIS (los huecos llevan la orientación contraria y restan)."""
    return abs(sum(x0 * y1 - x1 * y0 for r in rings for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]))) / 2


def _contains(x, y, rings):
    inside = False
    for r in rings:
        for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]):
            if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
                inside = not inside
    return inside


def _polygon(feature):
    a, rings = feature["attributes"], feature["geometry"]["rings"]
    xs, ys = [p[0] for r in rings for p in r], [p[1] for r in rings for p in r]
    denom, category = _text(a["IDE_DENOM"]) or "", _text(a["IDE_CAT"]) or ""
    return {
        "rings": rings,
        "box": (min(xs), min(ys), max(xs), max(ys)),
        "area": _area_m2(rings),
        "tokens": _tokens(denom),
        "register": _register(a["IDE_MINIS"], a["IDE_MINIS2"]),
        "group": bool(re.search(r"(?i)conxunto|conjunto|territorio", f"{category} {denom}")),
    }


def _match(x, y, name, concello, register, polygons):
    """(polígono, regla) del área integral de un punto, o (None, None). Ver la cabecera del módulo."""
    near = [p for p in polygons
            if p["box"][0] - NEAR_M <= x <= p["box"][2] + NEAR_M and p["box"][1] - NEAR_M <= y <= p["box"][3] + NEAR_M]
    containing = [p for p in near if _contains(x, y, p["rings"])]
    named = [p for p in containing if not p["group"] and _similar(name, concello, p["tokens"])[0]]
    if named:
        best = max(named, key=lambda p: (_similar(name, concello, p["tokens"])[1], bool(register & p["register"]), -p["area"]))
        return best, "nombre"
    registered = [p for p in containing if register & p["register"]]
    if registered:
        return min(registered, key=lambda p: p["area"]), "ri"
    close = []
    for p in near:
        if not p["group"] and (register & p["register"] or _similar(name, concello, p["tokens"])[0]):
            d = min(((vx - x) ** 2 + (vy - y) ** 2) ** 0.5 for r in p["rings"] for vx, vy in r)
            if d < NEAR_M:
                close.append((d, p))
    if close:
        return min(close, key=lambda c: c[0])[1], "cerca"
    return None, None


class VisafBic(Source):
    info = SourceInfo(
        id="visaf_bic",
        title="Bienes de Interés Cultural de Galicia (VISAF, Patrimonio Cultural)",
        publisher="Xunta de Galicia",
        homepage="https://ideg.xunta.gal/servizos/rest/services/VISAF/PatrimonioCultural/MapServer",
        license="Licencia por defecto del geoportal de la Xunta, compatible con CC BY 4.0, con cita de la fuente "
        "(mapas.xunta.gal/gl/aviso-legal). El servicio no declara ficha propia: verificación parcial.",
        description="Puntos de los Bienes de Interés Cultural declarados (capa 2, «BIC. Elementos»), con categoría, "
        "concello, fecha de la disposición y demás atributos. Un bien en serie puede tener varios puntos. La superficie "
        "del área integral (capa 4) se cruza con cada punto por una regla heurística y mide extensión, no protección.",
        used_for=["Maravillas (BIC)", "Cultura (nº de BIC por concello)"],
    )

    def _get(self, url, rel, force):
        path = self.download(url, rel, force=force, headers=HEADERS)
        try:
            return _load(path)
        except UnexpectedContentError:
            self.discard(rel)
            raise

    def fetch(self, force=False):
        for prefix, (layer, count_file, size, params) in QUERIES.items():
            q = {"where": "1=1", "returnCountOnly": "true", "f": "json"}
            total = self._get(_url(layer, q), count_file, force)["count"]
            offset, k = 0, 0
            while offset < total:
                q = {"where": "1=1", **params, "returnGeometry": "true", "f": "json",
                     "resultOffset": offset, "resultRecordCount": size}
                n = len(self._get(_url(layer, q), _page(prefix, k), force)["features"])
                if not n:
                    self.discard(_page(prefix, k))
                    raise RuntimeError(f"visaf_bic: página vacía en {prefix}, resultOffset={offset} de {total}")
                offset, k = offset + n, k + 1

    def _read(self, prefix):
        """Todas las filas de una descarga paginada, comprobadas contra su recuento, y los ficheros leídos."""
        _layer, count_file, _size, params = QUERIES[prefix]
        key = params["orderByFields"]
        total = _load(self.raw_dir / count_file)["count"]
        features, files = [], [count_file]
        while len(features) < total:
            rel = _page(prefix, len(files) - 1)
            page = _load(self.raw_dir / rel)["features"]
            if not page:
                raise RuntimeError(f"visaf_bic: {rel} vacía")
            features += page
            files.append(rel)
        ids = {f["attributes"][key] for f in features}
        if len(features) != total or len(ids) != total:
            raise RuntimeError(f"visaf_bic: {prefix}: {len(features)} filas ({len(ids)} {key} distintos), esperadas {total}")
        return features, files

    def process(self):
        features, files = self._read("bic")
        native, native_files = self._read("utm")
        areas, area_files = self._read("area")
        files = sorted(set(files + native_files + area_files))
        total = len(features)
        points = {f["attributes"]["OBJECTID"]: f.get("geometry") or {} for f in native}
        polygons = [_polygon(f) for f in areas if (f.get("geometry") or {}).get("rings")]
        if len(polygons) != len(areas):
            print(f"      aviso: {len(areas) - len(polygons)} áreas sin geometría")

        items = []
        for f in features:
            a, g = f["attributes"], f.get("geometry") or {}
            name = _text(a["NOME"])
            lon, lat = g.get("x"), g.get("y")
            if not (isinstance(lon, (int, float)) and isinstance(lat, (int, float)) and -9.5 < lon < -6.6 and 41.7 < lat < 43.9):
                print(f"      fuera (sin punto válido): OBJECTID {a['OBJECTID']} {name} {g}")
                continue
            ine = str(a["COD_INE"] or "")
            if not re.fullmatch(r"(15|27|32|36)\d{3}", ine):
                print(f"      aviso: COD_INE no válido {a['COD_INE']!r} en {name}")
                ine = None
            concello = _text(a["CONCELLO"])
            if concello and "/" in concello:
                print(f"      aviso: varios concellos «{concello}» ({name}); concello_ine = {ine}")
            xy = points.get(a["OBJECTID"], {})
            polygon, rule = None, None
            if isinstance(xy.get("x"), (int, float)):
                polygon, rule = _match(xy["x"], xy["y"], _tokens(name), _tokens(concello), _register(a["ID_RAGE"]), polygons)
            items.append({
                "id": _text(a["ID_BIC"]),
                "name": name,
                "concello": concello,
                "concello_ine": ine,
                "category": _category(a["CATEGORIA"]),
                "nature": _text(a["NATUREZA"]),
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "area_integral_ha": round(polygon["area"] / 1e4, 4) if polygon else None,
                "area_match": rule,
                "attrs": a,
            })
        print(f"    {len(items)} de {total} puntos BIC, {len({i['id'] for i in items})} ID_BIC distintos")
        matched = [i["area_match"] for i in items if i["area_match"]]
        print(f"    área integral: {len(matched)} puntos con polígono, {len(areas)} áreas "
              f"({', '.join(f'{r} {matched.count(r)}' for r in ('nombre', 'ri', 'cerca'))})")
        when = read_manifest(self.id).get(COUNT, {}).get("retrieved", "")[:10]
        return {"vintage": f"VISAF Patrimonio Cultural (Xunta de Galicia), consultado {when}", "items": items, "_files": files}
