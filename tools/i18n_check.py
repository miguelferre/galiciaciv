"""Check the galego dictionaries against the code and the data (plan: _meta/plan-bilingue.html).

    uv run python tools/i18n_check.py          # PASS / WARN / FAIL lines; exit code 1 on any FAIL

FAIL  a t("...") key, a data-i18n text in index.html or a listed data field (web/i18n/campos.json) with no galego
FAIL  t() called with a template literal that has ${...}: use t("... {name} ...", { name }) instead
FAIL  the same key with two different galego texts in two dictionary files
WARN  dictionary keys that nothing uses any more (the castellano text changed)
WARN  literals with castellano text outside t() in files that already import i18n.js (probably missed)
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
GL_DIR = WEB / "i18n" / "gl"
FIELDS_FILE = WEB / "i18n" / "campos.json"

T_CALL = re.compile(r"""(?<![\w$.])t\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1""", re.S)
STR = re.compile(r"""(["'`])((?:\\.|(?!\1)[^\\\n])*)\1""")
SPANISH = re.compile(r"[áéíóúñÁÉÍÓÚÑ¿¡]|\b(de|del|la|las|los|el|en|con|por|para|una|sin|más|que)\b")
# Strings that look castellano but are not shown to people.
NOT_UI = re.compile(r"^[\w.#\[\]=:/-]+$|https?://|\bvar\(|\d+px\b|rgba?\(", re.ASCII)  # one token: id, selector, path


def unescape(s: str) -> str:
    s = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), s)


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", src)


@dataclass
class Report:
    lines: list[tuple[str, str]] = field(default_factory=list)

    def add(self, level: str, msg: str) -> None:
        self.lines.append((level, msg))

    @property
    def failures(self) -> list[str]:
        return [m for lvl, m in self.lines if lvl == "FAIL"]


def js_files() -> list[Path]:
    return sorted(p for p in (WEB / "js").rglob("*.js") if "vendor" not in p.parts)


def load_dict(rep: Report) -> dict[str, str]:
    out: dict[str, str] = {}
    where: dict[str, str] = {}
    for f in sorted(GL_DIR.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for k, v in d.items():
            if k.startswith("_"):  # _meta, _palabras
                continue
            if k in out and out[k] != v:
                rep.add("FAIL", f"clave con dos traducciones: «{k}» ({where[k]} y {f.name})")
            out[k] = v
            where[k] = f.name
    return out


def code_keys(rep: Report) -> dict[str, str]:
    keys: dict[str, str] = {}
    for f in js_files():
        src = strip_comments(f.read_text(encoding="utf-8"))
        for m in T_CALL.finditer(src):
            line = src.count("\n", 0, m.start()) + 1
            rel = f"{f.relative_to(ROOT).as_posix()}:{line}"
            if m.group(1) == "`" and "${" in m.group(2):
                rep.add("FAIL", f"t() con ${{...}}: {rel}")
                continue
            keys.setdefault(unescape(m.group(2)), rel)
    return keys


def html_keys() -> dict[str, str]:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    keys: dict[str, str] = {}
    for m in re.finditer(r"<(\w+)([^>]*?)\sdata-i18n(?=[\s>=])(?:=\"\")?([^>]*)>(.*?)</\1>", html, re.S):
        text = re.sub(r"\s+", " ", m.group(4)).strip()
        if text:
            keys.setdefault(text, "web/index.html")
    for m in re.finditer(r"<\w+([^>]*\sdata-i18n-attr=\"([^\"]+)\"[^>]*)>", html, re.S):
        attrs = m.group(1)
        for a in m.group(2).split(","):
            v = re.search(rf'\s{re.escape(a.strip())}="([^"]*)"', attrs)
            if v and v.group(1).strip():
                keys.setdefault(v.group(1), "web/index.html")
    return keys


def split_path(path: str) -> list[str]:
    return [p for p in path.replace("[]", ".[]").split(".") if p]


def walk(node, parts, out):
    if node is None or not parts:
        return
    head, rest = parts[0], parts[1:]
    if head == "[]":
        if isinstance(node, list):
            for x in node:
                if rest:
                    walk(x, rest, out)
                elif isinstance(x, str):
                    out.append(x)
        return
    if head == "*":
        if isinstance(node, dict):
            for v in node.values():
                if rest:
                    walk(v, rest, out)
                elif isinstance(v, str):
                    out.append(v)  # "industries.*": every text value of the object
        return
    if not isinstance(node, dict):
        return
    if not rest:
        if isinstance(node.get(head), str):
            out.append(node[head])
        return
    walk(node.get(head), rest, out)


def data_keys() -> dict[str, str]:
    if not FIELDS_FILE.exists():
        return {}
    fields = json.loads(FIELDS_FILE.read_text(encoding="utf-8"))
    keys: dict[str, str] = {}
    for name, paths in fields.items():
        if name.startswith("_"):
            continue
        f = WEB / "data" / f"{name}.json"
        if not f.exists():
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        for p in paths:
            found: list[str] = []
            walk(data, split_path(p), found)
            for s in found:
                if s.strip():
                    keys.setdefault(s, f"{name}.json · {p}")
    return keys


def stray_literals(limit_per_file: int = 50) -> list[str]:
    """Castellano-looking literals outside t() in files that already import i18n.js."""
    out = []
    for f in js_files():
        raw = f.read_text(encoding="utf-8")
        if "i18n.js" not in raw or f.name in ("i18n.js", "boot.js"):
            continue
        # Blank out every t("...") literal first, so the quotes inside ${t("...")} do not pair up with others.
        src = T_CALL.sub(lambda m: "t(" + "0" * (len(m.group(0)) - 2), strip_comments(raw))
        n = 0
        for m in STR.finditer(src):
            plain = re.sub(r"<[^>]+>|\$\{[^}]*\}", " ", m.group(2)).strip()
            if len(plain) < 3 or not SPANISH.search(plain) or NOT_UI.search(plain):
                continue
            # prep("de", ...) and import paths
            if re.fullmatch(r"(en|de|por|a|con)", plain):
                continue
            line = src.count("\n", 0, m.start()) + 1
            out.append(f"{f.relative_to(ROOT).as_posix()}:{line} «{plain[:60]}»")
            n += 1
            if n >= limit_per_file:
                break
    return out


def load_words() -> dict[str, str]:
    out: dict[str, str] = {}
    for f in sorted(GL_DIR.glob("*.json")):
        out.update(json.loads(f.read_text(encoding="utf-8")).get("_palabras", {}))
    return out


def rule_keys() -> tuple[dict[str, str], set[str]]:
    """Texts that the RULES of web/js/i18n.js translate with t(variable) or the word list: resources.json only."""
    f = WEB / "data" / "resources.json"
    keys: dict[str, str] = {}
    words: set[str] = set()
    if not f.exists():
        return keys, words
    for it in json.loads(f.read_text(encoding="utf-8")).get("items", []):
        name, detail = it.get("name", ""), it.get("detail", "")
        m = re.match(r"^(.+?) en (.+)$", name)
        if m and not name.startswith("Lonja de "):
            keys[m.group(1)] = "resources.json items[].name"
        m = re.match(r"^(\d+) explotaciones activas: (.+)$", detail)
        if m:
            words.update(re.findall(r"[^\W\d_]+", m.group(2)))
    return keys, words


def run() -> Report:
    rep = Report()
    gl = load_dict(rep)
    used: set[str] = set()
    rkeys, rwords = rule_keys()
    missing_words = sorted(rwords - set(load_words()))
    if missing_words:
        rep.add("FAIL", f"_palabras: {len(missing_words)} palabras de resources.json sin galego: {', '.join(missing_words[:30])}")
    elif rwords:
        rep.add("PASS", f"_palabras: {len(rwords)} palabras de resources.json, todas con galego")
    for label, keys in (("código", code_keys(rep)), ("index.html", html_keys()), ("datos", data_keys()), ("reglas", rkeys)):
        miss = [(k, w) for k, w in keys.items() if k not in gl]
        used.update(keys)
        if miss:
            rep.add("FAIL", f"{label}: {len(miss)} de {len(keys)} textos sin galego")
            for k, w in miss[:40]:
                rep.add("FAIL", f"    {w} «{k[:80]}»")
        else:
            rep.add("PASS", f"{label}: {len(keys)} textos, todos con galego")
    unused = sorted(set(gl) - used)
    if unused:
        rep.add("WARN", f"{len(unused)} claves del diccionario sin uso")
        for k in unused[:20]:
            rep.add("WARN", f"    «{k[:80]}»")
    stray = stray_literals()
    if stray:
        rep.add("WARN", f"{len(stray)} literales en castellano fuera de t() en ficheros ya migrados")
        for s in stray[:30]:
            rep.add("WARN", f"    {s}")
    rep.add("NOTE", f"diccionario: {len(gl)} entradas en {len(list(GL_DIR.glob('*.json')))} ficheros")
    return rep


def main() -> int:
    rep = run()
    for lvl, msg in rep.lines:
        print(f"{lvl:4}  {msg}")
    return 1 if rep.failures else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
