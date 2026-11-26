"""Aerogeneradores de la capa de energía eólica de la IDEG (Xunta de Galicia).

Servicio ArcGIS `RecursosEnerxeticos/enerxia_eolica_v2`, capa 4 «PE en funcionamento, autorizados, en obras».
Cada punto es una infraestructura (`INFRAEST`): aerogenerador, torre de medición o CT/subestación; aquí solo
quedan los aerogeneradores. La capa NO trae potencia, estado, titular ni concello (comprobado el 2026-11-26
en sus campos: INFRAEST, NOME, ETRS89_X, ETRS89_Y, DIAM, ALT) y ninguna capa de puntos del servicio trae
potencia, estado o titular, así que esos campos van a null y no hay lista de parques con MW. El concello solo
saldría por cruce espacial (capa 6, polígonos de concellos) y eso no es tarea de la fuente. No se puede separar
lo instalado de lo autorizado o en obras. La capa 1 («PE en tramitación») no se usa.
"""

import json
import urllib.parse
from datetime import date

from ..core.source import Source, SourceInfo

SERVICE = "https://ideg.xunta.gal/servizos/rest/services/RecursosEnerxeticos/enerxia_eolica_v2/MapServer"
LAYER = 4
PAGE = 2000
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
TURBINE = "AEROXERADOR"


def _query(**params):
    return f"{SERVICE}/{LAYER}/query?{urllib.parse.urlencode({'where': '1=1', 'f': 'json', **params})}"


class XuntaEolica(Source):
    info = SourceInfo(
        id="xunta_eolica",
        title="Aerogeneradores de parques eólicos (IDEG)",
        publisher="Xunta de Galicia, Infraestrutura de Datos Espaciais de Galicia (IDEG)",
        homepage=f"{SERVICE}/{LAYER}",
        license="El servicio no declara licencia propia. El aviso legal de Información Xeográfica de Galicia "
        "(mapas.xunta.gal/es/aviso-legal) declara para la información geográfica de la Xunta una licencia compatible "
        "con CC BY 4.0, con cita de la fuente",
        description="Puntos de aerogenerador (INFRAEST = AEROXERADOR) de la capa «PE en funcionamento, autorizados, "
        "en obras», con el nombre del parque, el diámetro de rotor y la altura. La capa mezcla parques en "
        "funcionamiento, autorizados y en obras sin ningún campo que los separe: no es un recuento de potencia ni de "
        "máquinas instaladas. No trae potencia, titular ni concello. Los parques en tramitación quedan fuera.",
        used_for=["Aerogeneradores por celda (en funcionamiento, autorizados o en obras)"],
    )

    def _json(self, rel):
        doc = json.loads((self.raw_dir / rel).read_text(encoding="utf-8"))
        if "error" in doc:
            raise RuntimeError(f"xunta_eolica: error del servicio en {rel}: {doc['error']}")
        return doc

    def _get(self, url, rel, force):
        """Descarga un JSON y no deja en caché una respuesta de error de ArcGIS."""
        self.download(url, rel, force=force, headers=HEADERS)
        try:
            return self._json(rel)
        except (ValueError, RuntimeError):
            self.discard(rel)
            raise

    def fetch(self, force=False):
        self._get(f"{SERVICE}/{LAYER}?f=json", "capa4.json", force)
        total = self._get(_query(returnCountOnly="true"), "capa4_count.json", force)["count"]
        got, k = 0, 0
        while got < total:
            url = _query(outFields="*", outSR=4326, orderByFields="OBJECTID", resultOffset=got, resultRecordCount=PAGE)
            n = len(self._get(url, f"capa4_{k:02d}.json", force)["features"])
            if not n:
                self.discard(f"capa4_{k:02d}.json")
                raise RuntimeError(f"xunta_eolica: página vacía con {got} de {total} registros")
            got += n
            k += 1

    def process(self):
        layer = self._json("capa4.json")["name"]
        total = self._json("capa4_count.json")["count"]
        files = ["capa4.json", "capa4_count.json"]
        features, k = [], 0
        while len(features) < total:
            rel = f"capa4_{k:02d}.json"
            page = self._json(rel)["features"]
            if not page:
                raise RuntimeError(f"xunta_eolica: {rel} está vacía")
            features += page
            files.append(rel)
            k += 1
        ids = {f["attributes"]["OBJECTID"] for f in features}
        if len(features) != total or len(ids) != total:
            raise RuntimeError(f"xunta_eolica: {len(features)} registros ({len(ids)} únicos), el servicio anuncia {total}")

        turbines, other, dropped = [], {}, []
        for f in features:
            a, g = f["attributes"], f.get("geometry")
            kind = (a.get("INFRAEST") or "").strip()
            if kind != TURBINE:
                other[kind] = other.get(kind, 0) + 1
                continue
            park = (a.get("NOME") or "").strip() or None
            if not g or not (-9.5 <= g["x"] <= -6.6 and 41.7 <= g["y"] <= 43.9):
                dropped.append(a["OBJECTID"])
                continue
            turbines.append({
                "lon": round(g["x"], 6), "lat": round(g["y"], 6), "park": park,
                "mw": None, "status": None, "owner": None, "concello": None,
                "diam_m": a.get("DIAM") or None,  # 0 en origen = sin dato
                "height_m": a.get("ALT") or None,
            })
        positions = {(t["lon"], t["lat"]) for t in turbines}
        print(f"    {len(turbines)} aerogeneradores en {len({t['park'] for t in turbines})} parques; "
              f"excluidos {other}; sin geometría válida: {dropped}; posiciones repetidas: {len(turbines) - len(positions)}")
        return {
            "vintage": f"IDEG, capa «{layer}», consultada el {date.today().isoformat()}",
            "layer": layer,
            "turbines": turbines,
            "_files": files,
        }
