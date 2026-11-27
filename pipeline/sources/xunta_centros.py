"""Directorio de centros educativos de Galicia (Abert@s, conjunto 0257), de todos los niveles.

Cuatro CSV, uno por provincia (ficheros 001 A Coruña, 003 Lugo, 005 Ourense, 007 Pontevedra; los pares son el mismo
dato en XML). Se guardan todos los centros (1 624 el 2026-11-27): quien necesite los de FP los filtra por código con la
oferta (`xunta_oferta_fp`). Trampas del fichero:

* `COORDENADA_X` y `COORDENADA_Y` no son fiables en el orden: en la mayoría X es la **latitud** (43,22 / -8,28), pero
  unas 330 filas (centros de los registros más nuevos) las traen al derecho (X = longitud). Aquí se decide por el rango:
  la que cae en 41 a 45 es `lat` y la que cae en -10 a -6 es `lon`. Una fila con 0, vacío o fuera de Galicia queda sin
  coordenadas (`lat` y `lon` nulos): el builder le busca el concello por el nombre.
* El concello va con el nombre del registro («A Coruña»); el código INE lo pone el builder con los contornos del IGN.
* La descarga redirige al buscador de centros de la Consellería; el servidor devuelve el CSV en UTF-8.

Licencia CC BY-SA 4.0 (ficha del conjunto, leída el 2026-11-27). El aviso de Abert@s pide citar «Fonte dos datos: Xunta
de Galicia» y la fecha de la última actualización (la ficha dice actualización diaria): aquí es la fecha de descarga.
"""

from __future__ import annotations

import csv
import io

from ..core.fetch import read_manifest
from ..core.source import Source, SourceInfo

BASE = "https://abertos.xunta.gal/catalogo/ensino-formacion/-/dataset/0257/centros-educativos-galicia"
FILES = {"001": "A Coruña", "003": "Lugo", "005": "Ourense", "007": "Pontevedra"}
GRANT = {"Pública": "publica", "Privada": "privada"}
COLUMNS = ["Código", "Nome", "Enderezo", "Concello", "Provincia", "Cód. postal", "Tipo de centro", "COORDENADA_X",
           "COORDENADA_Y", "TITULARIDADE", "ENSINO_CONCERTADO"]


def _rel(n: str) -> str:
    return f"centros-{n}.csv"


def _num(v: str):
    try:
        f = float(v.replace(",", "."))
    except ValueError:
        return None
    return f if f else None


class XuntaCentros(Source):
    info = SourceInfo(
        id="xunta_centros",
        title="Centros educativos de Galicia (Abert@s, conjunto 0257)",
        publisher="Xunta de Galicia, Consellería de Educación, Ciencia, Universidades e Formación Profesional",
        homepage="https://abertos.xunta.gal/catalogo/ensino-formacion/-/dataset/0257/centros-educativos-galicia",
        license="CC BY-SA 4.0 (ficha de Abert@s leída el 2026-11-27; atribución «Fonte dos datos: Xunta de Galicia» con la fecha de actualización)",
        description="Directorio de todos los centros educativos de Galicia (código, nombre, dirección, concello, tipo de centro, "
        "titularidad pública o privada, enseñanza concertada y coordenadas), cuatro CSV provinciales. Las coordenadas vienen "
        "en orden desigual (X es casi siempre la latitud, a veces la longitud). Los derivados se publican con la misma licencia (compartir igual).",
        used_for=["Formación profesional: centros con oferta, ubicación y tipo"],
    )

    def fetch(self, force=False):
        for n in FILES:
            p = self.download(f"{BASE}/{n}/descarga-directa-ficheiro.csv", _rel(n), force=force, expect_binary=True)
            if "Tipo de centro" not in p.read_text(encoding="utf-8-sig").partition("\n")[0]:
                self.discard(_rel(n))
                raise RuntimeError(f"xunta_centros: {n} is not the expected CSV (header changed?)")

    def process(self):
        centres, files, retrieved = [], [], []
        man = read_manifest(self.id)
        for n, prov in FILES.items():
            path = self.raw_dir / _rel(n)
            if not path.exists():
                raise FileNotFoundError(f"{path} missing; run fetch first")
            files.append(path.name)
            retrieved.append(man.get(path.name, {}).get("retrieved", "")[:10])
            for r in csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))):
                missing = [c for c in COLUMNS if c not in r]
                if missing:
                    raise RuntimeError(f"xunta_centros: {path.name} lacks columns {missing}")
                a, b = _num(r["COORDENADA_X"]), _num(r["COORDENADA_Y"])
                lat = lon = None
                for v in (a, b):  # the file mixes both orders: tell them apart by range (see the module docstring)
                    if v is not None and 41 < v < 45:
                        lat = v
                    elif v is not None and -10 < v < -6:
                        lon = v
                if lat is None or lon is None:
                    lat = lon = None  # empty, zero or outside Galicia: a typing error in the register, not a place
                if r["TITULARIDADE"] not in GRANT:
                    raise RuntimeError(f"xunta_centros: unknown titularidad {r['TITULARIDADE']!r} in {r['Código']}")
                centres.append({
                    "code": r["Código"].strip(), "name": r["Nome"].strip(), "address": r["Enderezo"].strip(),
                    "concello": r["Concello"].strip(), "province": r["Provincia"].strip() or prov,
                    "postal": r["Cód. postal"].strip(), "type": r["Tipo de centro"].strip(),
                    "ownership": GRANT[r["TITULARIDADE"]], "concertado": r["ENSINO_CONCERTADO"].strip() == "Si",
                    "lat": lat, "lon": lon,
                })
        codes = [c["code"] for c in centres]
        if len(set(codes)) != len(codes):
            raise RuntimeError("xunta_centros: repeated centre codes")
        day = max(retrieved)
        return {"vintage": f"Xunta de Galicia, Abert@s 0257, centros educativos (descarga del {day}; la ficha da actualización diaria)",
                "retrieved": day, "centres": centres, "_files": files}
