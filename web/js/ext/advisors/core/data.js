// The advisors' data model: three "levels" (comarcas, ciudades, concellos) of rows with typed fields, plus the links
// between rows and the hex map (row → highlight, cell → row). Built once from app.data (counties.json optional).
// The level ids keep their original names: states = comarcas (53), metros = ciudades (56 concellos of 10,000
// inhabitants or more), counties = concellos (313). The same measure has the same key on every level.
//
//   level = {id, label, noun, rows: [row], fields: [field], field(key), value(row, key),
//            highlight(rows, opts) → app.state.highlight, rowAtCell(cell) → row | null, focus(row), byKey: Map}
//   row   = {key, name, sub, level, ref, v: {fieldKey: value}}
//   field = {key, label, format, unit, higher_is, source, description, lens?, group, derived?}
import { fin, ratio } from "./util.js";
import { frameBox } from "./frame.js";
import { isMoneyUnit } from "../../../format.js";
import { stateIndex } from "../../../world.js";
import { REF_KM } from "../../../render/art/lod.js";

// Land cover classes of states.json `land` (concellos and ciudades only carry forest, crop, pasture and developed).
export const LAND_KEYS = ["forest", "crop", "pasture", "shrub", "wetland", "developed"];
export const LAND_LABEL = {
  forest: "Bosque", crop: "Cultivo", pasture: "Pasto", shrub: "Matorral", wetland: "Humedal", developed: "Suelo urbanizado",
};
export const LAND_COLOR = {
  forest: "#3f7a3a", crop: "#d2c457", pasture: "#93b852", shrub: "#c9a874", wetland: "#4f9a86", developed: "#9a8f9e",
};

const GROUPS = {
  "Nombre": ["name", "state", "province", "city"],
  "Población": ["population", "density", "edad_media", "nacidos_fuera"],
  "Economía": ["gdp", "gdp_pc"],
  "Trabajo": ["affiliates", "agro", "industria", "construccion", "servicios", "agro_share", "industry_share", "y_food", "y_production", "y_science", "y_culture"],
  "Prosperidad": ["renta_pc", "unemployment", "gini", "p80p20"],
  "Conocimiento": ["estudios_superiores"],
  "Clima": ["temp", "precip", "viento", "sol", "humedad"],
  "Territorio": ["land_km2", "forest", "crop", "pasture", "farmland", "shrub", "wetland", "developed", "elevation"],
  "Riesgos": ["incendios", "inundacion"],
  "Energía y recursos": ["turbines", "quarries", "lonja_eur"],
};
const GROUP_OF = new Map(Object.entries(GROUPS).flatMap(([g, keys]) => keys.map((k) => [k, g])));
const groupOf = (k) => GROUP_OF.get(k) || "Otros";

// Column key → lens id (lenses.json), where a lens shows the same measure. The unemployment lens counts per 100
// inhabitants (the column is a fraction), so use the lens as it is and never borrow its domain. Crop and pasture only
// have a joint lens (farmland).
const LENS_OF = Object.fromEntries([
  "density", "gdp_pc", "unemployment", "agro_share", "industry_share", "renta_pc", "gini", "p80p20", "edad_media",
  "nacidos_fuera", "estudios_superiores", "temp", "precip", "viento", "sol", "humedad", "incendios", "inundacion",
  "forest", "farmland", "developed", "elevation",
].map((k) => [k, k]));

// What states.json and cities.json give on their own, for the case where counties.json did not load.
const FALLBACK = {
  population: { label: "Población", format: "int", unit: "habitantes", source: "ine_padron" },
  gdp: { label: "PIB", format: "eur", unit: "euros", higher_is: "good", source: "ige_pib" },
  gdp_pc: { label: "PIB por habitante", format: "eur", unit: "euros por habitante", higher_is: "good", source: "ige_pib" },
  affiliates: { label: "Afiliados", format: "int", unit: "personas", source: "ige_afiliacion" },
  agro: { label: "Afiliados en agricultura y pesca", format: "int", unit: "personas", source: "ige_afiliacion" },
  industria: { label: "Afiliados en industria", format: "int", unit: "personas", source: "ige_afiliacion" },
  construccion: { label: "Afiliados en construcción", format: "int", unit: "personas", source: "ige_afiliacion" },
  servicios: { label: "Afiliados en servicios", format: "int", unit: "personas", source: "ige_afiliacion" },
  unemployment: { label: "Paro registrado", format: "pct", unit: "parados por habitante", higher_is: "bad", source: "ige_paro" },
  renta_pc: { label: "Renta neta por persona", format: "eur", unit: "euros por persona", higher_is: "good", source: "ine_adrh" },
};

// Columns this model adds beside counties.json.
const EXTRA = {
  farmland: { label: "Cultivo y pasto", format: "pct", unit: "parte de la superficie", source: "worldcover", description: "Cultivo más pasto (ESA WorldCover 2021)." },
  shrub: { label: "Matorral", format: "pct", unit: "parte de la superficie", source: "worldcover", description: "Parte de la superficie de la comarca cubierta por matorral (ESA WorldCover 2021, media de sus casillas)." },
  wetland: { label: "Humedal", format: "pct", unit: "parte de la superficie", source: "worldcover", description: "Parte de la superficie de la comarca que es humedal (ESA WorldCover 2021, media de sus casillas)." },
  incendios: { label: "Superficie quemada ≈", format: "pct", unit: "parte de la superficie, 2016 a 2025", higher_is: "bad", source: "effis", description: "Media, sobre las casillas del territorio, de la parte de cada casilla dentro de al menos un perímetro quemado entre 2016 y 2025 (EFFIS). La mayoría de los incendios pequeños no salen." },
  inundacion: { label: "Zona inundable ≈", format: "pct", unit: "parte de la superficie, T=100", higher_is: "bad", source: "snczi", description: "Media, sobre las casillas del territorio, de la parte de cada casilla dentro de la lámina de inundación de 100 años de retorno (SNCZI). Solo hay lámina en los tramos estudiados." },
  elevation: { label: "Altitud media ≈", format: "int", unit: "metros sobre el nivel del mar", source: "mdt_ign", description: "Media de la altitud de las casillas del territorio (MDT del IGN)." },
  turbines: { label: "Aerogeneradores en el mapa", format: "int", unit: "aerogeneradores", source: "xunta_eolica", description: "Suma de los aerogeneradores de las casillas con recurso eólico en el mapa (2 o más por casilla). La capa junta parques en funcionamiento, autorizados y en obras." },
  quarries: { label: "Canteras en el mapa", format: "int", unit: "explotaciones", source: "igme_bdmin", description: "Explotaciones de rocas y minerales marcadas como activas en la base BDMIN del IGME (servicio de 2015), sumadas sobre el mapa." },
  lonja_eur: { label: "Venta en lonja", format: "eur", unit: "euros en el año", source: "pesca_lonxas", description: "Primera venta de pesca fresca en las lonjas del territorio (Pesca de Galicia, 2025). Cero: no hay lonja en el mapa." },
};
const CELL_KEYS = ["incendios", "inundacion", "elevation"];
const RESOURCE_KEYS = ["turbines", "quarries", "lonja_eur"];
const CLIMATE_KEYS = ["temp", "precip", "viento", "sol", "humedad"];
const SECTOR_OF = { agro: "agricultura", industria: "industria", construccion: "construccion", servicios: "servicios" };
const YIELD_SOURCE = { food: "ige_afiliacion", production: "ige_afiliacion", science: "ige_ramas", culture: "ige_ramas" };

// How the comarca columns that are not read straight from the concello table are built.
const COMARCA_NOTE = {
  population: "Habitantes de la comarca (padrón del INE a 1 de enero de 2025).",
  land_km2: "Suma de la superficie de sus concellos.",
  density: "Población de la comarca entre la suma de la superficie de sus concellos.",
  gdp: "Suma del PIB de 2023 que el IGE estima para cada concello de la comarca.",
  gdp_pc: "PIB de 2023 de la comarca entre su población de 2025.",
  affiliates: "Afiliaciones a la Seguridad Social de quienes viven en la comarca (IGE, septiembre de 2026).",
  agro: "Suma de sus concellos. No incluye los datos que el IGE oculta.",
  industria: "Suma de sus concellos. No incluye los datos que el IGE oculta.",
  construccion: "Suma de sus concellos. No incluye los datos que el IGE oculta.",
  servicios: "Suma de sus concellos. No incluye los datos que el IGE oculta.",
  agro_share: "Afiliados en agricultura y pesca entre todos los afiliados, en los concellos con dato.",
  industry_share: "Afiliados en industria entre todos los afiliados, en los concellos con dato.",
  unemployment: "Parados registrados en octubre de 2026 entre la población de 2025. No es la tasa de paro.",
  renta_pc: "Media de la renta neta por persona de sus concellos (INE, 2024), ponderada por población. Es una aproximación.",
  edad_media: "Edad media de sus concellos ponderada por población (IGE, padrón de 2025).",
  nacidos_fuera: "Personas nacidas fuera de Galicia entre toda la población (IGE, padrón de 2025).",
  forest: "Parte de la superficie de la comarca cubierta por bosque (ESA WorldCover 2021, media de sus casillas).",
  crop: "Parte de la superficie de la comarca en cultivos (ESA WorldCover 2021, media de sus casillas).",
  pasture: "Parte de la superficie de la comarca en pasto o prado (ESA WorldCover 2021, media de sus casillas).",
  developed: "Parte de la superficie de la comarca con edificios y calles (ESA WorldCover 2021, media de sus casillas).",
};

const makeField = (key, label, format, o = {}) => ({
  key, label, format, unit: o.unit || null, higher_is: o.higher_is || "neutral", source: o.source || "",
  description: o.description || "", lens: o.lens || null, group: o.group || "Otros", derived: !!o.derived,
});

const total = (rows, k) => {
  let a = 0, n = 0;
  for (const r of rows) if (fin(r.v[k])) { a += r.v[k]; n++; }
  return n ? a : null;
};
const popMean = (rows, k) => {
  let a = 0, w = 0;
  for (const r of rows) if (fin(r.v[k]) && fin(r.v.population)) { a += r.v[k] * r.v.population; w += r.v.population; }
  return w > 0 ? a / w : null;
};
// Σ part ÷ Σ affiliates, over the concellos where the part is published.
const shareOfAffiliates = (rows, k) => {
  let a = 0, b = 0;
  for (const r of rows) if (fin(r.v[k]) && fin(r.v.affiliates)) { a += r.v[k]; b += r.v.affiliates; }
  return b > 0 ? a / b : null;
};
const farm = (v) => (fin(v.crop) && fin(v.pasture) ? Math.min(1, v.crop + v.pasture) : null);

export function buildData(app) {
  // On a phone the quick panel is a bottom sheet over the advisor: select on the map, then put the panel away.
  const pick = (select) => { select(); if (app.isMobile?.()) app.panels.close(); };
  const { cities = [], states = [], nation = {}, counties, resources, sources = [] } = app.data;
  const w = app.w;
  const grid = w.grid;
  const owner = w.raw.owner;
  const countyOf = w.raw.county || [];
  const n = grid.size;

  // --- cell indexes ---------------------------------------------------------------------------------------------
  const stateCells = new Map();
  const countyCells = new Map();
  const landCells = [];
  for (let i = 0; i < n; i++) {
    const o = owner[i];
    if (!(o >= 0)) continue;
    landCells.push(i);
    if (!stateCells.has(o)) stateCells.set(o, []);
    stateCells.get(o).push(i);
    const c = countyOf[i];
    if (c >= 0) {
      if (!countyCells.has(c)) countyCells.set(c, []);
      countyCells.get(c).push(i);
    }
  }
  // cell → city: footprints, smaller cities first so a bigger city wins; then every city's own cell.
  const cellMetro = new Map();
  for (let k = cities.length - 1; k >= 0; k--) for (const cell of cities[k].footprint || []) cellMetro.set(cell, cities[k]);
  for (const c of cities) if (c.cell != null) cellMetro.set(c.cell, c);

  const srcTitle = new Map(sources.map((s) => [s.id, s]));
  const nat = nation.nation || {};
  const vintage = nation.vintage || "";
  const countyVintage = counties?.vintage || "";
  const stateList = Array.isArray(states) ? states : [];
  const comarcaByFips = new Map(stateList.map((s) => [s.fips, s]));
  const comarcaName = (fips) => comarcaByFips.get(fips)?.name || null;

  // The mean of a lens's per-cell values over some cells (null when none has a value).
  const cellMean = (cells, lensId) => {
    const values = app.lensById?.get(lensId)?.values;
    if (!values || !cells) return null;
    let a = 0, k = 0;
    for (const i of cells) if (fin(values[i])) { a += values[i]; k++; }
    return k ? a / k : null;
  };

  // --- resources on the map -------------------------------------------------------------------------------------
  const items = resources?.items || [];
  const typeById = new Map((resources?.types || []).map((t) => [t.id, t]));
  const resourceKey = (it) => (it.type === "eolico" ? "turbines" : it.type === "lonja" ? "lonja_eur" : typeById.get(it.type)?.category === "mineral" ? "quarries" : null);
  const resourcesBy = (placeOf) => {
    const m = new Map();
    for (const it of items) {
      const key = resourceKey(it), place = placeOf(it);
      if (!key || place == null || !fin(it.value)) continue;
      if (!m.has(place)) m.set(place, { turbines: 0, quarries: 0, lonja_eur: 0 });
      m.get(place)[key] += it.value;
    }
    return (place) => (resources ? m.get(place) || { turbines: 0, quarries: 0, lonja_eur: 0 } : {});
  };
  const resState = resourcesBy((it) => it.state);
  const resCity = resourcesBy((it) => it.cbsa);
  const resAll = resourcesBy(() => "all");

  // --- yields (the ones counted in people; money is the GDP column) ---------------------------------------------
  const yields = (nation.yields || []).filter((y) => !isMoneyUnit(y.unit));
  const yieldValues = (o) => Object.fromEntries(yields.map((y) => [`y_${y.key}`, o.yields?.[y.key] ?? null]));

  // What states.json, cities.json and nation.json share.
  const placeValues = (o) => ({
    population: o.population ?? null,
    gdp: o.gdp ?? null,
    gdp_pc: ratio(o.gdp, o.population),
    affiliates: o.employed ?? null,
    ...Object.fromEntries(Object.entries(SECTOR_OF).map(([k, s]) => [k, o.jobs?.[s] ?? null])),
    unemployment: o.unemployment ?? null,
    renta_pc: o.median_income ?? null,
    ...yieldValues(o),
  });

  // --- concello rows (the base of the other two levels) ---------------------------------------------------------
  const countyRows = [];
  if (counties) {
    const cols = counties.columns;
    // counties.json rows follow world.json counties; map by geoid anyway in case they ever diverge.
    const worldIdx = new Map((w.raw.counties || []).map((c, k) => [c.geoid, k]));
    counties.rows.forEach((r, i) => {
      const v = {};
      cols.forEach((k, j) => (v[k] = r[j]));
      const ref = worldIdx.get(v.geoid) ?? i;
      v.city_id = v.city || null;
      v.city = v.city_id ? "Sí" : "No";
      v.farmland = farm(v);
      for (const k of CELL_KEYS) v[k] = cellMean(countyCells.get(ref), k);
      countyRows.push({ key: v.geoid, name: v.name, full: v.name, sub: v.state, level: "counties", ref, v });
    });
  }
  const countyById = new Map(countyRows.map((r) => [r.key, r]));
  const countiesOfState = new Map();
  for (const r of countyRows) {
    if (!countiesOfState.has(r.v.state)) countiesOfState.set(r.v.state, []);
    countiesOfState.get(r.v.state).push(r);
  }

  // --- fields ---------------------------------------------------------------------------------------------------
  const columnDef = new Map((counties?.fields || []).map((f) => [f.key, f]));
  const field = (key, over = {}) => {
    const y = key.startsWith("y_") ? yields.find((x) => `y_${x.key}` === key) : null;
    const d = y
      ? { label: `${y.label} (afiliados${y.branches ? ", estimación" : ""})`, format: "int", unit: "personas", source: YIELD_SOURCE[y.key], description: y.description }
      : columnDef.get(key) || EXTRA[key] || FALLBACK[key];
    if (!d) return null;
    const lens = LENS_OF[key];
    return makeField(key, over.label || d.label, d.format, {
      unit: d.unit, higher_is: d.higher_is, source: d.source, description: over.description || d.description,
      lens: lens && app.lensById?.has(lens) ? lens : null, group: groupOf(key), derived: over.derived ?? !columnDef.has(key),
    });
  };
  const columnKeys = counties ? counties.fields.map((f) => f.key).filter((k) => !["geoid", "name", "state", "province", "city", "cell"].includes(k)) : Object.keys(FALLBACK);
  const yieldKeys = yields.map((y) => `y_${y.key}`);
  const nameField = (label) => makeField("name", label, "text", { group: "Nombre" });
  const textField = (key, label, description, source = "") => makeField(key, label, "text", { group: "Nombre", description, source });
  const stateField = textField("state", "Comarca", "Comarca del concello (IGE, tabla 2246).", "ige_comarcas");
  const provinceField = textField("province", "Provincia", "Provincia.", "ige_comarcas");

  // --- comarcas -------------------------------------------------------------------------------------------------
  const stateRows = [];
  for (const s of stateList) {
    const ref = stateIndex(w, s.fips);
    if (ref < 0) continue;
    const members = countiesOfState.get(s.name) || [];
    const cells = stateCells.get(ref);
    const land = total(members, "land_km2");
    const v = {
      name: s.name, abbr: s.abbr, province: s.province, ...placeValues(s),
      land_km2: land, density: ratio(s.population, land),
      agro_share: shareOfAffiliates(members, "agro"), industry_share: shareOfAffiliates(members, "industria"),
      edad_media: popMean(members, "edad_media"), nacidos_fuera: popMean(members, "nacidos_fuera"),
      ...Object.fromEntries(LAND_KEYS.map((k) => [k, s.land?.[k] ?? null])),
      ...Object.fromEntries([...CLIMATE_KEYS, ...CELL_KEYS].map((k) => [k, cellMean(cells, k)])),
      ...resState(s.abbr),
    };
    v.farmland = farm(v);
    stateRows[ref] = { key: s.fips, name: s.name, sub: s.province, level: "states", ref, v };
  }
  const comarcaRows = stateRows.filter(Boolean);
  const comarcaField = (k) => {
    if (!comarcaRows.some((r) => r.v[k] != null)) return null;
    const climate = CLIMATE_KEYS.includes(k);
    const def = columnDef.get(k) || EXTRA[k] || FALLBACK[k];
    const approx = (climate || k === "renta_pc") && def && !def.label.endsWith("≈");
    return field(k, {
      label: approx ? `${def.label} ≈` : null, derived: true,
      description: climate ? `Media sobre las casillas de la comarca de los valores interpolados desde las estaciones de MeteoGalicia (2025).` : COMARCA_NOTE[k],
    });
  };
  // Gini, P80/P20 and higher education cannot be added up from concellos with what the table holds.
  const comarcaKeys = [...new Set([...columnKeys.filter((k) => !["gini", "p80p20", "estudios_superiores"].includes(k)), "shrub", "wetland", "farmland", ...CELL_KEYS, ...yieldKeys, ...RESOURCE_KEYS])];
  const states_ = makeLevel({
    id: "states", label: "Comarcas", noun: "comarca",
    rows: comarcaRows,
    fields: [nameField("Comarca"), provinceField, ...comarcaKeys.map(comarcaField)].filter(Boolean),
    highlight: (rows) => ({ states: new Set(rows.map((r) => r.ref)) }),
    rowAtCell: (cell) => (owner[cell] >= 0 ? stateRows[owner[cell]] || null : null),
    focus: (row) => pick(() => app.selectState(row.ref, { fly: true })),
    cellsOf: (row) => stateCells.get(row.ref) || [],
  });

  // --- ciudades (each one is a whole concello, with the same code) ----------------------------------------------
  const metroRows = cities.map((c) => {
    const own = countyById.get(c.id)?.v;
    const base = placeValues(c);
    const names = (c.states || []).map(comarcaName).filter(Boolean).join(", ");
    const v = { ...base, ...(own || {}), ...yieldValues(c), ...resCity(c.id), name: c.name, state: own?.state || names, province: own?.province ?? null };
    delete v.city;
    delete v.city_id;
    // A city named after its comarca (Vigo, Lugo…) carries no suffix, so views do not print the name twice.
    return { key: c.id, name: c.name, full: c.name, sub: v.state === c.name ? "" : v.state, level: "metros", ref: c, v };
  });
  const metroByCity = new Map(metroRows.map((r) => [r.ref, r]));
  const cityKeys = [...new Set([...columnKeys, "farmland", ...CELL_KEYS, ...yieldKeys, ...RESOURCE_KEYS])];
  const metros = makeLevel({
    id: "metros", label: "Ciudades", noun: "ciudad",
    rows: metroRows,
    fields: [nameField("Ciudad"), stateField, provinceField, ...cityKeys.filter((k) => metroRows.some((r) => r.v[k] != null)).map((k) => field(k))].filter(Boolean),
    highlight: (rows, o = {}) => {
      const cells = new Set();
      for (const r of rows) for (const c of r.ref.footprint || [r.ref.cell]) cells.add(c);
      return { cells, cities: rows.length <= (o.ringMax ?? 30) ? new Set(rows.map((r) => r.key)) : undefined };
    },
    rowAtCell: (cell) => { const c = cellMetro.get(cell); return c ? metroByCity.get(c) : null; },
    focus: (row) => pick(() => app.selectCity(row.ref, { fly: true })),
    cellsOf: (row) => row.ref.footprint || [row.ref.cell],
  });

  // --- concellos ------------------------------------------------------------------------------------------------
  let counties_ = null;
  if (counties) {
    const rowByWorld = new Map(countyRows.map((r) => [r.ref, r]));
    // Concellos smaller than a hex own no cell: counties.json `cell` (the hex nearest the centre) stands in.
    const cellsOfRow = (r) => countyCells.get(r.ref) || (Number.isInteger(r.v.cell) ? [r.v.cell] : []);
    const countyKeys = [...columnKeys, "farmland", ...CELL_KEYS];
    counties_ = makeLevel({
      id: "counties", label: "Concellos", noun: "concello",
      rows: countyRows,
      fields: [
        nameField("Concello"), stateField, provinceField,
        textField("city", "Ciudad", "Sí cuando el concello tiene 10 000 habitantes o más y sale en el mapa como ciudad.", "ine_padron"),
        ...countyKeys.map((k) => field(k)),
      ].filter(Boolean),
      highlight: (rows) => {
        const cells = new Set();
        for (const r of rows) for (const c of cellsOfRow(r)) cells.add(c);
        return { cells };
      },
      rowAtCell: (cell) => (countyOf[cell] >= 0 ? rowByWorld.get(countyOf[cell]) || null : null),
      focus: (row) => {
        const cells = cellsOfRow(row);
        if (!cells.length) {
          const comarca = comarcaRows.find((r) => r.name === row.v.state);
          return comarca ? pick(() => app.selectState(comarca.ref, { fly: true })) : null;
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of cells) {
          const x = grid.cx(c), y = grid.cy(c);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        const pad = 2.4 * REF_KM; // km of surroundings
        frameBox(app, { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }, { pad: 24 });
      },
      cellsOf: (row) => cellsOfRow(row),
    });
  }

  // --- Galicia as a whole, with the same keys as the rows -------------------------------------------------------
  const galiciaLand = total(countyRows, "land_km2");
  const galicia = {
    name: nation.name || "Galicia", ...placeValues(nat),
    land_km2: galiciaLand, density: ratio(nat.population, galiciaLand),
    agro_share: shareOfAffiliates(countyRows, "agro"), industry_share: shareOfAffiliates(countyRows, "industria"),
    edad_media: popMean(countyRows, "edad_media"), nacidos_fuera: popMean(countyRows, "nacidos_fuera"),
    // land cover: the mean of the comarcas weighted by their cells
    ...Object.fromEntries(LAND_KEYS.map((k) => {
      let a = 0, c = 0;
      for (const r of comarcaRows) {
        const m = stateCells.get(r.ref)?.length || 0;
        if (fin(r.v[k])) { a += r.v[k] * m; c += m; }
      }
      return [k, c ? a / c : null];
    })),
    ...Object.fromEntries([...CLIMATE_KEYS, ...CELL_KEYS].map((k) => [k, cellMean(landCells, k)])),
    ...resAll("all"),
  };
  galicia.farmland = farm(galicia);

  const countiesOffMap = counties_ ? counties_.rows.filter((r) => !counties_.cellsOf(r).length).length : 0; // no hex, not even a stand-in
  return {
    app, nation, nat, galicia, vintage, countyVintage, countiesOffMap,
    levels: { states: states_, metros, counties: counties_ },
    stateCells, countyCells, landCells, cellMetro, metroByCity,
    stateByFips: states_.byKey,
    stateByAbbr: new Map(comarcaRows.map((r) => [r.v.abbr, r])),
    stateByName: new Map(comarcaRows.map((r) => [r.name, r])),
    items, typeById,
    source: (id) => srcTitle.get(id) || null,
  };
}

function makeLevel(def) {
  const fieldByKey = new Map(def.fields.map((f) => [f.key, f]));
  const byKey = new Map(def.rows.map((r) => [r.key, r]));
  return {
    ...def,
    byKey,
    field: (k) => fieldByKey.get(k) || null,
    value: (row, k) => row.v[k] ?? null,
    numericFields: () => def.fields.filter((f) => f.format !== "text"),
    /** Add fields after the fact (optional files that load on demand); a key already present is skipped. */
    addFields(list) {
      for (const f of list) {
        if (fieldByKey.has(f.key)) continue;
        def.fields.push(f);
        fieldByKey.set(f.key, f);
      }
    },
  };
}

// --- fields from files that load on demand ------------------------------------------------------------------------
// extendData(data, names) loads the named files ("districts", "citizens"; any other name is ignored) through
// app.loadData and adds their columns to the levels once per data model. Missing files (null) add nothing.
// Returns the loaded files by name.
const EXTENSIONS = { districts: extendDistricts, citizens: extendCitizens };

export async function extendData(data, names) {
  const app = data.app;
  const wanted = names.filter((k) => Object.hasOwn(EXTENSIONS, k));
  const files = Object.fromEntries(await Promise.all(wanted.map(async (k) => [k, await app.loadData(k).catch(() => null)])));
  data.extended ??= new Set();
  for (const k of wanted) {
    if (data.extended.has(k) || !files[k]) continue;
    data.extended.add(k);
    try {
      EXTENSIONS[k](data, files[k]);
    } catch (err) {
      console.error(`advisors: could not add the ${k} columns`, err);
    }
  }
  return files;
}

const times = (x) => `×${x.toFixed(2).replace(".", ",")}`;

function extendDistricts(data, d) {
  const { states, metros, counties } = data.levels;
  const cat = new Map((d.catalog || []).map((c) => [c.id, c]));
  const vint = d.vintage || "IGE, unidades locales";
  const rule = d.rule?.text || "";
  const names = (ids) => ids.map((id) => cat.get(id)?.name || id).join(", ") || "Ninguno";
  const F = (key, label, format, o = {}) => makeField(key, label, format, { source: "ige_unidades", group: "Distritos", ...o });
  const units = () => F("units", "Establecimientos", "int", { unit: "unidades locales", description: `Establecimientos (unidades locales) con sede en el territorio (${vint}). No son empleos.` });
  const districts = () => F("districts", "Distritos", "text", { description: `Distritos de actividad que cumple, del más fuerte al menos. Cuentan establecimientos. ${rule}` });
  const count = () => F("n_districts", "Número de distritos", "int", { description: `Cuántos distritos cumplen la regla${d.rule?.max_per_city ? ` (hasta ${d.rule.max_per_city})` : ""}.` });

  metros.addFields([
    F("city_type", "Tipo de ciudad", "text", { description: `Sale de su distrito principal; sin ningún distrito, la ciudad es diversificada. ${rule}` }),
    districts(), count(), units(),
    F("top_activity", "Actividad más especializada", "text", { description: "La actividad (división de la CNAE-09) con mayor cociente de localización entre las destacadas de la ciudad." }),
    F("top_lq", "Su cociente de localización", "lq", { unit: "× la parte de Galicia", description: "Parte de los establecimientos de la ciudad en esa actividad entre la misma parte en Galicia." }),
  ]);
  for (const r of metros.rows) {
    const c = d.cities?.[r.key];
    const top = c?.top?.[0];
    Object.assign(r.v, {
      city_type: c ? c.badge?.label ?? (c.districts?.length ? null : "Ciudad diversificada") : null,
      districts: c ? names((c.districts || []).map((x) => x.id)) : null,
      n_districts: c ? (c.districts || []).length : null,
      units: c?.units ?? null,
      top_activity: top ? d.divisions?.[top.div]?.title || top.div : null,
      top_lq: top?.lq ?? null,
    });
  }
  if (counties && d.counties) {
    counties.addFields([districts(), count(), units()]);
    for (const r of counties.rows) {
      const c = d.counties[r.key];
      r.v.districts = c ? names((c.districts || []).map((x) => x[0])) : null;
      r.v.n_districts = c ? (c.districts || []).length : null;
      r.v.units = c?.units ?? null;
    }
    states.addFields([units()]);
    for (const r of states.rows) r.v.units = total(counties.rows.filter((c) => c.v.state === r.name), "units");
  }
  data.galicia.units = d.national?.units ?? null;
}

// Citizens: every category of each row, as a share (the City view draws the same mix as person figures). Higher
// education and the mean age are already columns of the concello table.
const CITIZEN_ROWS = {
  workforce: { group: "Ciudadanos: ocupación", source: "ige_censo", unit: "parte de las personas ocupadas" },
  age: { group: "Ciudadanos: edad", source: "ige_poboacion", unit: "parte de la población" },
  education: { group: "Ciudadanos: estudios", source: "ige_censo", unit: "parte de las personas de 15 años o más" },
  nativity: { group: "Ciudadanos: origen", source: "ige_poboacion", unit: "parte de la población" },
};

function extendCitizens(data, cz) {
  const { metros } = data.levels;
  const cols = Object.entries(CITIZEN_ROWS).flatMap(([row, meta]) =>
    (cz.groups?.[row] || []).filter((g) => !(row === "education" && g.key === "higher")).map((g) => ({ row, g, meta })));
  const label = new Map(Object.entries(cz.groups || {}).flatMap(([row, list]) => list.map((g) => [`${row}.${g.key}`, g.label])));
  metros.addFields([
    ...cols.map(({ row, g, meta }) => makeField(`cz_${g.key}`, g.label, "pct", {
      unit: meta.unit, source: meta.source, group: meta.group, description: `${g.label}. ${cz.rows?.[row] || ""}.`,
    })),
    makeField("cz_foreign_nationals", "Nacionalidad extranjera", "pct", {
      unit: "parte de la población", source: "ige_poboacion", group: "Ciudadanos: origen", description: "Habitantes con nacionalidad extranjera (IGE, padrón de 2025).",
    }),
    makeField("cz_specialist", "Categoría que más destaca", "text", {
      source: "ige_censo", group: "Ciudadanos: ocupación", description: `La categoría de ciudadanos con más peso frente al de Galicia. ${cz.rule?.text || ""}`,
    }),
  ]);
  const values = (c) => ({
    ...Object.fromEntries(cols.map(({ row, g }) => [`cz_${g.key}`, c?.[row]?.shares?.[g.key] ?? null])),
    cz_foreign_nationals: c?.foreign_nationals ?? null,
  });
  const high = cz.rule?.specialist_high ?? 1.25;
  for (const r of metros.rows) {
    const c = cz.cities?.[r.key];
    const sp = (c?.specialists || []).filter((s) => s.ratio >= high).sort((a, b) => b.ratio - a.ratio)[0];
    Object.assign(r.v, values(c), { cz_specialist: sp ? `${label.get(`${sp.row}.${sp.key}`) || sp.key} ${times(sp.ratio)}` : null });
  }
  Object.assign(data.galicia, values(cz.national));
}

/** The highlight for a set of rows of one level, with defaults (gold outline, other land dimmed when asked). */
export function rowsHighlight(level, rows, opts = {}) {
  if (!level || !rows || !rows.length) return null;
  const one = rows.length === 1 ? rows[0] : null;
  const label = opts.label ?? (one ? (one.level === "states" || !one.sub || one.sub === one.name ? one.name : `${one.name}, ${one.sub}`) : "");
  return { ...level.highlight(rows, opts), dimOthers: !!opts.dim, color: opts.color, label };
}
