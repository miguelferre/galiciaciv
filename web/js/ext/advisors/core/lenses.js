// Map colourings the advisors add beside the built-in lenses (lenses.json has no science-branch lens).
// Each is an ordinary lens object ({id, name, ramp, domain, scale, format, values: per cell}) that app.setLens()
// accepts; they are built once per data model and cached, so the lens dock's histogram cache stays valid.
import { fin, quantile, ratio, RAMPS } from "./util.js";
import { fpPlacesLens } from "./fp.js";
import { caminoLens } from "./camino.js"; // camino.js imports countyLens from here: a cycle, safe because both only call at run time

const SCIENCE_RAMP = ["#0a1a33", "#173a6b", "#2f63a8", "#4f93d6", "#8cc2ee", "#e4f3ff"];

const cache = new WeakMap();

function memo(data, key, make) {
  let m = cache.get(data);
  if (!m) cache.set(data, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}

const robust = (vals, q = 0.02) => {
  const s = vals.filter(fin).sort((a, b) => a - b);
  return s.length ? [quantile(s, q), quantile(s, 1 - q)] : [0, 1];
};

/** Science-branch affiliates as a share of all affiliates, per ciudad (other hexes grey). */
export function scienceLens(data) {
  return memo(data, "science", () => {
    const { app, cellMetro } = data;
    const n = app.w.grid.size, owner = app.w.raw.owner;
    const values = new Array(n).fill(null);
    const share = (c) => (fin(c.yields?.science) && c.employed > 0 ? c.yields.science / c.employed : null);
    for (const [cell, city] of cellMetro) if (owner[cell] >= 0) values[cell] = share(city);
    return {
      id: "adv-science-share", group: "work", name: "Peso de la rama de ciencia",
      icon: "l-degrees", emoji: "🔬", unit: "de las personas afiliadas", format: "pct", scale: "linear",
      domain: robust(data.levels.metros.rows.map((r) => share(r.ref))), ramp: SCIENCE_RAMP, higher_is: "neutral", source: "ige_ramas",
      description: "Estimación de las personas afiliadas en la rama de información, actividades financieras, inmobiliarias y profesionales, entre todas las afiliadas que viven en la ciudad (IGE). Las casillas en gris quedan fuera de las ciudades.",
      values,
    };
  });
}

/**
 * A concello column as a map lens (each hex takes the value of the concello it belongs to). For columns that have
 * no lens in lenses.json (e.g. establishments). opts: {name, ramp, format, unit, description, source,
 * emoji, icon, group, domain?}
 */
export function countyLens(data, key, opts = {}) {
  return memo(data, `county-${key}`, () => {
    const lv = data.levels.counties;
    const n = data.app.w.grid.size;
    const values = new Array(n).fill(null);
    if (lv) for (let i = 0; i < n; i++) { const r = lv.rowAtCell(i); const v = r ? r.v[key] : null; if (fin(v)) values[i] = v; }
    const f = lv?.field(key);
    return {
      id: `adv-county-${key}`, group: opts.group || "people", name: opts.name || f?.label || key,
      icon: opts.icon || "layers", emoji: opts.emoji || "🗺️", unit: opts.unit || f?.unit || "", format: opts.format || f?.format || "float",
      scale: "linear", domain: opts.domain || robust(lv ? lv.rows.map((r) => r.v[key]) : []), ramp: opts.ramp || SCIENCE_RAMP,
      higher_is: f?.higher_is || "neutral", source: opts.source || f?.source || "", description: opts.description || f?.description || "",
      ...(opts.note ? { note: opts.note } : {}),
      values,
    };
  });
}

/** A per-comarca value as a map lens. valueOf(fips, row) → number | null. opts as countyLens plus id. */
export function stateLens(data, id, valueOf, opts = {}) {
  return memo(data, `state-${id}`, () => {
    const app = data.app;
    const n = app.w.grid.size, owner = app.w.raw.owner;
    const rows = data.levels.states.rows;
    const byIdx = [];
    for (const r of rows) byIdx[r.ref] = valueOf(r.key, r);
    const values = new Array(n).fill(null);
    for (let i = 0; i < n; i++) if (owner[i] >= 0 && fin(byIdx[owner[i]])) values[i] = byIdx[owner[i]];
    return {
      id: `adv-state-${id}`, group: opts.group || "people", name: opts.name || id, icon: opts.icon || "layers", emoji: opts.emoji || "🗺️",
      unit: opts.unit || "", format: opts.format || "float", scale: "linear", domain: opts.domain || robust(byIdx, 0),
      ramp: opts.ramp || SCIENCE_RAMP, higher_is: opts.higher_is || "neutral", source: opts.source || "", description: opts.description || "",
      ...(opts.note ? { note: opts.note } : {}),
      values,
    };
  });
}

/** Population change per concello, red (loses) to teal (gains), centred on zero. */
export function growthLens(data) {
  const vals = data.levels.counties.rows.map((r) => r.v.growth).filter(fin).map(Math.abs).sort((a, b) => a - b);
  const m = vals.length ? Math.max(vals[Math.floor(vals.length * 0.98)] || 0.01, 0.01) : 0.1;
  return countyLens(data, "growth", {
    name: "Variación de la población", ramp: RAMPS.div, format: "pct", domain: [-m, m], emoji: "📉",
    unit: "variación 2021-2025", icon: "pop",
  });
}

export const CULTURE_BRANCH = "AAPP, Educación, Sanidade e outros servizos";
const CULTURE_RAMP = ["#221030", "#43215c", "#6a3790", "#9556c0", "#bd8be0", "#efe0fa"];
export const cultureShare = (r) => ratio(r.v.y_culture, r.v.affiliates);

/** Culture-branch affiliates as a share of all affiliates, per comarca. */
export function cultureLens(data) {
  return stateLens(data, "culture-branch", (_, r) => cultureShare(r), {
    group: "work", name: "Peso de la rama Cultura", unit: "de las personas afiliadas", format: "pct", source: "ige_ramas", ramp: CULTURE_RAMP,
    description: `Estimación de las personas afiliadas en la rama «${CULTURE_BRANCH}» entre todas las afiliadas que viven en la comarca (IGE). No son trabajadores de la cultura.`,
  });
}

const FIRE_RAMP = ["#1a1410", "#4a2412", "#8a3414", "#c8501a", "#f08a2a", "#ffd76a"];

/** Share of each Galician land hex burned in one year (fires.json: years, cells = [[cell, share]] per year). Fixed 0 to 100 %
 *  domain so the years can be compared. Outside Galicia the hex stays grey. */
export function fireYearLens(data, fires, year) {
  const k = fires?.years?.indexOf(year);
  if (!(k >= 0)) return null;
  return memo(data, `fire-${year}`, () => {
    const n = data.app.w.grid.size, owner = data.app.w.raw.owner;
    const values = new Array(n).fill(null);
    for (let i = 0; i < n; i++) if (owner[i] >= 0) values[i] = 0;
    for (const [cell, share] of fires.cells[k]) if (owner[cell] >= 0) values[cell] = share;
    return {
      id: `adv-fire-${year}`, group: "risks", name: `Quemado en ${year}`, icon: "l-fire", emoji: "🔥",
      unit: `parte de la casilla quemada en ${year}`, format: "pct", scale: "linear", domain: [0, 1], ramp: FIRE_RAMP,
      higher_is: "bad", source: "effis",
      description: `Parte de la superficie de la casilla dentro de un perímetro quemado en ${year} (EFFIS, Copernicus). EFFIS detecta con fiabilidad los incendios desde unas 30 ha: los pequeños no salen. Las casillas de tierra sin incendio valen 0.`,
      values,
    };
  });
}

/** The advisor lens with this id (for a shared link such as #lens=adv-county-growth), or null. A fire-year lens comes
 *  back as a promise: it waits for fires.json. */
export function lensFromId(data, id) {
  const fy = /^adv-fire-(\d{4})$/.exec(id);
  if (fy) return data.app.loadData("fires").then((fires) => (fires ? fireYearLens(data, fires, Number(fy[1])) : null)).catch(() => null);
  if (id === "adv-state-fp-places") return data.app.loadData("fp").then((fp) => (fp ? fpPlacesLens(data, fp) : null)).catch(() => null);
  if (id === "adv-science-share") return scienceLens(data);
  if (id === "adv-state-culture-branch") return cultureLens(data);
  if (id === "adv-county-camino_km") return caminoLens(data);
  if (id === "adv-county-growth") return data.levels.counties?.field("growth") ? growthLens(data) : null;
  return null;
}
