// Asesor de Prosperidad: renta por persona frente a PIB por habitante, desigualdad (Gini, P80/P20) y paro registrado.
import { esc, fin, quantile, colorScale, RAMPS } from "../core/util.js";
import { compact, euros, money, pct, int, count3, dec, fmtShort } from "../core/fmt.js";
import { barList, histogram } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, lensButton, sourcesHtml, topBy, frameBtn } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MEASURES = {
  gini: { label: "Gini", fmt: (v) => dec(v, 1) },
  p80p20: { label: "P80/P20", fmt: (v) => dec(v, 2) },
};

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const g = data.galicia;
  const { counties } = data.levels;

  // "IGE paro rexistrado 2026-10 (SISPE)" → "octubre de 2026"
  const paroDate = /(\d{4})-(\d{2})/.exec(data.source("ige_paro")?.vintage || "");
  const paroWhen = paroDate ? `${MONTHS[+paroDate[2] - 1]} de ${paroDate[1]}` : "";

  el.insertAdjacentHTML("beforeend", tiles([
    { label: "Renta media ≈", value: euros(g.renta_pc), sub: "por persona, 2024" },
    { label: "Paro registrado", value: pct(g.unemployment), sub: "de los habitantes" },
    { label: "PIB por habitante", value: euros(g.gdp_pc), sub: "PIB de 2023" },
  ]));

  // Every lens button follows the lens on the map, whichever control changed it.
  const lensBtns = [];
  function lensRow(host, list) {
    const row = document.createElement("div");
    row.className = "adv-row";
    for (const [id, label] of list) {
      const b = lensButton(app, id, label);
      if (b) { row.appendChild(b); lensBtns.push(b); }
    }
    host.appendChild(row);
    return row;
  }
  ctx.on("lens", () => { for (const b of lensBtns) b._sync(); });

  // --- renta frente a PIB por habitante -------------------------------------------------------------------------
  const aBody = section(el, { title: "Lo que se produce y lo que se ingresa", note: "El PIB por habitante cuenta lo producido donde se produce; la renta, lo que reciben quienes viven allí. Las líneas discontinuas marcan la cifra de Galicia. Arrastra un rectángulo para seleccionar lugares; pasa por el mapa para encontrar uno aquí." });
  let level = counties ? "counties" : "metros";
  const lv = () => data.levels[level];
  const aCtl = lensRow(aBody, [["renta_pc", "Lente de renta"], ["gdp_pc", "Lente de PIB por habitante"]]);
  const aSeg = segmented(aCtl, {
    label: "Lugares", value: level,
    options: [{ value: "states", label: "Comarcas" }, { value: "metros", label: "Ciudades" }, ...(counties ? [{ value: "counties", label: "Concellos" }] : [])],
    onChange: (v) => { level = v; drawIncome(); },
  });
  aCtl.prepend(aSeg.el);

  // Renta goes up the side with short ticks ("18 mil"), so they clear the axis title.
  const rentaAxis = () => ({ label: level === "states" ? "Renta por persona ≈ (€)" : "Renta por persona (€)", fmt: compact });
  const scatter = createScatter(aBody, {
    height: 310, points: [],
    x: { label: "PIB por habitante", fmt: money, log: true },
    y: rentaAxis(),
    size: { label: "Habitantes", fmt: count3, max: 14, min: 1.4 },
    refX: fin(g.gdp_pc) ? [{ v: g.gdp_pc }] : [],
    refY: fin(g.renta_pc) ? [{ v: g.renta_pc, label: "Galicia" }] : [],
    onHover: (p) => { link.hover(p ? rowsHighlight(lv(), [p.row]) : null); incTable.setHot(p ? p.key : null, false); },
    onClick: (p) => lv().focus(p.row),
    onBrush: (set) => {
      const sel = set ? lv().rows.filter((r) => set.has(r.key)) : [];
      link.base(sel.length ? rowsHighlight(lv(), sel, { dim: true }) : null, { frame: sel.length > 1 });
      incTable.setSelected(set);
      const noun = sel.length === 1 ? `${lv().noun} seleccionad${level === "counties" ? "o" : "a"}` : `${lv().label.toLowerCase()} seleccionad${level === "counties" ? "os" : "as"}`;
      selInfo.innerHTML = sel.length ? `<b>${int(sel.length)}</b> ${noun} · ${count3(sel.reduce((a, r) => a + (r.v.population || 0), 0))} habitantes ${frameBtn()}<button type="button" class="adv-mini" data-clear>Quitar selección</button>` : "";
    },
  });
  const selInfo = document.createElement("div");
  selInfo.className = "adv-brushinfo";
  aBody.appendChild(selInfo);
  const clearSel = () => { scatter.setSelected(null); incTable.setSelected(null); link.base(null); selInfo.innerHTML = ""; };
  selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clearSel(); });
  aBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Tabla de renta y PIB</h4>`);
  const nameCol = { key: "name", label: "Lugar", align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>` };
  const popCol = { key: "population", label: "Habitantes", value: (r) => r.v.population, text: (r) => count3(r.v.population), hideBelow: 380 };
  const incTable = createTable(aBody, {
    caption: "Renta por persona y PIB por habitante", rank: true, maxHeight: 260, rows: [], search: "Buscar lugar",
    columns: [
      nameCol, popCol,
      { key: "renta_pc", label: "Renta", value: (r) => r.v.renta_pc, text: (r) => euros(r.v.renta_pc) },
      { key: "gdp_pc", label: "PIB/hab.", title: "Ordenar por PIB por habitante", value: (r) => r.v.gdp_pc, text: (r) => euros(r.v.gdp_pc) },
    ],
    sort: { key: "renta_pc", dir: "desc" },
    onHover: (r) => { link.hover(r ? rowsHighlight(lv(), [r]) : null); scatter.setHot(r ? r.key : null); },
    onClick: (r) => lv().focus(r),
  });
  function drawIncome() {
    clearSel();
    const rows = lv().rows.filter((r) => fin(r.v.renta_pc) && fin(r.v.gdp_pc));
    // Name the biggest places and the top of each axis.
    const labels = [
      ...topBy(rows, (r) => r.v.gdp_pc, { n: 2 }),
      ...topBy(rows, (r) => r.v.renta_pc, { n: 1 }),
      ...topBy(rows, (r) => r.v.population, { n: 5 }),
    ].map((x) => x.r.key);
    scatter.update({
      // Only the concellos spread widely enough for a log axis (a short log range gets no round ticks).
      x: { label: "PIB por habitante", fmt: money, log: level === "counties" },
      y: rentaAxis(),
      points: rows.map((r) => ({ key: r.key, x: r.v.gdp_pc, y: r.v.renta_pc, s: r.v.population, label: r.name, sub: r.sub, row: r })),
      labels: [...new Set(labels)],
    });
    incTable.setRows(rows);
  }
  drawIncome();

  // --- desigualdad ----------------------------------------------------------------------------------------------
  const dBody = section(el, { title: "Desigualdad", note: "Gini: de 0 (todos con la misma renta) a 100 (una sola persona la tiene toda). P80/P20: cuántas veces la renta del percentil 80 contiene la del percentil 20. Pasa por una barra para ver esos lugares en el mapa." });
  let dLevel = counties ? "counties" : "metros";
  let measure = "gini";
  const dlv = () => data.levels[dLevel];
  const dCtl = lensRow(dBody, [["gini", "Lente de Gini"], ["p80p20", "Lente P80/P20"]]);
  const mSeg = segmented(dCtl, {
    label: "Medida de desigualdad", value: measure,
    options: Object.entries(MEASURES).map(([value, m]) => ({ value, label: m.label })),
    onChange: (v) => { measure = v; drawHist(); ineqTable.setColumns(ineqCols(), { key: measure, dir: "desc" }); },
  });
  const dSeg = segmented(dCtl, {
    label: "Lugares", value: dLevel,
    options: [{ value: "metros", label: "Ciudades" }, ...(counties ? [{ value: "counties", label: "Concellos" }] : [])],
    onChange: (v) => { dLevel = v; link.hover(null); drawHist(); ineqTable.setColumns(ineqCols()); ineqTable.setRows(ineqRows()); },
  });
  dCtl.prepend(mSeg.el, dSeg.el);
  const dHost = document.createElement("div");
  dBody.appendChild(dHost);
  let hist = null;
  function drawHist() {
    dHost.innerHTML = "";
    const m = MEASURES[measure];
    const values = dlv().rows.map((r) => ({ key: r.key, v: r.v[measure] }));
    const median = quantile(values.map((d) => d.v).filter(fin).sort((a, b) => a - b), 0.5);
    const heat = colorScale({ type: "seq", domain: [0, 1], ramp: RAMPS.heat });
    hist = histogram(dHost, {
      values, bins: dLevel === "counties" ? 30 : 16, height: 120,
      fmt: (v) => fmtShort("float", v), unitLabel: dlv().label.toLowerCase(),
      label: `Histograma de ${m.label} por ${dlv().noun}`,
      colorOf: (_, t) => heat(0.2 + 0.8 * t),
      markers: fin(median) ? [{ v: median, label: `Mediana ${m.fmt(median)}` }] : [],
      onHover: (bin) => link.hover(bin && bin.keys.length ? rowsHighlight(dlv(), bin.keys.map((k) => dlv().byKey.get(k)), { dim: true }) : null),
    });
  }
  const ineqRows = () => dlv().rows.filter((r) => fin(r.v.gini) || fin(r.v.p80p20));
  const ineqCols = () => [
    nameCol, popCol,
    ...Object.entries(MEASURES).map(([key, m]) => ({
      key, label: m.label, value: (r) => r.v[key], text: (r) => (fin(r.v[key]) ? m.fmt(r.v[key]) : "–"),
      ...(key === measure ? { bar: { max: Math.max(...ineqRows().map((r) => r.v[key]).filter(fin)), color: "rgba(232,119,74,.4)" } } : {}),
    })),
  ];
  drawHist();
  const ineqTable = createTable(dBody, {
    caption: "Desigualdad de la renta", rank: true, maxHeight: 240, rows: ineqRows(), search: "Buscar lugar",
    columns: ineqCols(),
    sort: { key: measure, dir: "desc" },
    onHover: (r) => link.hover(r ? rowsHighlight(dlv(), [r]) : null),
    onClick: (r) => dlv().focus(r),
  });

  // --- paro registrado ------------------------------------------------------------------------------------------
  const uBody = section(el, { title: "Paro registrado", note: `Parados registrados por habitante${paroWhen ? ` en ${esc(paroWhen)}` : ""}. No es la tasa de paro: se divide entre toda la población, no entre la población activa. Galicia: ${pct(g.unemployment)}.` });
  let uLevel = "states";
  const uCtl = lensRow(uBody, [["unemployment", "Lente de paro"]]);
  const uSeg = segmented(uCtl, { label: "Lugares", value: uLevel, options: [{ value: "states", label: "Comarcas" }, { value: "metros", label: "Ciudades" }], onChange: (v) => { uLevel = v; link.hover(null); drawU(); } });
  uCtl.prepend(uSeg.el);
  const uHost = document.createElement("div");
  uBody.appendChild(uHost);
  function drawU() {
    uHost.innerHTML = "";
    const lvU = data.levels[uLevel];
    const high = topBy(lvU.rows, (r) => r.v.unemployment, { n: 8 });
    const low = topBy(lvU.rows, (r) => r.v.unemployment, { n: 8, asc: true });
    const max = Math.max(0, ...high.map((x) => x.v));
    const mk = (list) => list.map((x) => ({ key: x.r.key, label: x.r.name, sub: uLevel === "metros" ? x.r.sub : "", value: x.v, text: pct(x.v), tone: x.v > g.unemployment * 1.03 ? "bad" : x.v < g.unemployment * 0.97 ? "good" : null, row: x.r }));
    const o = { max, onHover: (r) => link.hover(r ? rowsHighlight(lvU, [r.row]) : null), onClick: (r) => lvU.focus(r.row) };
    uHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Donde hay más</h4>`);
    barList(uHost, { ...o, rows: mk(high), ariaLabel: "Más parados registrados por habitante" });
    uHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Donde hay menos</h4>`);
    barList(uHost, { ...o, rows: mk(low), ariaLabel: "Menos parados registrados por habitante" });
  }
  drawU();

  const noParo = (counties?.rows || []).filter((r) => !fin(r.v.unemployment)).map((r) => r.name);
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["ine_adrh", "ige_paro", "ige_pib", "ine_padron"], [
    "La renta es la renta neta media por persona de 2024, no la mediana. En las comarcas y en Galicia es la media de sus concellos ponderada por población: una aproximación (≈).",
    "El PIB por habitante divide el PIB de 2023 que el IGE estima por concello entre la población de 2025. Se atribuye al lugar donde se produce, así que no mide lo que ingresan sus vecinos.",
    "No hay Gini ni P80/P20 de Galicia ni de las comarcas: no se pueden calcular a partir de los concellos. La raya del histograma es la mediana de los lugares dibujados, sin ponderar por población.",
    "En los concellos pequeños unos pocos hogares o unas pocas personas mueven mucho la renta, la desigualdad y el paro por habitante.",
    ...(noParo.length ? [`Sin dato de paro: ${esc(noParo.join(" y "))}. El IGE da 0 en esos concellos fusionados, que es un dato ausente y no un cero; su comarca los deja fuera de la cuenta.`] : []),
  ]));

  ctx.cleanup(() => { scatter.destroy(); incTable.destroy(); ineqTable.destroy(); });

  return {
    onMapHover(h) {
      const at = (l) => (h.cell >= 0 ? l.rowAtCell(h.cell) : null);
      const r = at(lv());
      scatter.setHot(r ? r.key : null);
      incTable.setHot(r ? r.key : null);
      const d = at(dlv());
      ineqTable.setHot(d ? d.key : null);
      hist?.setHot(d ? hist.binOf?.(d.v[measure])?.i ?? null : null);
    },
    onEscape() {
      if (scatter.selected) { clearSel(); return true; }
      return false;
    },
  };
}
