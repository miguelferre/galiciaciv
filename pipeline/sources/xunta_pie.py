"""Proyectos Industriales Estratégicos (PIE) de Galicia: lista oficial de la Consellería de Economía e Industria.

La lista es una tabla HTML (17 proyectos el 2026-11-27) en https://economia.xunta.gal/industria/proxectos-industriais-estratexicos;
no hay CSV, XLS ni PDF enlazado ni conjunto en Abert@s. Columnas: Solicitante, Proxecto, Concello, Investimento, Emprego
total, Estado. Cuidado con dos cosas:

* «Emprego total» es el empleo total anunciado, **directo más indirecto**: SAIC figura con 2 300 (2 000 en Ferrol y 300 en
  As Pontes) y el DOG da 1 000 directos en Ferrol. Aquí sale como `jobs_total`, sin tocar.
* El concello llega como texto: «Mugardos (A Coruña)», «O Pino/Touro (A Coruña)» o, en un caso, una frase. Se guarda el
  texto y la lista de nombres de concello (`concellos`); el código INE lo pone el builder. No hay coordenadas: el builder
  usa el centro del concello.

Licencia: aviso legal del portal de la Xunta (https://www.xunta.gal/aviso-legal-do-portal-da-xunta, leído el 2026-11-27):
reutilización también comercial, citando la fuente y sin desnaturalizar. La página solo muestra un logo Creative Commons
sin variante: se trata como reutilizable con cita (por confirmar la variante). El estado cambia con el tiempo: la
fecha de consulta va siempre con el dato.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

from ..core.fetch import read_manifest
from ..core.source import Source, SourceInfo

URL = "https://economia.xunta.gal/industria/proxectos-industriais-estratexicos"
FILE = "pie.html"
PROVINCES = {"A Coruña", "Lugo", "Ourense", "Pontevedra"}
HEADER = ["Solicitante", "Proxecto", "Concello", "Investimento", "Emprego total", "Estado"]
STATUS = [("Aprobado definitivamente", "aprobado"), ("Declarado", "declarado"), ("Finalizada a tramitación ambiental", "ambiental_finalizada"),
          ("Finalizada a información pública", "informacion_publica_finalizada"), ("En tramitación ambiental", "en_tramitacion_ambiental")]
MIN_PROJECTS = 10


class _Table(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self._row, self._cell, self._links = [], None, None, []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell, self._links = [], []
        elif tag == "a" and self._cell is not None and dict(attrs).get("href"):
            self._links.append(dict(attrs)["href"])

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append((" ".join("".join(self._cell).split()), self._links))
            self._cell = None
        elif tag == "tr" and self._row:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _number(text: str):
    """First number of a text in Spanish format: «2.300 (...)» -> 2300.0, «44,8 M€» -> 44.8."""
    m = re.search(r"\d[\d.]*(?:,\d+)?", text)
    if not m:
        return None
    s = m.group(0)
    return float(s.replace(".", "").replace(",", ".")) if "," in s or re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s) else float(s)


def _concellos(text: str):
    """(names, province or None, note or None) of «Mugardos (A Coruña)», «O Pino/Touro (A Coruña)»."""
    m = re.fullmatch(r"([^()]+?)\s*(?:\(([^()]*)\))?", text.strip())
    names = [n.strip() for n in m.group(1).split("/") if n.strip()]
    inside = m.group(2)
    if inside in PROVINCES:
        return names, inside, None
    return names, None, inside


class XuntaPie(Source):
    info = SourceInfo(
        id="xunta_pie",
        title="Proyectos Industriales Estratégicos (PIE) de Galicia",
        publisher="Xunta de Galicia, Consellería de Economía e Industria",
        homepage=URL,
        license="Aviso legal del portal de la Xunta: reutilización comercial y no comercial con cita y sin desnaturalizar "
        "(leído el 2026-11-27); atribución «Fonte: Xunta de Galicia»",
        description="Lista oficial de proyectos industriales estratégicos declarados o en trámite: solicitante, proyecto, concello, "
        "inversión, empleo total anunciado (directo más indirecto) y estado, con el enlace al DOG cuando está aprobado. "
        "Tabla HTML de la página de la Consellería; sin coordenadas.",
        used_for=["Formación profesional: proyectos industriales anunciados y demanda futura por comarca"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force)

    def process(self):
        path = self.raw_dir / FILE
        if not path.exists():
            raise FileNotFoundError(f"{path} missing; run fetch first")
        t = _Table()
        t.feed(path.read_text(encoding="utf-8"))
        if not t.rows or [c[0] for c in t.rows[0]] != HEADER:
            raise RuntimeError(f"xunta_pie: the table header is not {HEADER}; the page changed")
        projects = []
        for row in t.rows[1:]:
            if len(row) != 6:
                raise RuntimeError(f"xunta_pie: a row has {len(row)} cells: {row[0][0]!r}")
            (company, _), (project, _), (conc, _), (inv, _), (jobs, _), (state, links) = row
            names, prov, note = _concellos(conc)
            kind = next((k for p, k in STATUS if state.startswith(p)), None)
            projects.append({
                "company": company, "project": project, "concello_text": conc, "concellos": names, "province": prov,
                "concello_note": note, "investment_meur": _number(inv), "investment_text": inv, "jobs_total": int(_number(jobs)),
                "jobs_text": jobs, "status_text": state, "status": kind, "dog": links,
            })
        if len(projects) < MIN_PROJECTS or any(p["investment_meur"] is None or not p["concellos"] for p in projects):
            raise RuntimeError(f"xunta_pie: {len(projects)} projects or a missing investment/concello; check the page")
        day = (read_manifest(self.id).get(FILE, {}).get("retrieved") or "")[:10]
        return {"vintage": f"Xunta de Galicia, Consellería de Economía e Industria, lista de PIE consultada el {day}",
                "retrieved": day, "projects": projects, "_files": [FILE]}
