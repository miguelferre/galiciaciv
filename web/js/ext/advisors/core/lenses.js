// Map colourings the advisors add beside the built-in lenses (lenses.json has no science-branch lens).
// Each is an ordinary lens object ({id, name, ramp, domain, scale, format, values: per cell}) that app.setLens()
// accepts; they are built once per data model and cached, so the lens dock's histogram cache stays valid.
import { fin, quantile } from "./util.js";

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
