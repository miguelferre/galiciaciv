"""Convert the Xunta FP offer PDF (2026-27, ordinary offer by province and concello) to JSON (needs pdfplumber).

    uv run --with pdfplumber python tools/prep_fp_oferta.py

The pipeline is stdlib-only and the PDF has no text layer that survives a plain text dump (`pdftotext -layout` shuffles
cycle codes and names), so the PDF is read here by word position and written to
data/raw/xunta_oferta_fp/oferta.json, which the source `xunta_oferta_fp` (pipeline/sources/) reads in process().
The PDF is downloaded by `python -m pipeline fetch xunta_oferta_fp` into data/raw/xunta_oferta_fp/oferta-2026-27.pdf;
if it is missing this tool downloads it too (https://www.edu.xunta.gal/fp/webfm_send/11778).

Page layout (checked on the 2026-11-27 PDF, 50 pages), by font and x position:
* size 16, x=55: province ("A Coruña", "Lugo", "Ourense", "Pontevedra"); the page-1 title is also size 16.
* size 12, x=55: concello ("Coruña, A": article last, as the register writes it).
* size 10, x=55: centre line "<8-digit code> <type> <name>".
* size 9 bold, x=108: "Grao Básico|Medio|Superior".
* size 8, x=108: cycle code (D1/D2/D3 + family + number; E2/E3 specialisation courses; legacy M19001 and S19003);
  name from x=176, shift (Mañá/Tarde) at x=438, "<n> prazas" at the right. A name that wraps continues on a line that
  starts at x=176 with no code.
* size 7: e-mail and phone of the centre, page header and footer: ignored.
A line that fits none of these goes to `unparsed` with its page, so a change of format shows up instead of failing silently.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "xunta_oferta_fp"
PDF = RAW / "oferta-2026-27.pdf"
OUT = RAW / "oferta.json"
URL = "https://www.edu.xunta.gal/fp/webfm_send/11778"
PROVINCES = {"A Coruña", "Lugo", "Ourense", "Pontevedra"}
CYCLE_CODE = re.compile(r"^[A-Z][0-9A-Z]*[0-9]$")
CENTRE = re.compile(r"^(\d{8}) (\S+) (.+)$")
GRADE = {"Básico": "basico", "Medio": "medio", "Superior": "superior"}
SHIFTS = {"Mañá": "manana", "Tarde": "tarde"}
X_CODE, X_NAME, X_SHIFT = 108, 176, 430


def _lines(page):
    words = [w for w in page.extract_words(extra_attrs=["size"]) if w["size"] >= 7.5]
    words.sort(key=lambda w: (w["top"], w["x0"]))
    rows, cur, top = [], [], None
    for w in words:
        if top is None or abs(w["top"] - top) <= 2.5:
            cur.append(w)
            top = w["top"] if top is None else top
        else:
            rows.append(sorted(cur, key=lambda v: v["x0"]))
            cur, top = [w], w["top"]
    if cur:
        rows.append(sorted(cur, key=lambda v: v["x0"]))
    return rows


def _line(r, page_no):
    return {"page": page_no, "text": " ".join(w["text"] for w in r)}


def parse(pdf_path: Path) -> dict:
    rows, unparsed, centres = [], [], {}
    prov = conc = centre = grade = None
    last = None
    with pdfplumber.open(pdf_path) as pdf:
        n_pages = len(pdf.pages)
        for page_no, page in enumerate(pdf.pages, 1):
            for r in _lines(page):
                x0, size, text = round(r[0]["x0"]), round(r[0]["size"]), " ".join(w["text"] for w in r)
                if size == 16:
                    if text in PROVINCES:
                        prov, conc, centre, grade, last = text, None, None, None, None
                    elif page_no != 1 or not text.startswith(("Formación", "Ensinanzas", "Oferta")):
                        unparsed.append(_line(r, page_no))
                elif size == 12 and x0 == 55:
                    if text.startswith("Clasificada") and page_no == 1:
                        continue
                    conc, centre, grade, last = text, None, None, None
                elif size == 10 and x0 == 55:
                    m = CENTRE.match(text)
                    if not m or not (prov and conc):
                        unparsed.append(_line(r, page_no))
                        centre = None
                        continue
                    centre = m.group(1)
                    if centre in centres:
                        unparsed.append({**_line(r, page_no), "why": "centre repeated"})
                    centres[centre] = {"code": centre, "type": m.group(2), "name": m.group(3), "province": prov,
                                       "concello": conc}
                    grade, last = None, None
                elif size == 9 and text.startswith("Grao "):
                    grade = GRADE.get(text[5:])
                    if grade is None:
                        unparsed.append(_line(r, page_no))
                    last = None
                elif size == 8 and x0 == X_CODE and CYCLE_CODE.match(r[0]["text"]):
                    shift = next((SHIFTS[w["text"]] for w in r if w["x0"] >= X_SHIFT and w["text"] in SHIFTS), None)
                    places = None
                    if r[-1]["text"] == "prazas" and len(r) >= 2 and r[-2]["text"].isdigit():
                        places = int(r[-2]["text"])
                    name = " ".join(w["text"] for w in r[1:] if X_NAME - 2 <= w["x0"] < X_SHIFT)
                    if not (centre and grade and name and shift and places is not None):
                        unparsed.append(_line(r, page_no))
                        last = None
                        continue
                    last = {"centre": centre, "code": r[0]["text"], "name": name, "header_grade": grade,
                            "shift": shift, "places": places}
                    rows.append(last)
                elif size == 8 and x0 == X_NAME and last is not None and not CYCLE_CODE.match(r[0]["text"]) \
                        and all(w["x0"] < X_SHIFT for w in r):
                    last["name"] += " " + text  # a wrapped cycle name
                else:
                    unparsed.append(_line(r, page_no))
    return {"pages": n_pages, "centres": list(centres.values()), "rows": rows, "unparsed": unparsed}


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    if not PDF.exists():
        print(f"downloading {URL}")
        req = urllib.request.Request(URL, headers={"User-Agent": "galiciaciv/0.1 (open data pipeline)"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            PDF.write_bytes(resp.read())
    doc = parse(PDF)
    doc["pdf"] = PDF.name
    doc["pdf_sha256"] = hashlib.sha256(PDF.read_bytes()).hexdigest()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    places = sum(r["places"] for r in doc["rows"])
    print(f"{doc['pages']} pages, {len(doc['centres'])} centres, {len(doc['rows'])} cycle rows, {places} places, "
          f"{len(doc['unparsed'])} lines not parsed -> {OUT}")
    for u in doc["unparsed"][:20]:
        print("  unparsed:", u)
    return 0


if __name__ == "__main__":
    sys.exit(main())
