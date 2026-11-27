// Economy advisor: affiliations by sector, city GDP on the map, leaders, specialisation and growth vs output.
// GDP is counted where it is produced; affiliations (and so specialisation) where the person lives.
import { esc, fin, ratio, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { money, euros, pct, int, dec, signedPct, count3, fmtShort } from "../core/fmt.js";
import { barList, rampLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, selectBox, lensButton, sourcesHtml, frameBtn } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { icon } from "../../../ui/icon.js";

// The four sectors. `key` is the nation.json industry id (the `industry` parameter); `col` is the row column.
const SECTORS = [
  { key: "agricultura", col: "agro", label: "Agricultura y pesca", color: "#7fbf3f", icon: "i-agriculture", emoji: "🌾" },
  { key: "industria", col: "industria", label: "Industria", color: "#c2643a", icon: "i-manufacturing", emoji: "🏭" },
  { key: "construccion", col: "construccion", label: "Construcción", color: "#d9a441", icon: "i-construction", emoji: "🏗️" },
  { key: "servicios", col: "servicios", label: "Servicios", color: "#4a86d6", icon: "i-other", emoji: "🛎️" },
];
const sectorBy = new Map(SECTORS.map((s) => [s.key, s]));
const MONTH = "septiembre de 2026"; // the month of the affiliation figures (IGE, table 11497)
const SPEC_TOP = 10;

// Like charts.sizeLegend, but with room beside each circle for a label such as "1 mil M €".
function circleLegend(values, r, label) {
  const rs = values.map((v) => Math.max(1.5, r(v)));
  const H = Math.ceil(Math.max(...rs) * 2 + 4);
  let x = 4;
  const circles = values.map((v, i) => {
    const cx = x + rs[i];
    x += rs[i] * 2 + 70;
    return `<circle cx="${cx.toFixed(1)}" cy="${(H - rs[i] - 2).toFixed(1)}" r="${rs[i].toFixed(1)}"/><text x="${(cx + rs[i] + 4).toFixed(1)}" y="${H - 3}">${esc(money(v))}</text>`;
  }).join("");
  return `<div class="adv-legend size"><span class="t">${esc(label)}</span><svg width="${Math.ceil(x)}" height="${H}" aria-hidden="true">${circles}</svg></div>`;
}

export function mount(ctx) {
  const { app, data, el, link, params } = ctx;
  const g = data.galicia;
  const { metros, states } = data.levels;
  const rows = metros.rows;
  const gdpYear = data.nat.gdp_year || "";
  const popYear = data.nation.year || "";
  const share = (v, s) => ratio(v[s.col], v.affiliates);
  const nameCol = (level) => ({
    key: "name", label: level === metros ? "Ciudad" : "Comarca", align: "l", value: (r) => r.name,
    html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>`,
  });
  const levelOptions = [{ value: "metros", label: "Ciudades" }, { value: "states", label: "Comarcas" }];
  const growthYears = (data.nat.growth_years || []).join("-");
  let scatter = null; // built after the specialisation section, which it reads

  // --- headline -------------------------------------------------------------------------------------------------
  const topSector = SECTORS.filter((s) => fin(share(g, s))).sort((a, b) => share(g, b) - share(g, a))[0];
  el.insertAdjacentHTML("beforeend", tiles([
    { label: `PIB ${gdpYear}`, value: money(g.gdp), sub: "euros corrientes" },
    { label: "Por habitante", value: euros(g.gdp_pc), sub: `PIB ${gdpYear} ÷ población ${popYear}` },
    { label: "Sector principal", value: topSector?.label || "Sin dato", sub: topSector ? `${pct(share(g, topSector))} de las afiliaciones` : "" },
  ]));

  // --- affiliations by sector -----------------------------------------------------------------------------------
  const secBody = section(el, { title: "Afiliación por sector", kicker: "Galicia", note: `Afiliaciones a la Seguridad Social en ${MONTH}, contadas <b>donde vive la persona, no donde trabaja</b>. Pasa por un sector para iluminar las ocho comarcas donde más pesa; púlsalo para ver quién se especializa en él.` });
  const secBars = barList(secBody, {
    ariaLabel: "Afiliaciones por sector",
    rows: SECTORS.filter((s) => fin(g[s.col])).map((s) => ({
      key: s.key, label: s.label, value: g[s.col], text: int(g[s.col]), sub: pct(share(g, s)), color: s.color,
      icon: icon(s.icon, s.emoji, { size: 14 }),
    })),
    onHover: (r) => {
      if (!r) return link.hover(null);
      const s = sectorBy.get(r.key);
      const top = states.rows.filter((x) => fin(share(x.v, s))).sort((a, b) => share(b.v, s) - share(a.v, s)).slice(0, 8);
      link.hover(rowsHighlight(states, top, { dim: true, label: `${s.label}: comarcas donde más pesa` }));
    },
    onClick: (r) => { setSector(r.key); specBody.scrollIntoView({ behavior: "smooth", block: "start" }); },
  });

  // --- map: city GDP circles ------------------------------------------------------------------------------------
  const cityGdp = rows.reduce((a, r) => a + (r.v.gdp || 0), 0);
  const mapBody = section(el, { title: "El PIB en el mapa", note: `Cada círculo es una ciudad: su área es el PIB y su color, el PIB por habitante. Pasa el puntero por un círculo para ver las cifras; púlsalo para abrir la ciudad. Las ${int(rows.length)} ciudades suman el ${pct(ratio(cityGdp, g.gdp))} del PIB de Galicia.` });
  const ppDomain = robustDomain(rows.map((r) => r.v.gdp_pc), 0.03, true) || [10000, 60000];
  const ppColor = colorScale({ type: "seq", domain: ppDomain, ramp: RAMPS.gold });
  const gMax = Math.max(1, ...rows.map((r) => r.v.gdp || 0));
  const rMax = app.isMobile() ? 18 : 30; // the whole of Galicia is small on a phone
  const bubbles = ctx.bubbles("gdp", {
    rMax, minR: 1.5, alpha: 0.6,
    tip: (b) => `<b>${esc(b.row.name)}</b> <span class="sub">${esc(b.row.sub)}</span><br>PIB <b>${money(b.row.v.gdp)}</b> · por habitante <b>${euros(b.row.v.gdp_pc)}</b><br>${int(b.row.v.population)} habitantes`,
    onHover: (b) => {
      if (leadLevel === metros) table.setHot(b ? b.key : null);
      if (specLevel === metros) specTable.setHot(b ? b.key : null);
      link.hover(b ? rowsHighlight(metros, [b.row]) : null);
    },
    onClick: (b) => metros.focus(b.row),
  });
  const bubbleItems = rows.filter((r) => fin(r.v.gdp)).map((r) => ({ key: r.key, x: app.w.grid.cx(r.ref.cell), y: app.w.grid.cy(r.ref.cell), value: r.v.gdp, color: ppColor(r.v.gdp_pc), row: r }));
  bubbles.set(bubbleItems, { vMax: gMax });
  const showBubbles = document.createElement("label");
  showBubbles.className = "adv-check";
  showBubbles.innerHTML = `<input type="checkbox" checked> Mostrar los círculos de PIB`;
  showBubbles.querySelector("input").addEventListener("change", (e) => bubbles.set(e.target.checked ? bubbleItems : [], { vMax: gMax }));
  mapBody.appendChild(showBubbles);
  mapBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.gold, domain: ppDomain, fmt: money, label: "PIB por habitante" })
    + circleLegend([1e8, 1e9, 5e9].filter((v) => v <= gMax), (v) => rMax * Math.sqrt(v / gMax), "Área del círculo = PIB (con la vista inicial)"));
  const lensBtn = lensButton(app, "gdp_pc", "Colorear el mapa por PIB por habitante");
  if (lensBtn) {
    mapBody.appendChild(lensBtn);
    ctx.on("lens", () => lensBtn._sync());
  }

  // --- leaders --------------------------------------------------------------------------------------------------
  const lBody = section(el, { title: "Quién destaca", note: `El PIB se atribuye al lugar donde se produce: un sitio con mucha industria y poca población sale alto por habitante. Ciudades: los ${int(rows.length)} concellos de 10.000 habitantes o más. Pulsa una fila para ir a ella en el mapa.` });
  const lCtl = document.createElement("div");
  lCtl.className = "adv-row";
  lBody.appendChild(lCtl);
  let leadLevel = metros, leadSort = "gdp";
  const leadCols = () => [
    nameCol(leadLevel),
    { key: "gdp", label: "PIB", value: (r) => r.v.gdp, text: (r) => money(r.v.gdp), bar: { max: Math.max(1, ...leadLevel.rows.map((r) => r.v.gdp || 0)), color: "rgba(224,181,76,.35)" } },
    { key: "gdp_pc", label: "Por habitante", short: "Por habi&shy;tante", value: (r) => r.v.gdp_pc, text: (r) => euros(r.v.gdp_pc) },
    // no room on a phone for five columns: the share of Galicia's GDP goes
    ...(app.isMobile() ? [] : [{ key: "of_total", label: "Del total", title: "Parte del PIB de Galicia (ordenar)", value: (r) => ratio(r.v.gdp, g.gdp), text: (r) => pct(ratio(r.v.gdp, g.gdp)) }]),
    { key: "growth", label: "Población", short: "Pobla&shy;ción", title: `Variación de la población ${growthYears} (ordenar)`, value: (r) => r.v.growth, text: (r) => signedPct(r.v.growth) },
  ];
  segmented(lCtl, {
    label: "Nivel", value: "metros", options: levelOptions,
    onChange: (v) => { leadLevel = data.levels[v]; table.setColumns(leadCols(), { key: leadSort, dir: "desc" }); table.setRows(leadLevel.rows); },
  });
  segmented(lCtl, {
    label: "Ordenar por", value: leadSort,
    options: [{ value: "gdp", label: "Mayor PIB" }, { value: "gdp_pc", label: "PIB por habitante" }, { value: "growth", label: "Crece más" }],
    onChange: (v) => { leadSort = v; table.setColumns(leadCols(), { key: v, dir: "desc" }); },
  });
  const table = createTable(lBody, {
    caption: "PIB por lugar", columns: leadCols(), rows: leadLevel.rows, sort: { key: leadSort, dir: "desc" }, rank: true, maxHeight: 280,
    search: "Buscar por nombre",
    onHover: (r) => { link.hover(r ? rowsHighlight(leadLevel, [r]) : null); bubbles.setHot(r ? r.key : null); scatter?.setHot(r ? r.key : null); },
    onClick: (r) => leadLevel.focus(r),
  });

  // --- specialisation -------------------------------------------------------------------------------------------
  const specBody = section(el, { title: "Quién se especializa en qué", note: `Cociente de especialización: la parte de las afiliaciones de un lugar que está en el sector, dividida entre esa parte en Galicia. ×2 es el doble de concentración que en Galicia. Cuenta a quienes <b>viven</b> allí, trabajen donde trabajen. Las ${SPEC_TOP} más especializadas quedan marcadas en el mapa.` });
  const specCtl = document.createElement("div");
  specCtl.className = "adv-row";
  specBody.appendChild(specCtl);
  const asked = params.industry === "agro" ? "agricultura" : params.industry;
  let sector = sectorBy.get(asked) || sectorBy.get("industria");
  let specLevel = states;
  const sectorSel = selectBox(specCtl, {
    label: "Sector", value: sector.key,
    options: SECTORS.map((s) => ({ value: s.key, label: s.label })),
    onChange: (v) => setSector(v),
  });
  segmented(specCtl, {
    label: "Nivel de especialización", value: "states", options: [...levelOptions].reverse(),
    onChange: (v) => { specLevel = data.levels[v]; setSector(sector.key); },
  });
  const specInfo = document.createElement("p");
  specInfo.className = "adv-note";
  specBody.appendChild(specInfo);
  const lq = (r) => ratio(share(r.v, sector), share(g, sector));
  const specCols = (max) => [
    nameCol(specLevel),
    { key: "share", label: "Peso", title: "Parte de sus afiliaciones que está en el sector (ordenar)", value: (r) => share(r.v, sector), text: (r) => pct(share(r.v, sector)) },
    { key: "lq", label: "Cociente", short: "Cocien&shy;te", value: lq, text: (r) => (fin(lq(r)) ? `×${dec(lq(r), 2)}` : "–"), bar: { max, color: "rgba(74,134,214,.45)" } },
    { key: "workers", label: "Afiliados", short: "Afilia&shy;dos", value: (r) => r.v[sector.col], text: (r) => int(r.v[sector.col]) },
  ];
  const specTable = createTable(specBody, {
    caption: "Lugares más especializados", rank: true, maxHeight: 260, rows: [], columns: specCols(1), sort: { key: "lq", dir: "desc" },
    onHover: (r) => { link.hover(r ? rowsHighlight(specLevel, [r]) : null); bubbles.setHot(r ? r.key : null); },
    onClick: (r) => specLevel.focus(r),
  });

  function setSector(k) {
    sector = sectorBy.get(k) || sector;
    sectorSel.set(sector.key);
    const list = specLevel.rows.filter((r) => fin(lq(r))).sort((a, b) => lq(b) - lq(a));
    specTable.setColumns(specCols(Math.max(1, ...list.map(lq))), { key: "lq", dir: "desc" });
    specTable.setRows(list);
    specInfo.innerHTML = `Galicia: <b>${pct(share(g, sector))}</b> de las afiliaciones (${int(g[sector.col])}) están en ${esc(sector.label.toLowerCase())}.`;
    link.base(specHighlight());
    secBars.setSelected(sector.key);
    if (scatter) drawScatter();
  }
  function specHighlight() {
    const list = specLevel.rows.filter((r) => fin(lq(r))).sort((a, b) => lq(b) - lq(a));
    return rowsHighlight(specLevel, list.slice(0, SPEC_TOP), { ringMax: SPEC_TOP, label: `${sector.label}: más especializadas` });
  }
  setSector(sector.key);

  // --- growth vs output -----------------------------------------------------------------------------------------
  const scBody = section(el, { title: "Crecimiento frente a PIB", note: `Cada punto es una ciudad o una comarca: el PIB por habitante en horizontal, la variación de la población ${growthYears} en vertical y el tamaño según la población. Arrastra un rectángulo para seleccionar puntos y marcarlos en el mapa.` });
  const scCtl = document.createElement("div");
  scCtl.className = "adv-row";
  scBody.appendChild(scCtl);
  let scLevel = metros, colorBy = "lq";
  segmented(scCtl, { label: "Puntos", value: "metros", options: levelOptions, onChange: (v) => { scLevel = data.levels[v]; scatter.setSelected(null); brushInfo.innerHTML = ""; link.base(specHighlight()); drawScatter(); } });
  selectBox(scCtl, {
    label: "Color", value: colorBy,
    options: [{ value: "lq", label: "Especialización (sector elegido)" }, { value: "unemployment", label: "Paro registrado" }, { value: "none", label: "Ninguno" }],
    onChange: (v) => { colorBy = v; drawScatter(); },
  });
  scatter = createScatter(scBody, {
    points: [], height: 300,
    x: { label: "PIB por habitante", fmt: (v) => money(v), log: true },
    y: { label: "Variación de la población", fmt: (v) => fmtShort("signed", v) },
    size: { label: "Habitantes", fmt: count3, max: 15, min: 2 },
    refY: [{ v: g.growth ?? 0, label: `Galicia ${signedPct(g.growth)}` }],
    ariaLabel: "Diagrama de dispersión: variación de la población frente a PIB por habitante",
    onHover: (p) => { link.hover(p ? rowsHighlight(scLevel, [p.row]) : null); bubbles.setHot(p ? p.key : null); if (leadLevel === scLevel) table.setHot(p ? p.key : null, false); },
    onClick: (p) => scLevel.focus(p.row),
    onBrush: (set) => {
      const sel = set ? scLevel.rows.filter((r) => set.has(r.key)) : [];
      link.base(sel.length ? rowsHighlight(scLevel, sel, { dim: true }) : specHighlight(), { frame: sel.length > 1 });
      brushInfo.innerHTML = sel.length ? brushSummary(sel) : "";
    },
  });
  const legendEl = document.createElement("div");
  scBody.appendChild(legendEl);
  const brushInfo = document.createElement("div");
  brushInfo.className = "adv-brushinfo";
  scBody.appendChild(brushInfo);
  function brushSummary(sel) {
    const pop = sel.reduce((a, r) => a + (r.v.population || 0), 0);
    const gdp = sel.reduce((a, r) => a + (r.v.gdp || 0), 0);
    return `<b>${sel.length}</b> seleccionados · ${count3(pop)} habitantes · ${money(gdp)} de PIB (${pct(ratio(gdp, g.gdp))} de Galicia) ${frameBtn()}<button type="button" class="adv-mini" data-clear>Quitar</button>`;
  }
  brushInfo.addEventListener("click", (e) => {
    if (e.target.closest("[data-clear]")) { scatter.setSelected(null); link.base(specHighlight()); brushInfo.innerHTML = ""; }
  });
  function drawScatter() {
    const list = scLevel.rows.filter((r) => fin(r.v.gdp_pc) && r.v.gdp_pc > 0 && fin(r.v.growth));
    const lqAt = (r) => ratio(share(r.v, sector), share(g, sector));
    const cv = (r) => (colorBy === "lq" ? lqAt(r) : colorBy === "none" ? null : r.v[colorBy]);
    let color = null, legend = "";
    if (colorBy !== "none") {
      const dom = robustDomain(list.map(cv), 0.03, colorBy === "lq") || [0, 1];
      const spec = colorBy === "lq"
        ? { type: "seq", domain: [Math.max(0.2, dom[0]), Math.max(1.5, dom[1])], log: true, ramp: RAMPS.seq }
        : { type: "seq", domain: dom, ramp: RAMPS.heat };
      const cs = colorScale(spec);
      color = (c) => cs(c);
      const f = colorBy === "lq" ? (v) => `×${dec(v, 1)}` : (v) => pct(v);
      legend = rampLegend({ ramp: spec.ramp, domain: spec.domain, fmt: f, log: spec.log, label: colorBy === "lq" ? `Especialización en ${sector.label.toLowerCase()}` : "Parados por habitante" });
    }
    const labels = [...list].sort((a, b) => (b.v.population || 0) - (a.v.population || 0)).slice(0, 7).map((r) => r.key);
    scatter.update({
      points: list.map((r) => ({ key: r.key, x: r.v.gdp_pc, y: r.v.growth, s: r.v.population, c: cv(r), label: r.name, sub: r.sub, row: r })),
      color, labels, colorLabel: colorBy === "none" ? null : colorBy === "lq" ? "Cociente" : "Paro",
    });
    legendEl.innerHTML = legend;
  }
  drawScatter();

  const covered = ratio(SECTORS.reduce((a, s) => a + (g[s.col] || 0), 0), g.affiliates);
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["ige_pib", "ige_afiliacion", "ine_padron", "ige_comarcas"], [
    "El PIB se cuenta en el concello donde se produce; las afiliaciones, en el concello donde vive la persona. No son la misma población trabajadora.",
    `El PIB es una estimación municipal del IGE para ${gdpYear} y la población es de ${popYear}: las cifras por habitante dividen datos de años distintos.`,
    `Las afiliaciones son las de un solo mes, ${MONTH}. Los cuatro sectores suman el ${pct(covered)} de las de Galicia; el resto no figura en ninguno.`,
    "El IGE oculta algún sector en concellos pequeños: ese dato no entra en la suma de su comarca.",
  ]));

  return {
    onMapHover(h) {
      const at = (level) => (h.cell >= 0 ? level.rowAtCell(h.cell)?.key ?? null : null);
      table.setHot(at(leadLevel));
      specTable.setHot(at(specLevel));
    },
  };
}
