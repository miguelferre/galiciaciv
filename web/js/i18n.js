// Two languages, galego (gl) and castellano (es). Castellano is the source: every visible string in the code is
// written in castellano and wrapped in t(); the galego dictionaries in web/i18n/gl/ map that text to galego.
//
//   t("Abrir el informe")                → "Abrir o informe" in gl, the key itself in es
//   t("Quemado en {year}", { year })     → named slots, so a whole sentence is translated at once
//   prep("en", "A Coruña")               → gl "na Coruña" (contraction with the article), es "en A Coruña"
//
// boot.js calls init() before it imports main.js, so module-level constants (ADVISORS, terrain names...) already
// see the dictionary when they are evaluated. Changing the language saves it and reloads the page: the view lives
// in the URL hash, so nothing is lost. Toponyms are never translated (they are the official galego forms).
// See _meta/plan-bilingue.html and tools/i18n_check.py (fails when a t() key has no galego).

export const LANGS = ["gl", "es"];
const STORE_KEY = "galiciaciv.lang";
// Dictionary files in web/i18n/gl/, one per batch of the translation (each has a "_meta" block with its review
// state). Add a file here when a new batch starts.
export const GL_FILES = ["t1-barra", "t2-asesores", "t3-resto"];

let LANG = "es";
let DICT = Object.create(null);
let FIELDS = {};
let WORDS = Object.create(null); // "_palabras" of the dictionary: single words inside data texts (see RULES)
let explicit = false; // the language came from the selector (saved) or from the link: keep it in the hash
const missing = new Set(); // gl keys asked for but absent; see window.__i18n in the console

function stored() {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/** The language to show: the link (#lang=), then the saved choice, then the browser's languages. */
export function resolveLang() {
  let fromHash = null;
  try {
    fromHash = new URLSearchParams(String(location.hash || "").replace(/^#/, "")).get("lang");
  } catch {
    /* no location in tests */
  }
  const saved = stored();
  const navs = (typeof navigator !== "undefined" && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  const nav = navs.some((l) => /^gl\b/i.test(String(l || ""))) ? "gl" : "es";
  if (LANGS.includes(fromHash)) return { lang: fromHash, explicit: true };
  if (LANGS.includes(saved)) return { lang: saved, explicit: true };
  return { lang: nav, explicit: false };
}

async function fetchJSON(path) {
  const r = await fetch(new URL(path, import.meta.url));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

/** Resolve the language, load the galego dictionaries if needed and translate the static HTML. */
export async function init() {
  const r = resolveLang();
  LANG = r.lang;
  explicit = r.explicit;
  if (LANG === "gl") {
    try {
      const [fields, ...files] = await Promise.all([
        fetchJSON("../i18n/campos.json").catch(() => ({})),
        ...GL_FILES.map((f) => fetchJSON(`../i18n/gl/${f}.json`)),
      ]);
      FIELDS = fields || {};
      for (const f of files) {
        for (const [k, v] of Object.entries(f)) if (!k.startsWith("_") && typeof v === "string" && v) DICT[k] = v;
        Object.assign(WORDS, f._palabras || {});
      }
    } catch (err) {
      // Without the dictionary the page still works, in castellano.
      console.warn("i18n: sin diccionario de galego", err);
      LANG = "es";
    }
  }
  document.documentElement.lang = locale();
  applyStatic(document);
  if (typeof window !== "undefined") window.__i18n = { lang: LANG, missing, size: () => Object.keys(DICT).length };
}

export const lang = () => LANG;
export const locale = () => (LANG === "gl" ? "gl-ES" : "es-ES");

/** Translate a castellano string. vars fills {name} slots (after translation, so the slots can move). */
export function t(es, vars) {
  let s = es;
  if (LANG === "gl") {
    const g = DICT[es];
    if (g) s = g;
    else if (es) missing.add(es);
  }
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? "")) : s;
}

// Galego contracts a preposition with the article of a toponym: en + A Coruña → na Coruña, de + O Barco → do Barco,
// por + Os Blancos → polos Blancos, a + O Grove → ao Grove. Castellano keeps both words: "en A Coruña".
const GL_PREP = { en: { a: "na", o: "no", as: "nas", os: "nos" }, de: { a: "da", o: "do", as: "das", os: "dos" },
  por: { a: "pola", o: "polo", as: "polas", os: "polos" }, a: { a: "á", o: "ao", as: "ás", os: "aos" },
  con: { a: "coa", o: "co", as: "coas", os: "cos" } };
const GL_PLAIN = { en: "en", de: "de", por: "por", a: "a", con: "con" };

/** A preposition followed by a place name, with the galego contraction when the name starts with an article. */
export function prep(p, name) {
  const n = String(name ?? "");
  if (LANG !== "gl") return `${p} ${n}`;
  const m = /^(A|O|As|Os) (.+)$/.exec(n);
  const table = GL_PREP[p];
  if (m && table) return `${table[m[1].toLowerCase()]} ${m[2]}`;
  return `${GL_PLAIN[p] ?? t(p)} ${n}`;
}

/** Elements marked in index.html: data-i18n translates the text, data-i18n-attr="title,aria-label" attributes. */
export function applyStatic(root) {
  if (LANG === "es" || !root?.querySelectorAll) return;
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.textContent.trim().replace(/\s+/g, " "));
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const a of el.dataset.i18nAttr.split(",").map((x) => x.trim()).filter(Boolean)) {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, t(v));
    }
  }
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.innerHTML.trim().replace(/\s+/g, " "));
}

// --- data files ---------------------------------------------------------------------------------------------------
// web/i18n/campos.json lists, per data file, the text fields to translate as paths: "lenses[].name",
// "rule.text", "[].title" (the file is an array), "*.rule" (that key in every object of the top level).
// Fields not listed (toponyms, ids, licences) stay as they are.

function walk(node, parts, fn) {
  if (node == null) return;
  if (!parts.length) return;
  const [head, ...rest] = parts;
  if (head === "[]") {
    if (Array.isArray(node)) node.forEach((x, i) => (rest.length ? walk(x, rest, fn) : fn(node, i)));
    return;
  }
  if (head === "*") {
    if (node && typeof node === "object") {
      for (const k of Object.keys(node)) {
        if (rest.length) walk(node[k], rest, fn);
        else if (typeof node[k] === "string") fn(node, k); // "industries.*": every text value of the object
      }
    }
    return;
  }
  if (typeof node !== "object") return;
  if (!rest.length) {
    if (typeof node[head] === "string") fn(node, head);
    return;
  }
  walk(node[head], rest, fn);
}

export function splitPath(path) {
  return path.replace(/\[\]/g, ".[]").split(".").filter(Boolean);
}

// Data texts that the pipeline builds from a template (resources.json): each rule parses the castellano text and
// rebuilds it with t(). A text that no rule matches stays as it is. Rock and mineral words come from the
// "_palabras" object of the dictionary (tools/i18n_check.py checks that every word of the data has one).
const words = (s) => s.replace(/[^\W\d_]+/gu, (w) => WORDS[w] ?? w);
const RULES = {
  resources: {
    "items[].name": [
      [/^Lonja de (.+?)( \(\+\d+\))?$/, (m) => t("Lonja {lugar}", { lugar: prep("de", m[1]) }) + (m[2] || "")],
      [/^(.+?) en (.+)$/, (m) => `${t(m[1])} ${prep("en", m[2])}`],
    ],
    "items[].detail": [
      [/^(\d+) explotaciones activas: (.+)$/, (m) => t("{n} explotaciones activas: {lista}", { n: m[1], lista: words(m[2]) })],
      [/^Primera venta (\d{4}): (.+?)\. Destacan: (.+?)(?:\. Lonjas: (.+))?$/, (m) => {
        const base = t("Primera venta {year}: {total}. Destacan: {top}", { year: m[1], total: m[2], top: m[3] });
        return m[4] ? t("{base}. Lonjas: {lista}", { base, lista: m[4] }) : base;
      }],
      [/^(.*)En marcha, autorizados o en obras\.$/, (m) => m[1] + t("En marcha, autorizados o en obras.")],
    ],
  },
};

function applyRules(name, data) {
  for (const [path, rules] of Object.entries(RULES[name] || {})) {
    walk(data, splitPath(path), (obj, key) => {
      const s = obj[key];
      if (DICT[s]) return void (obj[key] = DICT[s]);
      for (const [re, fn] of rules) {
        const m = re.exec(s);
        if (m) return void (obj[key] = fn(m));
      }
    });
  }
}

/** Translate the listed text fields of a loaded data file in place (gl only). Returns the same object. */
export function translateData(name, data) {
  if (LANG !== "gl" || !data) return data;
  applyRules(name, data);
  for (const path of FIELDS[name] || []) {
    walk(data, splitPath(path), (obj, key) => {
      obj[key] = t(obj[key]);
    });
  }
  return data;
}

// --- choice and link ------------------------------------------------------------------------------------------------

/** Save a language and reload: the hash keeps the view (lens, place, advisor, camera). */
export function setLang(next) {
  if (!LANGS.includes(next) || next === LANG) return;
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {
    /* private window: the link still carries it */
  }
  try {
    const p = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    p.set("lang", next);
    history.replaceState(null, "", location.pathname + location.search + "#" + p.toString());
  } catch {
    /* sandbox */
  }
  location.reload();
}

/** For app.hash.register("lang", ...): the link carries the language only when someone chose it. */
export function langHashKey() {
  return {
    get: () => (explicit ? LANG : null),
    set: (v) => {
      if (LANGS.includes(v) && v !== LANG) setLang(v);
    },
  };
}

/** The two-button selector in the top bar. */
export function mountLangSwitch(host) {
  if (!host || host.querySelector(".lang-seg")) return;
  const seg = document.createElement("div");
  seg.className = "lang-seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", t("Idioma"));
  for (const [code, label, full] of [["gl", "GL", "Galego"], ["es", "ES", "Castellano"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lang-btn";
    b.dataset.lang = code;
    b.textContent = label;
    b.lang = code;
    b.title = full;
    b.setAttribute("aria-label", full);
    b.setAttribute("aria-pressed", String(code === LANG));
    b.addEventListener("click", () => setLang(code));
    seg.appendChild(b);
  }
  host.appendChild(seg);
}
