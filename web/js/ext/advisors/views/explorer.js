// Explorer: the generic slice-and-dice. Pick a level, any columns, filter, sort, plot any X / Y / size / colour,
// brush points onto the map, and show a column as a map lens where one exists.
import { esc, fin, colorScale, robustDomain, extent, RAMPS } from "../core/util.js";
import { fmtValue, fmtShort, fmtCell, parseNum, count3, compact, money, euros, int, pct, dec } from "../core/fmt.js";
import { rampLegend, swatchLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, segmented, selectBox, sourcesHtml, frameBtn } from "../core/view.js";
import { rowsHighlight, extendData } from "../core/data.js";

// Four numeric columns fit the 460 px dock and three fit a phone (euro amounts need about 60 px each). The comarca
// of a ciudad or concello is already the name's suffix.
const DEFAULT_COLS = {
  states: ["population", "gdp_pc", "renta_pc", "edad_media"],
  metros: ["population", "gdp_pc", "renta_pc", "unemployment"],
  counties: ["population", "density", "renta_pc", "edad_media"],
};
const NARROW_COLS = {
  states: ["population", "renta_pc", "edad_media"],
  metros: ["population", "renta_pc", "unemployment"],
  counties: ["population", "renta_pc", "edad_media"],
};
const DEFAULT_XY = {
  states: { x: "renta_pc", y: "edad_media", s: "population", c: "province" },
  metros: { x: "renta_pc", y: "unemployment", s: "population", c: "province" },
  counties: { x: "density", y: "edad_media", s: "population", c: "province" },
};
// Order of the column groups in the pickers (the model lists its fields in file order).
const GROUP_ORDER = [
  "Nombre", "Población", "Economía", "Trabajo", "Prosperidad", "Conocimiento", "Clima", "Territorio", "Riesgos",
  "Energía y recursos", "Distritos", "Ciudadanos: ocupación", "Ciudadanos: edad", "Ciudadanos: estudios", "Ciudadanos: origen",
];
const groupRank = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
// Table headers: short enough for a ~60 px column (they wrap to two lines; &shy; marks where a long word may break).
// The citizen categories take their short names from citizens.json.
const SHORT = {
  state: "Comarca", province: "Provin&shy;cia", city: "Ciudad",
  population: "Habi&shy;tantes", density: "Densi&shy;dad", edad_media: "Edad media", nacidos_fuera: "Nacidos fuera",
  gdp: "PIB", gdp_pc: "PIB por hab.",
  affiliates: "Afilia&shy;dos", agro: "Afil. agro y pesca", industria: "Afil. indus&shy;tria", construccion: "Afil. cons&shy;truc.",
  servicios: "Afil. servi&shy;cios", agro_share: "% agro y pesca", industry_share: "% indus&shy;tria",
  y_food: "Alimen&shy;to", y_production: "Produc&shy;ción", y_science: "Ciencia", y_culture: "Cultura",
  renta_pc: "Renta por pers.", unemployment: "Paro por hab.", gini: "Gini", p80p20: "P80/&shy;P20", estudios_superiores: "Estud. superio&shy;res",
  temp: "Tempe&shy;ratura", precip: "Lluvia", viento: "Viento", sol: "Horas de sol", humedad: "Hume&shy;dad",
  land_km2: "Super&shy;ficie", forest: "Bosque", crop: "Cultivo", pasture: "Pasto", farmland: "Cultivo y pasto", shrub: "Mato&shy;rral",
  wetland: "Hume&shy;dal", developed: "Suelo urbano", elevation: "Altitud", incendios: "Quema&shy;do", inundacion: "Inun&shy;dable",
  turbines: "Aeroge&shy;nerad.", quarries: "Cante&shy;ras", lonja_eur: "Lonja",
  city_type: "Tipo de ciudad", districts: "Distri&shy;tos", n_districts: "N.º de distritos", units: "Estable&shy;cim.",
  top_activity: "Activi&shy;dad", top_lq: "Cociente local.",
  cz_foreign_nationals: "Nacion. extran&shy;jera", cz_specialist: "Destaca",
};
// Where a long citizen short name may break.
const BREAKS = ["Direc|ción", "Profe|sionales", "Servi|cios", "Opera|dores", "Elemen|tales", "Secun|daria", "Extran|jero"];
const breakable = (s) => BREAKS.reduce((t, b) => t.replace(b.replace("|", ""), b.replace("|", "&shy;")), s);
const OPS = { num: [">", "≥", "<", "≤", "="], text: ["contiene", "=", "≠"] };
// Quick filters per level: [field, operator, value, button text].
const PRESETS = {
  states: [["population", "≥", 1e5, "100 mil hab. o más"], ["population", "<", 15000, "Menos de 15 mil"], ["edad_media", "≥", 52, "Edad media 52 o más"]],
  metros: [["population", "≥", 50000, "50 mil hab. o más"], ["population", "<", 20000, "Menos de 20 mil"], ["renta_pc", "≥", 17000, "Renta 17 mil € o más"]],
  counties: [["population", "≥", 10000, "10 mil hab. o más"], ["population", "<", 2000, "Menos de 2 mil"], ["edad_media", "≥", 55, "Edad media 55 o más"]],
};
// Example text for the value box of a text column.
const TEXT_EXAMPLE = {
  name: { states: "Santiago", metros: "Vigo", counties: "Arzúa" }, state: "Ferrol", province: "Lugo", city: "Sí",
  districts: "turístico", city_type: "industrial", top_activity: "bebidas", cz_specialist: "campo",
};
// Units people type after a number, dropped before parseNum reads it ("500 m" of altitude is not 500 millions).
const UNIT_RX = { elevation: /\s*m(etros)?$/, precip: /\s*mm$/, viento: /\s*m\/s$/, temp: /\s*[°º]\s*c?$/, sol: /\s*h(oras)?$/ };
function parseValue(f, text) {
  let s = text.trim().toLowerCase().replace(/\s*(km²|km2|años|habitantes|hab\.?|veces)$/, "").replace(/^[×x]\s*/, "");
  if (UNIT_RX[f.key]) s = s.replace(UNIT_RX[f.key], "");
  if (f.format === "pct" && !s.endsWith("%")) s += "%"; // a bare "5" in a percentage column means 5 %
  return parseNum(s, f.format);
}
// Case and accents do not count in text filters ("coruna" finds "A Coruña").
const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const comma = (v) => String(v).replace(".", ",");
const cut = (s, n = 44) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// Axis, tooltip and legend text. fmtShort rounds ages to whole years and writes 1402 as "1,4 mil".
function shortValue(f, v) {
  if (!fin(v)) return "–";
  if (f.format === "years") return dec(v, Number.isInteger(v) ? 0 : 1);
  if (f.format === "pct") return `${dec(v * 100, 1).replace(/,0$/, "")} %`;
  if (["int", "float", "km2"].includes(f.format) && Math.abs(v) < 1e4) return Number.isInteger(v) ? int(v) : comma(+v.toPrecision(4));
  return fmtShort(f.format, v);
}

// Remember the explorer's setup per viewer (a convenience; the page works without it).
const STORE = "advisors.explorer.gal.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; } };
const save = (s) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode */ } };

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  // Columns from the optional files (activity districts, citizen mixes): loaded on demand, only when the Explorer
  // opens, and added to the levels once.
  const files = await extendData(data, ["districts", "citizens"]);
  const short = { ...SHORT };
  for (const [row, list] of Object.entries(files.citizens?.groups || {})) {
    for (const g of list) short[`cz_${g.key}`] = `${row === "age" ? "Edad " : ""}${breakable(esc(g.short || g.label))}`;
  }
  const avail = ["states", "metros", "counties"].filter((k) => data.levels[k]);
  const saved = load() || {};
  // A saved setup only keeps the columns the level still has.
  const defaults = el.clientWidth && el.clientWidth < 420 ? NARROW_COLS : DEFAULT_COLS;
  const savedCols = (k) => {
    const list = saved.cols?.[k];
    if (!Array.isArray(list)) return [...defaults[k]];
    const ok = list.filter((key) => key !== "name" && data.levels[k].field(key));
    return ok.length || !list.length ? ok : [...defaults[k]];
  };
  const savedXY = (k) => {
    const out = { ...DEFAULT_XY[k] };
    const old = saved.xy?.[k] || {};
    for (const a of ["x", "y", "s", "c"]) {
      const key = old[a];
      const f = key ? data.levels[k].field(key) : null;
      const ok = (key === "" && (a === "s" || a === "c")) || (f && key !== "name" && (a === "c" || f.format !== "text"));
      if (!ok) continue;
      out[a] = key;
      if (typeof old[`log${a}`] === "boolean") out[`log${a}`] = old[`log${a}`];
    }
    return out;
  };
  const st = {
    level: avail.includes(ctx.params.level) ? ctx.params.level : avail.includes(saved.level) ? saved.level : "metros",
    cols: Object.fromEntries(avail.map((k) => [k, savedCols(k)])),
    xy: Object.fromEntries(avail.map((k) => [k, savedXY(k)])),
    filters: [],
    onlySel: false,
    sel: null,
  };
  const persist = () => save({ level: st.level, cols: st.cols, xy: st.xy });
  const L = () => data.levels[st.level];

  // --- controls -------------------------------------------------------------------------------------------------
  const top = section(el, { title: "Explora los datos", note: "Elige qué comparar, filtra, ordena la tabla y cruza dos columnas en el gráfico. Pasa el puntero por una fila o un punto para verlo en el mapa y púlsalo para ir hasta allí; arrastra sobre el gráfico para seleccionar un grupo." });
  const lvRow = document.createElement("div");
  lvRow.className = "adv-row";
  top.appendChild(lvRow);
  segmented(lvRow, {
    label: "Nivel", value: st.level,
    options: avail.map((k) => ({ value: k, label: data.levels[k].label })),
    onChange: (v) => { st.level = v; st.filters = st.filters.filter((f) => L().field(f.key)); st.sel = null; persist(); rebuild(); },
  });
  const colsBox = document.createElement("details");
  colsBox.className = "adv-cols";
  lvRow.appendChild(colsBox);

  const fRow = document.createElement("div");
  fRow.className = "adv-fbuild";
  top.appendChild(fRow);
  const chipsRow = document.createElement("div");
  chipsRow.className = "adv-row adv-filterbar";
  top.appendChild(chipsRow);
  const summary = document.createElement("p");
  summary.className = "adv-note adv-summary";
  top.appendChild(summary);

  // --- table ----------------------------------------------------------------------------------------------------
  const tBody = section(el, { title: "Tabla" });
  const selRow = document.createElement("div");
  selRow.className = "adv-row";
  tBody.appendChild(selRow);
  const tableHost = document.createElement("div");
  tBody.appendChild(tableHost);
  let table = null;

  // --- chart ----------------------------------------------------------------------------------------------------
  const cBody = section(el, { title: "Gráfico" });
  const axes = document.createElement("div");
  axes.className = "adv-axes";
  cBody.appendChild(axes);
  const scatterHost = document.createElement("div");
  cBody.appendChild(scatterHost);
  const legendEl = document.createElement("div");
  cBody.appendChild(legendEl);
  const lensRow = document.createElement("div");
  lensRow.className = "adv-row";
  cBody.appendChild(lensRow);
  const fieldInfo = document.createElement("div");
  fieldInfo.className = "adv-fieldinfo";
  cBody.appendChild(fieldInfo);
  const scatter = createScatter(scatterHost, {
    height: 320, points: [],
    onHover: (p) => { link.hover(p ? rowsHighlight(L(), [p.row]) : null); table?.setHot(p ? p.key : null, false); },
    onClick: (p) => L().focus(p.row),
    onBrush: (set) => { st.sel = set; applySelection(); },
  });
  const srcEl = document.createElement("div");
  el.appendChild(srcEl);

  // --- logic ----------------------------------------------------------------------------------------------------
  const ordered = () => [...L().fields].sort((a, b) => groupRank(a.group) - groupRank(b.group));
  const fieldOpts = (withNone = false, numeric = true) => {
    const fs = ordered().filter((f) => (numeric ? f.format !== "text" : f.key !== "name"));
    return [...(withNone ? [{ value: "", label: "Ninguno" }] : []), ...fs.map((f) => ({ value: f.key, label: f.label, group: f.group }))];
  };
  const numeric = (f) => f && f.format !== "text";
  const val = (r, k) => r.v[k] ?? null;
  const fmtF = (f, v) => fmtValue(f.format, v, f.unit);

  function passes(r) {
    for (const f of st.filters) {
      const fd = L().field(f.key);
      if (!fd) continue;
      const v = val(r, f.key);
      if (numeric(fd)) {
        if (!fin(v)) return false;
        const t = f.value;
        if (f.op === ">" && !(v > t)) return false;
        if (f.op === "≥" && !(v >= t)) return false;
        if (f.op === "<" && !(v < t)) return false;
        if (f.op === "≤" && !(v <= t)) return false;
        if (f.op === "=" && !(Math.abs(v - t) <= Math.abs(t) * 0.005 + 1e-9)) return false;
      } else {
        const s = fold(v), t = fold(f.value);
        if (f.op === "=" && s !== t) return false;
        if (f.op === "≠" && s === t) return false;
        if (f.op === "contiene" && !s.includes(t)) return false;
      }
    }
    return true;
  }
  const filtered = () => L().rows.filter(passes);

  function renderCols() {
    const on = new Set(st.cols[st.level]);
    const groups = new Map();
    for (const f of ordered()) {
      if (f.key === "name") continue;
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    }
    colsBox.innerHTML = `<summary class="adv-mini">Columnas (${on.size})</summary><div class="adv-cols-pop">${[...groups].map(([g, list]) => `<fieldset><legend>${esc(g)}</legend>${list.map((f) => `<label title="${esc(f.description)}"><input type="checkbox" value="${esc(f.key)}"${on.has(f.key) ? " checked" : ""}> ${esc(f.label)}</label>`).join("")}</fieldset>`).join("")}</div>`;
    placeCols();
  }
  // The list opens under its button; shift it left when it would stick out of the dock (phones).
  function placeCols() {
    const pop = colsBox.querySelector(".adv-cols-pop");
    if (!pop || !colsBox.open) return;
    pop.style.left = "0px";
    const over = pop.getBoundingClientRect().right - (el.getBoundingClientRect().right - 8);
    if (over > 0) pop.style.left = `${-Math.ceil(over)}px`;
  }
  colsBox.addEventListener("toggle", placeCols);
  colsBox.addEventListener("change", (e) => {
    const k = e.target.value;
    const list = st.cols[st.level].filter((x) => x !== k);
    if (e.target.checked) list.push(k);
    st.cols = { ...st.cols, [st.level]: list };
    colsBox.querySelector("summary").textContent = `Columnas (${list.length})`;
    persist();
    buildTable();
    renderSources();
  });

  function renderFilterBuilder() {
    fRow.innerHTML = "";
    const fs = ordered();
    const fsel = selectBox(fRow, { label: "Filtro", value: fs.find((f) => f.key === "population")?.key || fs[0].key, options: fs.map((f) => ({ value: f.key, label: f.label, group: f.group })) });
    const ops = document.createElement("select");
    ops.setAttribute("aria-label", "Comparación");
    const valIn = document.createElement("input");
    valIn.type = "text";
    valIn.setAttribute("aria-label", "Valor");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "adv-mini";
    add.textContent = "Añadir";
    // An example the value box understands: a typical (median, non-zero) value of the column.
    const example = (f) => {
      if (!numeric(f)) {
        const t = TEXT_EXAMPLE[f.key];
        return (typeof t === "object" ? t[st.level] : t) || "texto";
      }
      const s = L().rows.map((r) => val(r, f.key)).filter((v) => fin(v) && v > 0).sort((a, b) => a - b);
      if (!s.length) return "";
      const m = +s[Math.floor(s.length / 2)].toPrecision(2);
      if (f.format === "pct") return pct(m, Number.isInteger(+(m * 100).toFixed(6)) ? 0 : 1);
      if (f.format === "eur") return m >= 1e6 ? money(m) : euros(m);
      return m >= 1e4 ? compact(m) : Number.isInteger(m) ? int(m) : comma(m);
    };
    const syncOps = () => {
      const f = L().field(fsel.value);
      ops.innerHTML = (numeric(f) ? OPS.num : OPS.text).map((o) => `<option>${esc(o)}</option>`).join("");
      const ex = example(f);
      valIn.placeholder = ex ? `p. ej. ${ex}` : "";
      valIn.setCustomValidity("");
    };
    fsel.select.addEventListener("change", syncOps);
    syncOps();
    valIn.addEventListener("input", () => valIn.setCustomValidity(""));
    const submit = () => {
      const f = L().field(fsel.value);
      if (!f || !valIn.value.trim()) return;
      const v = numeric(f) ? parseValue(f, valIn.value) : valIn.value.trim();
      if (v == null) { valIn.setCustomValidity("No es un número. Prueba con 1,5 M, 250 mil o 12 %."); valIn.reportValidity(); return; }
      valIn.setCustomValidity("");
      st.filters.push({ key: f.key, op: ops.value, value: v });
      valIn.value = "";
      refresh();
    };
    add.addEventListener("click", submit);
    valIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    fRow.append(ops, valIn, add);
    // quick presets
    const presets = document.createElement("span");
    presets.className = "adv-presets";
    const P = PRESETS[st.level].filter((p) => L().field(p[0]));
    presets.innerHTML = P.map((p, i) => `<button type="button" class="adv-mini" data-preset="${i}">${esc(p[3])}</button>`).join("");
    presets.addEventListener("click", (e) => {
      const i = e.target.closest("[data-preset]")?.dataset.preset;
      if (i == null) return;
      const [key, op, value] = P[+i];
      st.filters = st.filters.filter((f) => f.key !== key);
      st.filters.push({ key, op, value });
      refresh();
    });
    fRow.appendChild(presets);
  }

  function renderChips() {
    chipsRow.innerHTML = st.filters.map((f, i) => {
      const fd = L().field(f.key);
      // The chip shows the value as typed, with the decimals it needs (fmtShort would round it).
      const shown = !numeric(fd) ? f.value : fd.format === "pct" && Math.abs(f.value * 1000 - Math.round(f.value * 1000)) > 1e-6 ? pct(f.value, 2) : fmtValue(fd.format, f.value, fd.unit);
      const txt = `${(fd?.label || f.key).replace(/\s*≈$/, "")} ${f.op} ${shown}`;
      return `<span class="adv-fchip">${esc(txt)}<button type="button" data-rm="${i}" aria-label="Quitar el filtro ${esc(txt)}">✕</button></span>`;
    }).join("") + (st.filters.length > 1 ? `<button type="button" class="adv-mini" data-rm="all">Quitar todos</button>` : "") + (st.filters.length && filterHighlight() ? frameBtn() : "");
  }
  chipsRow.addEventListener("click", (e) => {
    const i = e.target.closest("[data-rm]")?.dataset.rm;
    if (i == null) return;
    if (i === "all") st.filters = [];
    else st.filters.splice(+i, 1);
    refresh();
  });

  function buildTable() {
    const lv = L();
    const keys = st.cols[st.level].filter((k) => lv.field(k));
    const sortKey = keys.includes("population") ? "population" : keys[0] || "name";
    const maxOf = (k) => { const e = extent(lv.rows.map((r) => val(r, k))); return e ? Math.max(Math.abs(e[0]), Math.abs(e[1])) : 1; };
    const cols = [
      // The comarca (or province) rides along as a suffix, unless it repeats the name or has its own column.
      { key: "name", label: lv.field("name")?.label || "Nombre", align: "l", width: "minmax(92px,1.7fr)", value: (r) => r.name, html: (r) => `${esc(r.name)}${st.level !== "states" && r.sub && r.sub !== r.name && !keys.includes("state") ? ` <span class="sub">${esc(r.sub)}</span>` : ""}` },
      ...keys.map((k) => {
        const f = lv.field(k);
        const title = `${f.label}${f.unit ? ` (${f.unit})` : ""}. Pulsa para ordenar.`;
        const head = short[k] ? `${short[k]}${f.label.includes("≈") ? " ≈" : ""}` : null;
        return numeric(f)
          ? { key: k, label: f.label, short: head, title, value: (r) => val(r, k), text: (r) => fmtCell(f.format, val(r, k), f.unit), tip: (r) => fmtF(f, val(r, k)), bar: k === sortKey ? { max: maxOf(k), color: "rgba(154,123,201,.32)" } : null }
          : { key: k, label: f.label, short: head, title, align: "l", width: "minmax(0,.8fr)", value: (r) => val(r, k), text: (r) => val(r, k) ?? "–" };
      }),
    ];
    if (!table) {
      table = createTable(tableHost, {
        caption: `Tabla de ${lv.label.toLowerCase()}`, columns: cols, rows: [], sort: { key: sortKey, dir: "desc" }, rank: true, maxHeight: 360,
        search: `Buscar ${lv.label.toLowerCase()}`, empty: "Ningún lugar cumple los filtros o la búsqueda.",
        onHover: (r) => { link.hover(r ? rowsHighlight(L(), [r]) : null); scatter.setHot(r ? r.key : null); },
        // A tap fires no pointer move, so pressing a row outlines it too (until the table loses focus).
        onClick: (r) => { L().focus(r); link.hover(rowsHighlight(L(), [r])); },
      });
    } else table.setColumns(cols, { key: sortKey, dir: "desc" });
    refreshRows();
  }

  function axisSelects() {
    axes.innerHTML = "";
    const xy = st.xy[st.level];
    const fix = (k, fallback) => (L().field(k) && numeric(L().field(k)) ? k : fallback);
    xy.x = fix(xy.x, DEFAULT_XY[st.level].x);
    xy.y = fix(xy.y, DEFAULT_XY[st.level].y);
    xy.s = xy.s && L().field(xy.s) ? xy.s : "";
    xy.c = xy.c && L().field(xy.c) ? xy.c : "";
    const mk = (key, label, none) => selectBox(axes, {
      label, value: xy[key], options: fieldOpts(none, key !== "c"),
      onChange: (v) => { xy[key] = v; if (key === "x" || key === "y") delete xy[`log${key}`]; persist(); drawScatter(); },
    });
    mk("x", "X", false);
    mk("y", "Y", false);
    mk("s", "Tamaño", true);
    mk("c", "Color", true);
    const logs = document.createElement("span");
    logs.className = "adv-logs";
    logs.innerHTML = `<label class="adv-check"><input type="checkbox" data-log="x"> X logarítmico</label><label class="adv-check"><input type="checkbox" data-log="y"> Y logarítmico</label>`;
    axes.appendChild(logs);
    logs.addEventListener("change", (e) => {
      const a = e.target.dataset.log;
      xy[`log${a}`] = e.target.checked;
      persist();
      drawScatter();
    });
  }
  // A skewed, positive column reads better on a log axis.
  const autoLog = (k, rows) => {
    const e = extent(rows.map((r) => val(r, k)), true);
    const all = rows.map((r) => val(r, k)).filter(fin);
    return !!e && all.every((v) => v > 0) && e[1] / e[0] > 60;
  };

  function drawScatter() {
    const lv = L();
    const xy = st.xy[st.level];
    const rows = filtered();
    const fx = lv.field(xy.x), fy = lv.field(xy.y), fs = xy.s ? lv.field(xy.s) : null, fc = xy.c ? lv.field(xy.c) : null;
    const lx = xy.logx ?? autoLog(xy.x, rows), ly = xy.logy ?? autoLog(xy.y, rows);
    axes.querySelector('[data-log="x"]').checked = lx;
    axes.querySelector('[data-log="y"]').checked = ly;
    let color = null;
    legendEl.innerHTML = "";
    if (fc) {
      if (numeric(fc)) {
        const cl = autoLog(fc.key, rows);
        const dom = robustDomain(rows.map((r) => val(r, fc.key)), 0.03, cl) || [0, 1];
        const ramp = fc.higher_is === "bad" ? RAMPS.heat : RAMPS.seq;
        const cs = colorScale({ type: "seq", domain: dom, log: cl, ramp });
        color = (c) => cs(c);
        legendEl.innerHTML = rampLegend({ ramp, domain: dom, log: cl, fmt: (v) => shortValue(fc, v), label: fc.label });
      } else {
        // The twelve most frequent values get a colour; they come from the whole level, so filtering keeps them.
        const count = new Map();
        for (const r of lv.rows) { const c = val(r, fc.key); if (c != null) count.set(c, (count.get(c) || 0) + 1); }
        const present = new Set(rows.map((r) => val(r, fc.key)).filter((c) => c != null));
        const cats = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || String(a).localeCompare(String(b), "es")).slice(0, 12);
        const pal = ["#e0b54c", "#4a86d6", "#3f9c82", "#c46a4f", "#9a7bc9", "#6e9a3c", "#d98a2b", "#5fbfbf", "#c9a0c0", "#a3a3c2", "#e8774a", "#b9b06a"];
        const m = new Map(cats.map((c, i) => [c, pal[i]]));
        color = (c) => m.get(c) || "#8b8070";
        const more = [...present].some((c) => !m.has(c));
        legendEl.innerHTML = swatchLegend([...cats.filter((c) => present.has(c)).map((c) => ({ label: c, color: m.get(c) })), ...(more ? [{ label: "otros", color: "#8b8070" }] : [])], fc.label);
      }
    }
    const big = [...rows].sort((a, b) => (val(b, "population") || 0) - (val(a, "population") || 0)).slice(0, st.level === "states" ? 10 : 6).map((r) => r.key);
    scatter.update({
      points: rows.map((r) => ({ key: r.key, x: val(r, xy.x), y: val(r, xy.y), s: fs ? val(r, xy.s) : null, c: fc ? val(r, xy.c) : null, label: r.name, sub: r.sub, row: r })),
      x: { label: cut(fx.label), fmt: (v) => shortValue(fx, v), log: lx },
      // Euros on the Y axis drop the sign (the title carries it) so the ticks do not run into the title.
      y: fy.format === "eur"
        ? { label: `${cut(fy.label, 38)} (€)`, fmt: (v) => compact(v), log: ly }
        : { label: cut(fy.label), fmt: (v) => shortValue(fy, v), log: ly },
      size: fs && numeric(fs) ? { label: fs.label, fmt: (v) => fmtF(fs, v), max: st.level === "counties" ? 13 : 15, min: 1.6 } : null,
      radius: st.level === "counties" ? 2.2 : 3.5,
      color, colorLabel: fc?.label, colorFmt: (v) => (fc && numeric(fc) ? fmtF(fc, v) : String(v)),
      labels: big,
      refLines: [], refX: [], refY: [],
    });
    if (st.sel) scatter.setSelected(st.sel);
    // Lens buttons for the plotted columns that have a matching map lens.
    lensRow.innerHTML = "";
    const lensFields = [fc, fy, fx].filter((f, i, a) => f && f.lens && a.findIndex((g) => g && g.lens === f.lens) === i);
    for (const f of lensFields) {
      const lens = app.lensById.get(f.lens);
      if (!lens) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "adv-lensbtn";
      const on = app.state.lens?.id === lens.id;
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? `Lente activa: ${lens.name}` : `Ver en el mapa la lente ${lens.name}`;
      b.addEventListener("click", () => { app.setLens(app.state.lens?.id === lens.id ? null : lens.id); drawScatter(); });
      lensRow.appendChild(b);
    }
    if (!lensFields.length) lensRow.innerHTML = `<span class="adv-note">Estas columnas no tienen lente de mapa: pasa el puntero o selecciona en el gráfico para ver los lugares.</span>`;
    fieldInfo.innerHTML = [fx, fy, fs, fc].filter((f, i, a) => f && a.indexOf(f) === i).map((f) => `<p><b>${esc(f.label)}</b>${f.unit ? ` <span class="sub">${esc(f.unit)}</span>` : ""}: ${esc(f.description || "")}</p>`).join("");
    renderSources();
  }

  // Sources and caveats for the columns on screen: table, chart and filters.
  function renderSources() {
    const xy = st.xy[st.level];
    const keys = new Set([...st.cols[st.level], xy.x, xy.y, xy.s, xy.c, ...st.filters.map((f) => f.key)]);
    const used = [...keys].map((k) => L().field(k)).filter(Boolean);
    const has = (...list) => used.some((f) => list.includes(f.key));
    const caveats = [
      used.some((f) => f.label.includes("≈")) && "Las columnas con ≈ son aproximaciones: medias de las casillas del territorio o medias de sus concellos ponderadas por población.",
      has("gdp", "gdp_pc") && "El PIB es la estimación del IGE para 2023; por habitante, se divide entre la población de 2025.",
      has("affiliates", "agro", "industria", "construccion", "servicios", "agro_share", "industry_share") && "Los afiliados a la Seguridad Social se cuentan en el concello donde viven, no donde trabajan (septiembre de 2026).",
      has("y_science", "y_culture") && "Ciencia y cultura son estimaciones a partir de la afiliación por rama de actividad.",
      has("renta_pc") && "La renta es la media neta por persona de 2024, no una mediana.",
      has("unemployment") && "El paro registrado va en parados por habitante (octubre de 2026): no es la tasa de paro.",
      used.some((f) => ["units", "districts", "n_districts", "city_type", "top_activity", "top_lq"].includes(f.key)) && "Distritos y actividades cuentan establecimientos (unidades locales), nunca empleos.",
      has("turbines", "quarries", "lonja_eur") && "Aerogeneradores, canteras y lonja suman solo lo que sale en el mapa.",
      "Un guion en la tabla indica que no hay dato para ese lugar.",
      st.level === "counties" && data.countiesOffMap && `Hay ${int(data.countiesOffMap)} concellos sin casilla propia: salen en la tabla y en el gráfico, pero no se pueden marcar en el mapa.`,
    ].filter(Boolean);
    srcEl.innerHTML = sourcesHtml(data, ["ige_comarcas", "ign_limites", ...used.map((f) => f.source).filter(Boolean)], caveats);
  }

  function applySelection() {
    const lv = L();
    const sel = st.sel ? lv.rows.filter((r) => st.sel.has(r.key)) : [];
    link.base(sel.length ? rowsHighlight(lv, sel, { dim: true }) : filterHighlight(), { frame: sel.length > 1 || (!sel.length && st.filters.length > 0) });
    table?.setSelected(st.sel);
    selRow.innerHTML = st.sel ? `<span class="adv-fchip">Selección en el gráfico: ${int(st.sel.size)}<button type="button" data-clear-sel aria-label="Quitar la selección">✕</button></span>${frameBtn()}
      <label class="adv-check"><input type="checkbox" data-only${st.onlySel ? " checked" : ""}> Mostrar solo la selección</label>` : `<span class="adv-note">Consejo: arrastra sobre el gráfico de abajo para seleccionar un grupo.</span>`;
    refreshRows();
    updateSummary();
  }
  selRow.addEventListener("click", (e) => { if (e.target.closest("[data-clear-sel]")) { st.sel = null; st.onlySel = false; scatter.setSelected(null); applySelection(); } });
  selRow.addEventListener("change", (e) => { if (e.target.matches("[data-only]")) { st.onlySel = e.target.checked; refreshRows(); } });

  // With filters on, outline the rows that pass.
  function filterHighlight() {
    if (!st.filters.length) return null;
    const rows = filtered();
    if (!rows.length) return null;
    return rowsHighlight(L(), rows, { dim: true, ringMax: 12 });
  }

  function refreshRows() {
    if (!table) return;
    let rows = filtered();
    if (st.onlySel && st.sel) rows = rows.filter((r) => st.sel.has(r.key));
    table.setRows(rows);
  }
  function updateSummary() {
    const rows = filtered();
    const pop = rows.reduce((a, r) => a + (val(r, "population") || 0), 0);
    summary.innerHTML = `<b>${int(rows.length)}</b> de ${int(L().rows.length)} ${esc(L().label.toLowerCase())} · ${count3(pop)} habitantes${st.sel ? ` · <b>${int(st.sel.size)}</b> en la selección` : ""}`;
  }
  function refresh() {
    link.hover(null);
    renderChips();
    st.sel = null;
    scatter.setSelected(null);
    refreshRows();
    drawScatter();
    applySelection();
  }
  function rebuild() {
    if (table) { table.destroy(); table = null; }
    renderCols();
    renderFilterBuilder();
    axisSelects();
    buildTable();
    refresh();
  }
  rebuild();

  const hostRowAt = (cell) => (cell >= 0 ? L().rowAtCell(cell) : null);
  return {
    onMapHover(h) {
      const r = hostRowAt(h.cell);
      scatter.setHot(r ? r.key : null);
      table?.setHot(r ? r.key : null);
    },
    onEscape() {
      if (st.sel) { st.sel = null; st.onlySel = false; scatter.setSelected(null); applySelection(); return true; }
      return false;
    },
  };
}
