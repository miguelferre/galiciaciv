// Top-bar reports: click a national stat (population, a yield, unemployment) for a Civ-style dropdown with its
// definition, what makes it up, and state / metro leaderboards.
//
// The first half is pure data (statDefs, buildReport): plain objects from nation.json, states.json, cities.json and
// lenses.json, no DOM, so it is easy to check from the console (`window.__app.reports`). The second half renders.
import { compact, dollars, esc, int, isMoneyUnit, money, pct } from "../format.js";
import { hasIcon } from "../icons.js";
import { icon, glyph } from "./icon.js";
import { DISTRICT_ICON } from "./infoPanel.js";
import { t } from "../i18n.js";

export const METRO_MIN = 20000; // ciudades en las clasificaciones de crecimiento / especialización / por habitante (Galicia: la mayor, Vigo, ronda 295 000)
export const BIG_METRO_MIN = 50000; // ciudades en las clasificaciones de paro
const TOP = 8;
const GDP_ROWS = 8; // industries shown before "Show all"
// A related map lens for some reports (shown only when lenses.json has it). These are related measures, not the
// report's own total, and the button says so.
const LENS_FOR = { population: "density", gold: "gdp_pc", food: "farmland", science: "estudios_superiores", unemployment: "unemployment" };
// The advisor dashboard (ext/advisors) that explores each report further; `industry` preselects the Economy
// advisor's specialisation ranking. Buttons show only when the advisors extension is installed.
const ADVISOR_FOR = {
  population: [{ id: "people", label: t("Población") }],
  gold: [{ id: "economy", label: t("Economía") }],
  food: [{ id: "land", label: t("Territorio") }, { id: "economy", label: t("Economía (agricultura y pesca)"), industry: "agricultura" }],
  production: [{ id: "economy", label: t("Economía (industria)"), industry: "industria" }, { id: "energy", label: t("Energía y recursos") }],
  science: [{ id: "knowledge", label: t("Conocimiento") }],
  culture: [{ id: "culture", label: t("Cultura") }],
  unemployment: [{ id: "prosperity", label: t("Prosperidad") }],
};
const advisorApp = () => (typeof window !== "undefined" && window.__app?.hasMode?.("advisor") ? window.__app : null);

const fin = Number.isFinite;
const ratio = (a, b) => (fin(a) && fin(b) && b > 0 ? a / b : null);
export const signedPct = (g, d = 1) => (fin(g) ? `${g >= 0 ? "+" : "−"}${Math.abs(g * 100).toFixed(d).replace(".", ",")}\u00a0%` : "–");

// Counts to three significant figures (leaderboards: 1,12 M vs 1,11 M rather than 1,1 M twice).
export function count3(n) {
  if (!fin(n)) return "–";
  const a = Math.abs(n);
  const sig = (d, unit) => (n / d).toFixed(a / d >= 100 ? 0 : a / d >= 10 ? 1 : 2).replace(".", ",") + " " + unit;
  if (a >= 1e12) return sig(1e12, "B");
  if (a >= 1e9) return sig(1e9, "mil M");
  if (a >= 1e6) return sig(1e6, "M");
  if (a >= 1e4) return sig(1e3, "mil");
  return int(n);
}

// Formats a value of a stat ("usd"/"eur" → €, "rate" → %, anything else → compact count).
export function fmtStat(def, v) {
  if (!fin(v)) return "–";
  if (isMoneyUnit(def.unit)) return money(v);
  if (def.unit === "rate") return pct(v);
  return compact(v);
}

// Every top-bar stat in display order: population, the yields from nation.json, unemployment.
export function statDefs(nation) {
  const n = nation?.nation || {};
  const yields = (nation?.yields || []).map((y) => ({
    key: y.key,
    label: y.label,
    name: y.key === "gold" ? `${y.label} (PIB)` : y.label,
    color: y.color,
    yield: y,
    unit: y.unit,
    description: y.description || "",
    source: y.key === "gold" ? nation.gdp_vintage || nation.vintage || "" : nation.vintage || "",
    value: y.key === "gold" ? n.gdp ?? n.yields?.gold ?? null : n.yields?.[y.key] ?? null,
  }));
  return [
    {
      key: "population", label: t("Población"), name: t("Población"), color: "#e8dcc0", iconId: "pop", emoji: "👥", unit: "people",
      description: t("Habitantes (padrón, INE)."), source: nation?.vintage || "", value: n.population ?? null,
    },
    ...yields,
    {
      key: "unemployment", label: t("Parados"), name: t("Parados registrados por habitante"), color: "#e8dcc0", iconId: "unemployment", emoji: "😐",
      unit: "rate", description: t("Parados registrados ÷ habitantes (IGE 742 e INE padrón). No es la tasa de paro."), source: nation?.vintage || "", value: n.unemployment ?? null,
    },
  ];
}

const industryLabel = (nation, k, gdp = false) => {
  const full = (gdp ? nation.gdp_industries?.[k] : null) || nation.industries?.[k] || (k === "government" ? t("Administración pública") : k);
  return { label: full.replace(/\s*\(.*\)\s*$/, ""), full };
};
const industryIcon = (k) => (hasIcon(`i-${k}`) ? `i-${k}` : k === "government" && hasIcon("i-public_admin") ? "i-public_admin" : null);

// Areas the leaderboards rank: comarcas (index into states.json = world.json states) and cities.
function areas(states, cities) {
  const st = (Array.isArray(states) ? states : [])
    .map((o, i) => (o ? { kind: "state", ref: i, name: o.name || o.abbr || "?", sub: "", o } : null))
    .filter(Boolean);
  const metros = (Array.isArray(cities) ? cities : [])
    .filter((c) => c && c.metro !== false)
    .map((c) => ({ kind: "city", ref: c.id, name: c.name, sub: "", o: c }));
  return { st, metros };
}

// Top TOP rows by valueOf(o); null values are skipped. opts: {asc, min (population), fmt, exact (full-precision
// text for the row's tooltip), subOf}
function rank(list, valueOf, { asc = false, min = 0, fmt = count3, exact = int, subOf = null } = {}) {
  return list
    .filter((r) => !min || (r.o.population ?? 0) >= min)
    .map((r) => ({ r, v: valueOf(r.o) }))
    .filter((x) => fin(x.v))
    .sort((a, b) => (asc ? a.v - b.v : b.v - a.v))
    .slice(0, TOP)
    .map(({ r, v }, i) => ({ rank: i + 1, kind: r.kind, ref: r.ref, name: r.name, sub: subOf ? subOf(r.o) : r.sub, value: v, text: fmt(v), exact: exact ? exact(v) : "" }));
}

// Which comarcas the "Comarcas" rankings cover. states.json holds the comarcas drawn on the map; when the Galicia total
// includes people outside them, say so rather than imply all are ranked.
function stateScope(n, st) {
  const sum = st.reduce((a, r) => a + (fin(r.o.population) ? r.o.population : 0), 0);
  const gap = fin(n.population) && n.population > 0 ? (n.population - sum) / n.population : 0;
  const label = t("Comarcas");
  if (!st.length || gap < 0.001) return { label, note: "" };
  return {
    label, inMap: t("Comarcas del mapa"),
    note: t("Clasifica las {n} comarcas del mapa; {hab} habitantes están en el total de Galicia pero no en la clasificación.", { n: st.length, hab: compact(n.population - sum) }),
  };
}

// Sorted [{r, v}] of every area with a value (for extremes and medians).
function sorted(list, valueOf, min = 0) {
  return list
    .filter((r) => !min || (r.o.population ?? 0) >= min)
    .map((r) => ({ r, v: valueOf(r.o) }))
    .filter((x) => fin(x.v))
    .sort((a, b) => b.v - a.v);
}

/**
 * The report for one stat, as plain data:
 * {key, def, total, totalText, context: [str], definition, source,
 *  breakdown: {title, note, groups: [{title, rows: [{label, full, iconId, emoji, value, text, sub, tone, strong}]}],
 *              collapseAfter} | null,
 *  boards: {note, modes: [{id, label, hint, states: [row], metros: [row]}]},   row: {rank, kind, ref, name, sub, value, text}
 *  lens: {id, name} | null}
 */
export function buildReport(key, { nation, states, cities, lenses, lensVintage } = {}) {
  const def = statDefs(nation).find((d) => d.key === key);
  if (!def) return null;
  const n = nation.nation || {};
  const { st, metros } = areas(states, cities);
  const scope = stateScope(n, st);
  const fmt = (v) => fmtStat(def, v);
  const rep = {
    key, def, total: def.value, totalText: fmt(def.value), context: [], definition: def.description, source: def.source,
    breakdown: null, boards: { note: "", statesNote: scope.note, modes: [] }, lens: null, scope,
  };
  const lensId = LENS_FOR[key];
  const lens = lensId && Array.isArray(lenses) ? lenses.find((l) => l.id === lensId) : null;
  if (lens) {
    const vintage = lens.source && /^acs/i.test(lens.source) && typeof lensVintage === "string" ? lensVintage : "";
    rep.lens = { id: lens.id, name: lens.name || lens.id, unit: lens.unit || "", vintage };
  }

  if (key === "population") reportPopulation(rep, n, st, metros);
  else if (key === "unemployment") reportUnemployment(rep, n, st, metros);
  else if (isMoneyUnit(def.unit)) reportGold(rep, nation, n, st, metros);
  else reportJobs(rep, def, nation, n, st, metros);
  return rep;
}

function reportPopulation(rep, n, st, metros) {
  const yrs = Array.isArray(n.growth_years) && n.growth_years.length === 2 ? n.growth_years : null;
  if (fin(n.growth)) rep.context.push(yrs ? t("{p} desde {year} (padrón, INE)", { p: signedPct(n.growth), year: yrs[0] }) : t("{p} (padrón, INE)", { p: signedPct(n.growth) }));
  const emp = ratio(n.employed, n.population);
  if (emp != null) rep.context.push(t("{n} ocupados, {p} de los habitantes", { n: compact(n.employed), p: pct(emp) }));

  const g = (o) => o.growth;
  const row = (x, prefix = "") => ({
    label: `${prefix}${x.r.name}`, sub: x.r.kind === "city" ? x.r.sub : "", value: x.v, text: signedPct(x.v), tone: x.v >= 0 ? "good" : "bad",
  });
  const groups = [];
  if (fin(n.growth)) groups.push({ rows: [{ label: "Galicia", value: n.growth, text: signedPct(n.growth), tone: n.growth >= 0 ? "good" : "bad", strong: true }] });
  const extremes = (list, titles) => {
    if (list.length < 2) return;
    const k = Math.min(3, Math.floor(list.length / 2));
    const top = list.slice(0, k), bottom = list.slice(-k).reverse();
    groups.push({ title: titles[0], rows: top.map((x) => row(x)) });
    groups.push({ title: bottom.every((x) => x.v < 0) ? titles[1] : titles[2], rows: bottom.map((x) => row(x)) });
  };
  extremes(sorted(st, g), [t("Comarcas que más crecen"), t("Comarcas que pierden población"), t("Comarcas que menos crecen")]);
  const mn = compact(METRO_MIN);
  extremes(sorted(metros, g, METRO_MIN), [t("Ciudades ({n}+) que más crecen", { n: mn }), t("Ciudades ({n}+) que pierden población", { n: mn }), t("Ciudades ({n}+) que menos crecen", { n: mn })]);
  if (groups.length) rep.breakdown = { title: yrs ? t("Variación de la población {a}–{b}", { a: yrs[0], b: yrs[1] }) : t("Variación de la población"), note: rep.scope.note, groups };

  rep.boards.modes = [
    { id: "abs", label: t("Mayores"), states: rank(st, (o) => o.population), metros: rank(metros, (o) => o.population) },
    {
      id: "rel", label: t("Más crecimiento"),
      hint: yrs ? t("Variación de la población desde {year}; ciudades de {n}+ habitantes.", { year: yrs[0], n: compact(METRO_MIN) }) : t("Variación de la población; ciudades de {n}+ habitantes.", { n: compact(METRO_MIN) }),
      states: rank(st, g, { fmt: signedPct, exact: (v) => signedPct(v, 2) }), metros: rank(metros, g, { fmt: signedPct, exact: (v) => signedPct(v, 2), min: METRO_MIN }),
    },
  ];
}

function reportUnemployment(rep, n, st, metros) {
  const u = (o) => o.unemployment;
  if (fin(n.unemployment) && n.unemployment > 0) rep.context.push(t("Aproximadamente 1 de cada {n} personas activas está en paro", { n: Math.round(1 / n.unemployment) }));
  const ss = sorted(st, u);
  if (ss.length >= 2) rep.context.push(t("{area}: del {a} al {b}", { area: rep.scope.note ? rep.scope.inMap : rep.scope.label, a: pct(ss.at(-1).v), b: pct(ss[0].v) }));

  const tone = (v) => (!fin(n.unemployment) || Math.abs(v / n.unemployment - 1) < 0.03 ? null : v > n.unemployment ? "bad" : "good");
  const row = (label, x) => ({ label: `${label}: ${x.r.name}`, sub: x.r.kind === "city" ? x.r.sub : "", value: x.v, text: pct(x.v), tone: tone(x.v) });
  const spread = (list) => (list.length >= 3 ? [row(t("Más alto"), list[0]), row(t("Mediana"), list[Math.floor(list.length / 2)]), row(t("Más bajo"), list.at(-1))] : []);
  const groups = [];
  if (fin(n.unemployment)) groups.push({ rows: [{ label: "Galicia", value: n.unemployment, text: pct(n.unemployment), strong: true }] });
  const sRows = spread(ss), mRows = spread(sorted(metros, u, BIG_METRO_MIN));
  if (sRows.length) groups.push({ title: rep.scope.label, rows: sRows });
  if (mRows.length) groups.push({ title: t("Ciudades grandes ({n}+)", { n: compact(BIG_METRO_MIN) }), rows: mRows });
  if (groups.length) rep.breakdown = { title: t("Dispersión"), note: rep.scope.note, groups };

  const hint = t("Ciudades de {n}+ habitantes.", { n: compact(BIG_METRO_MIN) });
  const o = { fmt: pct, exact: (v) => pct(v, 2) };
  rep.boards.modes = [
    { id: "abs", label: t("Más alto"), hint, states: rank(st, u, o), metros: rank(metros, u, { ...o, min: BIG_METRO_MIN }) },
    { id: "rel", label: t("Más bajo"), hint, states: rank(st, u, { ...o, asc: true }), metros: rank(metros, u, { ...o, asc: true, min: BIG_METRO_MIN }) },
  ];
}

function reportGold(rep, nation, n, st, metros) {
  const gdp = (o) => o.gdp ?? o.yields?.gold ?? null;
  const pp = ratio(rep.total, n.population);
  // GDP and population can come from different years (BEA GDP lags the ACS by a year): say which.
  const popYear = fin(nation.year) ? nation.year : null;
  const years = n.gdp_year && popYear && n.gdp_year !== popYear ? t("PIB de {a} ÷ habitantes de {b}", { a: n.gdp_year, b: popYear }) : t("PIB ÷ habitantes");
  if (pp != null) rep.context.push(t("{m} por habitante ({years})", { m: money(pp), years }));
  if (n.gdp_year) rep.context.push(t("Año {y}, euros corrientes", { y: n.gdp_year }));

  const rows = Object.entries(n.gdp_by_industry || {})
    .filter(([, v]) => fin(v))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const { label, full } = industryLabel(nation, k, true);
      const s = ratio(v, rep.total);
      return { label, full, iconId: industryIcon(k), emoji: DISTRICT_ICON[k] || "•", value: v, text: money(v), sub: s != null ? pct(s) : "" };
    });
  if (rows.length) rep.breakdown = { title: t("PIB por sector"), groups: [{ rows }], collapseAfter: GDP_ROWS };

  const perPerson = (o) => ratio(gdp(o), o.population);
  rep.boards.modes = [
    { id: "abs", label: t("Mayor PIB"), states: rank(st, gdp, { fmt: money, exact: dollars }), metros: rank(metros, gdp, { fmt: money, exact: dollars }) },
    {
      id: "rel", label: t("Por habitante"), hint: t("{years}; ciudades de {n}+ habitantes.", { years, n: compact(METRO_MIN) }),
      states: rank(st, perPerson, { fmt: money, exact: dollars }), metros: rank(metros, perPerson, { fmt: money, exact: dollars, min: METRO_MIN }),
    },
  ];
}

function reportJobs(rep, def, nation, n, st, metros) {
  const key = def.key;
  const nShare = ratio(rep.total, n.employed);
  if (nShare != null) rep.context.push(t("{p} de los {n} ocupados", { p: pct(nShare), n: compact(n.employed) }));
  const per1k = ratio(rep.total, n.population);
  if (per1k != null) rep.context.push(t("{n} por cada 1000 habitantes", { n: int(Math.round(per1k * 1000)) }));

  const inds = Array.isArray(def.yield?.industries) ? def.yield.industries : [];
  const gdpOf = inds.map((k) => n.gdp_by_industry?.[k]);
  if (inds.length && gdpOf.every(fin) && fin(n.gdp)) {
    const sum = gdpOf.reduce((a, b) => a + b, 0);
    const gv = { m: money(sum), p: pct(sum / n.gdp), year: n.gdp_year ? `, ${n.gdp_year}` : "" };
    rep.context.push(inds.length > 1 ? t("Estos sectores producen {m} del PIB ({p}{year})", gv) : t("El sector produce {m} del PIB ({p}{year})", gv));
  }
  // Worker counts are ACS (where people live); the GDP figures are BEA (where the work is done): credit both.
  if (inds.some((k) => fin(n.gdp_by_industry?.[k])) && nation.gdp_vintage && nation.gdp_vintage !== rep.source) {
    rep.source = rep.source ? t("{src} (empleo); {gdp} (PIB)", { src: rep.source, gdp: nation.gdp_vintage }) : t("{gdp} (PIB)", { gdp: nation.gdp_vintage });
  }
  const rows = inds
    .map((k) => {
      const v = n.jobs?.[k];
      if (!fin(v)) return null;
      const { label, full } = industryLabel(nation, k);
      const s = ratio(v, n.employed);
      const g = n.gdp_by_industry?.[k];
      const sub = [s != null ? t("{p} del empleo", { p: pct(s) }) : "", fin(g) ? t("PIB {m}", { m: money(g) }) : ""].filter(Boolean).join(" · ");
      return { label, full, iconId: industryIcon(k), emoji: DISTRICT_ICON[k] || "•", value: v, text: compact(v), sub };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);
  if (rows.length) rep.breakdown = { title: t("Empleo por sector"), note: t("Ocupados, por su lugar de residencia."), groups: [{ rows }] };

  const y = (o) => o.yields?.[key];
  const lq = (o) => (nShare ? ratio(ratio(y(o), o.employed), nShare) : null);
  const shareSub = (o) => {
    const s = ratio(y(o), o.employed);
    return s != null ? t("{p} del empleo", { p: pct(s) }) : "";
  };
  const fmtLq = (v) => `×${v.toFixed(2).replace(".", ",")}`;
  const exactLq = (v) => `×${v.toFixed(3).replace(".", ",")}`;
  rep.boards.modes = [
    { id: "abs", label: t("Más empleo"), states: rank(st, y), metros: rank(metros, y) },
    {
      id: "rel", label: t("Especialización"),
      hint: t("Peso de {what} en el empleo del área ÷ el de Galicia ({p}); ciudades de {n}+ habitantes.", { what: def.label.toLowerCase(), p: pct(nShare), n: compact(METRO_MIN) }),
      states: rank(st, lq, { fmt: fmtLq, exact: exactLq, subOf: shareSub }), metros: rank(metros, lq, { fmt: fmtLq, exact: exactLq, subOf: shareSub, min: METRO_MIN }),
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// DOM

const defIcon = (def, size) => (def.yield ? glyph(def.yield, size) : icon(def.iconId, def.emoji, { size }));

function barsHtml(bd, expanded) {
  const all = bd.groups.flatMap((g) => g.rows);
  const max = Math.max(0, ...all.map((r) => Math.abs(r.value)));
  let shown = 0;
  const limit = bd.collapseAfter && !expanded ? bd.collapseAfter : Infinity;
  const groups = bd.groups
    .map((g) => {
      const rows = g.rows
        .filter(() => shown++ < limit)
        .map((r) => {
          const w = max > 0 ? (Math.abs(r.value) / max) * 100 : 0;
          const ic = r.iconId || r.emoji ? `<span class="yr-bic" aria-hidden="true">${icon(r.iconId, r.emoji, { size: 15 })}</span>` : "";
          const tip = [r.full || r.label, r.sub, r.text].filter(Boolean).join(" · ");
          return `<div class="yr-bar${r.strong ? " strong" : ""}${ic ? "" : " noic"}" title="${esc(tip)}">
            ${ic}<span class="yr-bl">${esc(r.label)}${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ""}</span>
            <span class="yr-bv${r.tone ? " " + r.tone : ""}">${esc(r.text)}</span>
            <span class="yr-track"><i class="${r.tone || ""}" style="width:${w.toFixed(1)}%"></i></span></div>`;
        })
        .join("");
      if (!rows) return "";
      return `${g.title ? `<h4>${esc(g.title)}</h4>` : ""}${rows}`;
    })
    .join("");
  const more = bd.collapseAfter && all.length > bd.collapseAfter
    ? `<button class="yr-more" data-more aria-expanded="${expanded}">${expanded ? t("Mostrar menos") : t("Mostrar las {n}", { n: all.length })}</button>` : "";
  return groups + more;
}

function boardHtml(rows) {
  if (!rows?.length) return `<p class="muted yr-empty">${t("Sin datos.")}</p>`;
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value)));
  return `<ol class="yr-list">${rows
    .map((r) => {
      const w = max > 0 ? (Math.abs(r.value) / max) * 100 : 0;
      const tip = `${t("Abrir {name}", { name: r.name })}${r.exact && r.exact !== r.text ? ` (${r.exact})` : ""}`;
      return `<li><button class="yr-row" data-kind="${r.kind}" data-ref="${esc(r.ref)}" title="${esc(tip)}">
        <span class="yr-rk">${r.rank}</span>
        <span class="yr-nm">${esc(r.name)}${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ""}</span>
        <span class="yr-v">${esc(r.text)}</span>
        <span class="yr-track"><i style="width:${w.toFixed(1)}%"></i></span></button></li>`;
    })
    .join("")}</ol>`;
}

/**
 * Wire the top-bar buttons (rendered by topbar.js with data-report="<key>") to the dropdown #yield-report.
 * opts: {nation, states, cities, lenses (array), lensVintage, onState(index), onCity(city), onLens(lensId)}
 */
export function initYieldReports(opts) {
  const bar = document.getElementById("yields");
  const pop = document.getElementById("yield-report");
  const none = { open() {}, close() {}, toggle() {}, get isOpen() { return false; }, build: () => null };
  if (!bar || !pop) return none;
  const data = { nation: opts.nation, states: opts.states, cities: opts.cities, lenses: opts.lenses, lensVintage: opts.lensVintage };
  const cityById = new Map((opts.cities || []).map((c) => [String(c.id), c]));
  const cache = new Map();
  const build = (key) => {
    if (!cache.has(key)) cache.set(key, buildReport(key, data));
    return cache.get(key);
  };
  let current = null; // {key, btn, rep}
  let tab = opts.states?.length ? "states" : "metros"; // remembered across reports
  let mode = "abs";
  let expanded = false;

  const buttons = () => [...bar.querySelectorAll("[data-report]")];
  const isMobile = () => matchMedia("(max-width: 700px)").matches;

  function position() {
    if (!current) return;
    const top = document.getElementById("topbar")?.getBoundingClientRect().bottom ?? 40;
    pop.style.top = Math.round(top) + (isMobile() ? 0 : 6) + "px";
    if (isMobile()) {
      pop.style.left = "";
      return;
    }
    const r = current.btn.getBoundingClientRect();
    const w = pop.offsetWidth || 440;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left - 14));
    pop.style.left = Math.round(left) + "px";
  }

  function render() {
    const { rep } = current;
    const def = rep.def;
    const modes = rep.boards.modes;
    if (!modes.some((m) => m.id === mode)) mode = modes[0]?.id || "abs";
    const m = modes.find((x) => x.id === mode);
    const hasStates = modes.some((x) => x.states.length), hasMetros = modes.some((x) => x.metros.length);
    if (tab === "states" && !hasStates && hasMetros) tab = "metros";
    pop.style.setProperty("--yc", def.color || "var(--gold-bright)");
    pop.innerHTML = `
      <div class="yr-head">
        <span class="yr-ic" style="color:${esc(def.color)}">${defIcon(def, 26)}</span>
        <div class="yr-titles"><div class="yr-kind">${t("Informe de Galicia")}</div><h2 id="yr-title">${esc(def.name)}</h2></div>
        <button class="icon-btn yr-close" aria-label="${esc(t("Cerrar el informe (Esc)"))}" title="${esc(t("Cerrar (Esc)"))}">${icon("close", "✕", { size: 12 })}</button>
      </div>
      <div class="yr-total"><b style="color:${esc(def.color)}">${esc(rep.totalText)}</b>
        ${rep.context.length ? `<ul class="yr-ctx">${rep.context.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}</div>
      ${rep.definition ? `<p class="yr-def">${esc(rep.definition)}</p>` : ""}
      ${rep.source ? `<div class="yr-src">${esc(t("Fuente: {src}", { src: rep.source }))}</div>` : ""}
      ${rep.breakdown ? `<section class="yr-sec"><h3>${esc(rep.breakdown.title)}</h3>
        ${rep.breakdown.note ? `<p class="yr-note">${esc(rep.breakdown.note)}</p>` : ""}
        <div class="yr-bars">${barsHtml(rep.breakdown, expanded)}</div></section>` : ""}
      ${modes.length ? `<section class="yr-sec"><h3>${t("Clasificaciones")}</h3>
        <div class="yr-controls">
          <div class="yr-tabs" role="tablist" aria-label="${esc(t("Áreas"))}">
            <button role="tab" id="yr-tab-states" data-tab="states" aria-controls="yr-board" aria-selected="${tab === "states"}" tabindex="${tab === "states" ? 0 : -1}" ${hasStates ? "" : "disabled"}>${t("Comarcas")}</button>
            <button role="tab" id="yr-tab-metros" data-tab="metros" aria-controls="yr-board" aria-selected="${tab === "metros"}" tabindex="${tab === "metros" ? 0 : -1}" ${hasMetros ? "" : "disabled"}>${t("Ciudades")}</button>
          </div>
          ${modes.length > 1 ? `<div class="yr-modes" role="group" aria-label="${esc(t("Clasificación"))}">${modes
            .map((x) => `<button data-mode="${x.id}" aria-pressed="${x.id === mode}">${esc(x.label)}</button>`).join("")}</div>` : ""}
        </div>
        <p class="yr-note yr-hint">${esc(hintText(m))}</p>
        <div id="yr-board" role="tabpanel" aria-labelledby="yr-tab-${tab}">${boardHtml(m?.[tab])}</div></section>` : ""}
      ${rep.lens ? `<div class="yr-foot"><p class="yr-note yr-lens-note">${t("Medida relacionada, no este total: {m}{v}.", { m: esc(rep.lens.unit || rep.lens.name), v: rep.lens.vintage ? ` (${esc(rep.lens.vintage)})` : "" })}</p>
        <button class="btn yr-lens" data-lens="${esc(rep.lens.id)}">${icon("layers", "🗺️", { size: 14 })}${t("Mapa relacionado: lente {name}", { name: esc(rep.lens.name) })}</button></div>` : ""}
      ${advisorButtons(rep.key)}`;
  }

  // "Open advisor" buttons (ext/advisors): a full dashboard on the report's subject.
  function advisorButtons(key) {
    const list = advisorApp() ? ADVISOR_FOR[key] || [] : [];
    if (!list.length) return "";
    return `<div class="yr-foot yr-adv">${list.map((a) => `<button class="btn yr-advisor" data-advisor="${esc(a.id)}"${a.industry ? ` data-industry="${esc(a.industry)}"` : ""}
      title="${esc(t("Abrir el asesor {name}: gráficos, tablas y mapa enlazados", { name: a.label.replace(/ \(.*\)$/, "") }))}">${icon("g-people", "👥", { size: 14 })}${t("Abrir asesor: {name}", { name: esc(a.label) })}</button>`).join("")}</div>`;
  }

  // The ranking's hint, plus (on the States tab) which states are ranked.
  function hintText(m) {
    const parts = [m?.hint || ""];
    if (tab === "states" && current.rep.boards.statesNote) parts.push(current.rep.boards.statesNote);
    return parts.filter(Boolean).join(" ");
  }

  // Re-render the leaderboard only (keeps focus on the control that changed it).
  function renderBoard() {
    const m = current.rep.boards.modes.find((x) => x.id === mode);
    pop.querySelectorAll("[data-tab]").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    pop.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    const hint = pop.querySelector(".yr-hint");
    if (hint) hint.textContent = hintText(m);
    const board = pop.querySelector("#yr-board");
    if (board) {
      board.setAttribute("aria-labelledby", `yr-tab-${tab}`);
      board.innerHTML = boardHtml(m?.[tab]);
    }
  }

  function open(key, btn) {
    const rep = build(key);
    if (!rep) return;
    if (current && current.btn !== btn) current.btn.setAttribute("aria-expanded", "false");
    if (!current || current.key !== key) {
      expanded = false;
      mode = "abs"; // each report opens on its main ranking; the States / Metros tab is remembered
    }
    current = { key, btn, rep };
    for (const b of buttons()) b.classList.toggle("open", b === btn);
    btn.setAttribute("aria-expanded", "true");
    pop.setAttribute("aria-labelledby", "yr-title");
    render();
    pop.hidden = false;
    pop.scrollTop = 0;
    position();
    // Keep the anchor visible when the bar has scrolled (narrow screens).
    btn.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    pop.focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (!current) return;
    const { btn } = current;
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("open");
    current = null;
    pop.hidden = true;
    pop.innerHTML = "";
    if (restoreFocus && document.contains(btn)) btn.focus();
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-report]");
    if (!btn) return;
    if (current?.btn === btn) close();
    else open(btn.dataset.report, btn);
  });

  pop.addEventListener("click", (e) => {
    const tg = e.target.closest("button");
    if (!tg || !current) return;
    if (tg.classList.contains("yr-close")) return close();
    if (tg.dataset.tab) {
      tab = tg.dataset.tab;
      return renderBoard();
    }
    if (tg.dataset.mode) {
      mode = tg.dataset.mode;
      return renderBoard();
    }
    if (tg.hasAttribute("data-more")) {
      expanded = !expanded;
      const bars = pop.querySelector(".yr-bars");
      if (bars) bars.innerHTML = barsHtml(current.rep.breakdown, expanded);
      pop.querySelector("[data-more]")?.focus();
      return;
    }
    if (tg.dataset.advisor) {
      const app = advisorApp();
      const params = { id: tg.dataset.advisor, ...(tg.dataset.industry ? { industry: tg.dataset.industry } : {}) };
      close(false);
      return app?.setMode("advisor", params);
    }
    if (tg.dataset.lens) {
      const id = tg.dataset.lens;
      close();
      return opts.onLens?.(id);
    }
    if (tg.dataset.kind === "state") {
      close(false);
      return opts.onState?.(Number(tg.dataset.ref));
    }
    if (tg.dataset.kind === "city") {
      const city = cityById.get(tg.dataset.ref);
      if (!city) return close();
      close(false);
      return opts.onCity?.(city);
    }
  });

  // The report is a non-modal popover that logically follows its stat button: Shift+Tab from its first control
  // goes back to the button, Tab past its last control closes it and moves on to whatever follows the button.
  const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  const visible = (el) => el.getClientRects().length > 0 && !el.closest("[hidden]");
  pop.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey || !current) return;
    const inside = [...pop.querySelectorAll(FOCUSABLE)].filter(visible);
    const first = inside[0], last = inside.at(-1);
    if (e.shiftKey && (e.target === pop || e.target === first)) {
      e.preventDefault();
      current.btn.focus();
    } else if (!e.shiftKey && (e.target === last || !inside.length)) {
      const all = [...document.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && !pop.contains(el));
      const next = all[all.indexOf(current.btn) + 1];
      e.preventDefault();
      close(!next);
      next?.focus();
    }
  });
  // From the button, Tab goes into the open report rather than to the next stat.
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || !current || e.target !== current.btn) return;
    const first = [...pop.querySelectorAll(FOCUSABLE)].find(visible);
    if (!first) return;
    e.preventDefault();
    first.focus();
  });
  // Focus moving anywhere else (search via "/" or Cmd+K, the share button, Tab elsewhere) closes the report, so
  // only one popover is ever open.
  document.addEventListener("focusin", (e) => {
    if (current && !pop.contains(e.target) && e.target !== current.btn) close(false);
  });

  // Tabs: arrow keys move between them (WAI-ARIA tabs pattern).
  pop.addEventListener("keydown", (e) => {
    const tt = e.target.closest?.("[role=tab]");
    if (!tt || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = [...pop.querySelectorAll("[role=tab]:not([disabled])")];
    let i = tabs.indexOf(tt);
    if (i < 0 || tabs.length < 2) return;
    i = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tab = tabs[i].dataset.tab;
    renderBoard();
    tabs[i].focus();
  });

  document.addEventListener("pointerdown", (e) => {
    if (current && !pop.contains(e.target) && !e.target.closest?.("[data-report]")) close(false);
  });
  window.addEventListener("resize", position);
  bar.addEventListener("scroll", position, { passive: true });
  document.getElementById("topbar")?.addEventListener("scroll", position, { passive: true });

  return {
    open(key) {
      const btn = buttons().find((b) => b.dataset.report === key);
      if (btn) open(key, btn);
    },
    close,
    toggle(key) {
      if (current?.key === key) close();
      else this.open(key);
    },
    build,
    get isOpen() { return !!current; },
    get key() { return current?.key ?? null; },
  };
}
