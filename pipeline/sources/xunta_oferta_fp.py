"""Oferta de Formación Profesional del sistema educativo 2026-27 por centro y ciclo (Consellería de Educación).

La oferta ordinaria («clasificada por provincia e concello») solo existe como PDF de 50 páginas, sin CSV ni API.
El PDF se convierte fuera del pipeline, que solo usa la biblioteca estándar:

    uv run --with pdfplumber python tools/prep_fp_oferta.py

`fetch` descarga el PDF (queda en el manifiesto) y exige el JSON que deja esa herramienta en
data/raw/xunta_oferta_fp/oferta.json (patrón de `mdt_ign`). `process` valida el JSON y lo ordena: una fila por centro,
ciclo y turno, con la familia y el grado sacados del código del ciclo (D1 básico, D2 medio, D3 superior, E2 y E3
cursos de especialización de grado medio y superior; los dos códigos antiguos M19001 y S19003 son Sanidad: la
numeración 19 de la LOGSE, y los dos ciclos son «Coidados auxiliares de enfermaría» y «Dietética»).

Las plazas son las del curso completo ordinario, en el primer curso de cada ciclo. No incluyen la matrícula modular, la
FP dual intensiva, la acelerada, la semipresencial ni los másteres, que van en otros PDF (el dossier de la Consellería
da 29 071 plazas de curso completo ordinario y 50 244 en total). Las filas que la herramienta no pudo leer van en
`unparsed`; `process` falla si hay alguna, para que un cambio de formato no pase sin verse.

Licencia: el aviso legal del portal de la Consellería (https://educacioneciencia.xunta.gal/aviso-legal, leído el
2026-11-27) permite la reutilización comercial y no comercial citando la fuente y sin desnaturalizar la información.
La página de la oferta no trae aviso propio. Aviso de la propia Consellería: el número de plazas puede variar.
"""

from __future__ import annotations

import json
import re

from ..core.fetch import read_manifest
from ..core.source import Source, SourceInfo

URL = "https://www.edu.xunta.gal/fp/webfm_send/11778"
PDF = "oferta-2026-27.pdf"
JSON = "oferta.json"
INDEX_UPDATED = "2026-06-26"  # «act. 26/06/2026» in https://www.edu.xunta.gal/fp/oferta-fp, read on 2026-11-27
LEVEL = {"D1": ("basico", "basico"), "D2": ("medio", "medio"), "D3": ("superior", "superior"),
         "E2": ("especializacion", "medio"), "E3": ("especializacion", "superior"),
         "M1": ("medio", "medio"), "S1": ("superior", "superior")}
LEGACY_FAMILY = {"19": "SAN"}
CODE = re.compile(r"^(?:[DE][123]([A-Z]{3})[0-9A-Z]{6}|[MS](\d{2})\d{3})$")
CIFP_OFFICIAL = 28  # red CIFP according to https://www.edu.xunta.gal/fp/cifp (2026-11-27)


class XuntaOfertaFp(Source):
    info = SourceInfo(
        id="xunta_oferta_fp",
        title="Oferta de FP 2026-27 por centro y ciclo (Consellería de Educación)",
        publisher="Xunta de Galicia, Consellería de Educación, Ciencia, Universidades e Formación Profesional",
        homepage="https://www.edu.xunta.gal/fp/oferta-fp",
        license="Aviso legal del portal de la Consellería: reutilización comercial y no comercial con cita de la fuente y sin "
        "desnaturalizar (leído el 2026-11-27); atribución «Fonte: Xunta de Galicia, Consellería de Educación»",
        description="Oferta ordinaria de FP del curso 2026-27 (ciclos básicos, medios y superiores y cursos de especialización) "
        "en centros sostenidos con fondos públicos: centro, ciclo, familia profesional, grado, turno y plazas del primer "
        "curso. Sale de un PDF convertido con tools/prep_fp_oferta.py. No incluye modular, dual intensiva, acelerada ni "
        "semipresencial.",
        used_for=["Formación profesional: oferta por centro, familia y comarca"],
    )

    def fetch(self, force=False):
        pdf = self.download(URL, PDF, force=force, expect_binary=True)
        if not pdf.read_bytes().startswith(b"%PDF"):
            self.discard(PDF)
            raise RuntimeError(f"xunta_oferta_fp: {URL} did not return a PDF")
        js = self.raw_dir / JSON
        if not js.exists():
            raise FileNotFoundError(f"{js} missing - run: uv run --with pdfplumber python tools/prep_fp_oferta.py")
        sha = read_manifest(self.id).get(PDF, {}).get("sha256")
        if sha and json.loads(js.read_text(encoding="utf-8")).get("pdf_sha256") != sha:
            raise RuntimeError(f"{js} was made from another PDF than the one downloaded; run tools/prep_fp_oferta.py again")

    def process(self):
        path = self.raw_dir / JSON
        if not path.exists():
            raise FileNotFoundError(f"{path} missing - run: uv run --with pdfplumber python tools/prep_fp_oferta.py")
        doc = json.loads(path.read_text(encoding="utf-8"))
        if doc["unparsed"]:
            raise RuntimeError(f"xunta_oferta_fp: {len(doc['unparsed'])} lines of the PDF were not parsed, e.g. {doc['unparsed'][0]}")
        centres = {c["code"]: c for c in doc["centres"]}
        rows, problems = [], []
        for r in doc["rows"]:
            m = CODE.match(r["code"])
            if not m or r["centre"] not in centres:
                problems.append(f"{r['centre']} {r['code']}")
                continue
            fam = m.group(1) or LEGACY_FAMILY.get(m.group(2))
            grade, level = LEVEL[r["code"][:2]]
            if fam is None or level != r["header_grade"]:
                problems.append(f"{r['centre']} {r['code']} (family {fam}, grade {level} vs header {r['header_grade']})")
                continue
            rows.append({"centre": r["centre"], "code": r["code"], "family": fam, "grade": grade, "level": level,
                         "cycle": r["name"], "shift": r["shift"], "places": r["places"]})
        if problems:
            raise RuntimeError(f"xunta_oferta_fp: {len(problems)} rows do not fit the code or grade rules: {problems[:5]}")
        empty = [c for c in centres if not any(r["centre"] == c for r in rows)]
        sha = doc.get("pdf_sha256")
        day = (read_manifest(self.id).get(PDF, {}).get("retrieved") or "")[:10]
        return {
            "vintage": f"Xunta de Galicia, Consellería de Educación, oferta ordinaria de FP 2026-27 (PDF descargado el {day}; "
                       f"índice de la Consellería actualizado el {INDEX_UPDATED})",
            "retrieved": day, "index_updated": INDEX_UPDATED, "pdf_sha256": sha, "pdf_pages": doc["pages"],
            "centres": [centres[c] for c in sorted(centres)],
            "rows": sorted(rows, key=lambda r: (r["centre"], r["level"], r["code"], r["shift"])),
            "centres_without_rows": empty,
            "_files": [PDF, JSON],
        }
