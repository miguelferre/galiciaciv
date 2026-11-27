"""Review sheet for one galego dictionary: castellano and galego side by side, with a filter.

    uv run python tools/i18n_hoja.py t1-barra          # writes _meta/i18n/hoja-t1-barra.html

Miguel reads the sheet (and the viewer in galego) and says in the chat what changes. When a batch is reviewed,
set "_meta": {"estado": "revisada"} in its file in web/i18n/gl/.
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PAGE = """<!doctype html>
<html lang="gl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisión {name}</title>
<style>
  :root {{ --bg: #101923; --ink: #efe4c6; --dim: #b9ab88; --gold: #ecd08e; --line: rgba(201,164,92,.25); }}
  body {{ margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 "Segoe UI", system-ui, sans-serif; }}
  main {{ max-width: 1100px; margin: 0 auto; padding: 16px; }}
  h1 {{ font-size: 20px; color: var(--gold); margin: 4px 0 2px; text-wrap: balance; }}
  p {{ color: var(--dim); margin: 0 0 12px; text-wrap: pretty; }}
  input {{ width: 100%; box-sizing: border-box; padding: 8px 10px; background: #182533; color: var(--ink);
    border: 1px solid var(--line); border-radius: 4px; font: inherit; margin-bottom: 10px; }}
  table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
  th, td {{ text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }}
  th {{ color: var(--gold); font-weight: 600; position: sticky; top: 0; background: var(--bg); }}
  td.n {{ width: 3.5em; color: var(--dim); font-variant-numeric: tabular-nums; }}
  .slot {{ color: #8cc2ee; }}
  .same td.gl {{ color: var(--dim); }}
  th.n {{ width: 3.5em; }}
  @media (max-width: 640px) {{ td.n, th.n {{ width: 2.2em; padding-left: 0; padding-right: 4px; }} }}
</style>
<main>
  <h1>Tanda {tanda}</h1>
  <p>{count} textos · estado: <b>{estado}</b>. Os textos en gris son iguais nos dous idiomas. Di no chat o número e o cambio.</p>
  <input type="search" placeholder="Filtrar" aria-label="Filtrar" id="q">
  <table>
    <thead><tr><th class="n">#</th><th>castellano</th><th>galego</th></tr></thead>
    <tbody>
{rows}
    </tbody>
  </table>
</main>
<script>
  const q = document.getElementById("q");
  q.addEventListener("input", () => {{
    const v = q.value.toLowerCase();
    for (const tr of document.querySelectorAll("tbody tr")) tr.hidden = v && !tr.textContent.toLowerCase().includes(v);
  }});
</script>
</html>
"""


def mark(s: str) -> str:
    return re.sub(r"\{(\w+)\}", r'<span class="slot">{\1}</span>', html.escape(s))


def build(name: str) -> Path:
    src = ROOT / "web" / "i18n" / "gl" / f"{name}.json"
    d = json.loads(src.read_text(encoding="utf-8"))
    meta = d.pop("_meta", {})
    rows = []
    for i, (es, gl) in enumerate(sorted(d.items(), key=lambda kv: kv[0].lower()), 1):
        cls = ' class="same"' if es == gl else ""
        rows.append(f'      <tr{cls}><td class="n">{i}</td><td>{mark(es)}</td><td class="gl" lang="gl">{mark(gl)}</td></tr>')
    out = ROOT / "_meta" / "i18n" / f"hoja-{name}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(PAGE.format(name=html.escape(name), tanda=html.escape(meta.get("tanda", name)), count=len(d),
                               estado=html.escape(meta.get("estado", "borrador")), rows="\n".join(rows)), encoding="utf-8")
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for n in sys.argv[1:] or ["t1-barra"]:
        print(build(n))
