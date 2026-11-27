// Territory advisor: land cover, altitude, the weather of 2025, burned area and flood zones.
import { t } from "../../../i18n.js";
import { esc, fin, clamp, rampColor } from "../core/util.js";
import { pct, int, dec } from "../core/fmt.js";
import { shareBar, barList, donut, histogram, smallMultiples } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, segmented, lensButton, sourcesHtml, topBy, frameBtn } from "../core/view.js";
import { fireYearLens } from "../core/lenses.js";
import { LAND_KEYS, LAND_LABEL, LAND_COLOR, rowsHighlight } from "../core/data.js";

const LENS_OF = { forest: "forest", crop: "farmland", pasture: "farmland", developed: "developed" };
// A cover counts as "much of it" on a hex from this share of the hex (the largest class alone is nearly always forest).
const MIN_SHARE = { forest: 75, crop: 25, pasture: 50, shrub: 25, wetland: 10, developed: 25 };
const HOVER = "#fff3c4";
const FIRE = "#f08a2a";
const WATER = "#4a8fbf";

const VINTAGE = {
  worldcover: t("ESA WorldCover 2021 v200 (10 m), muestreado cada 0,2 km"),
  mdt_ign: t("MDT del IGN, malla de 200 m"),
  meteogalicia: t("Observaciones mensuales de MeteoGalicia; aquí, el año 2025"),
};

const CLIMATE = [
  { key: "temp", label: t("Temperatura"), name: t("Temperatura media"), color: "#f5a45a", fmt: (v) => `${dec(v, 1)} °C` },
  { key: "precip", label: t("Lluvia"), name: t("Lluvia del año"), color: "#6fb3d6", fmt: (v) => `${int(v)} mm` },
  { key: "viento", label: t("Viento"), name: t("Viento medio"), color: "#8fbfcf", fmt: (v) => `${dec(v, 1)} m/s` },
  { key: "sol", label: t("Sol"), name: t("Horas de sol"), color: "#d9b25a", fmt: (v) => `${int(v)} h` },
  { key: "humedad", label: t("Humedad"), name: t("Humedad relativa"), color: "#5fa9a9", fmt: (v) => pct(v, 0) },
];

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const w = app.w;
  const P = w.raw.pct || {};
  const { states, metros, counties } = data.levels;
  const G = data.galicia;
  const land = data.landCells;
  const valuesOf = (id) => app.lensById?.get(id)?.values || null;
  const levelOptions = [
    { value: "states", label: t("Comarcas") },
    { value: "metros", label: t("Ciudades") },
    ...(counties ? [{ value: "counties", label: t("Concellos") }] : []),
  ];
  const cleanTables = [];
  const mapHot = []; // fn(cell) per widget that follows the pointer on the map

  const div = (parent, cls = "") => {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    parent.appendChild(d);
    return d;
  };
  const statTiles = (items) => tiles(items).replace('class="adv-tiles"', 'class="adv-tiles" style="padding:4px 0 8px"');

  // Lens buttons keep their pressed state in step with each other and with the lens dock.
  const lensButtons = new Set();
  const addLens = (parent, id, label) => {
    const b = lensButton(app, id, label);
    if (!b) return;
    lensButtons.add(b);
    parent.appendChild(b);
  };
  ctx.on("lens", () => { for (const b of lensButtons) b._sync(); });

  // --- one pinned set of hexes at a time ------------------------------------------------------------------------
  let pinned = null; // {id, info, off}
  function pin(spec) {
    if (pinned) {
      pinned.info.innerHTML = "";
      pinned.off?.();
      pinned = null;
    }
    if (!spec) { link.base(null); return; }
    pinned = spec;
    link.base({ cells: spec.cells, dimOthers: true, color: spec.color }, { frame: true });
    spec.info.innerHTML = `${spec.html} ${spec.lens && app.lensById?.has(spec.lens) ? `<button type="button" class="adv-mini" data-lens="${esc(spec.lens)}">${t("Ver la lente {name}", { name: esc(app.lensById.get(spec.lens).name) })}</button>` : ""}${frameBtn()}<button type="button" class="adv-mini" data-clear>${t("Quitar")}</button>`;
  }
  el.addEventListener("click", (e) => {
    if (!e.target.closest(".adv-brushinfo")) return;
    if (e.target.closest("[data-clear]")) return pin(null);
    const l = e.target.closest("[data-lens]")?.dataset.lens;
    if (l) app.setLens(l);
  });
  const hoverCells = (cells, label) => link.hover(cells?.size ? { cells, dimOthers: true, color: HOVER, label, noBeacon: true } : null);
  const cellsWhere = (values, test) => new Set(values ? land.filter((i) => fin(values[i]) && test(values[i])) : []);

  /** Highest (and optionally lowest) places for one measure, with a level switch. */
  function ranking(parent, { get, fmt, color, n = 8, low = false, highTitle = "", only = null, empty = t("Sin datos.") }) {
    let level = "states";
    let lists = [];
    let current = get;
    let format = fmt;
    let tint = color;
    const ctl = div(parent, "adv-row");
    segmented(ctl, { label: t("Lugares"), value: level, options: levelOptions, onChange: (v) => { level = v; draw(); } });
    const host = div(parent);
    function draw() {
      host.innerHTML = "";
      const lv = data.levels[level];
      const get1 = (r) => {
        const v = current(r);
        return only && !(fin(v) && only(v)) ? null : v;
      };
      const high = topBy(lv.rows, get1, { n });
      const max = Math.max(1e-12, ...high.map((x) => x.v));
      const make = (title, list) => {
        if (title) host.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${esc(title)}</h4>`);
        if (!list.length) { host.insertAdjacentHTML("beforeend", `<p class="adv-empty">${esc(empty)}</p>`); return null; }
        return barList(host, {
          rank: true, max, ariaLabel: title || t("Clasificación"),
          rows: list.map((x) => ({ key: x.r.key, label: x.r.name, sub: level === "states" ? "" : x.r.sub, value: x.v, text: format(x.v), color: tint, row: x.r })),
          onHover: (r) => link.hover(r ? rowsHighlight(lv, [r.row]) : null),
          onClick: (r) => lv.focus(r.row),
        });
      };
      lists = [make(low ? t("Valores más altos") : highTitle, high), low ? make(t("Valores más bajos"), topBy(lv.rows, get1, { n, asc: true })) : null].filter(Boolean);
    }
    draw();
    mapHot.push((cell) => {
      const r = cell >= 0 ? data.levels[level].rowAtCell(cell) : null;
      for (const l of lists) l.setHot(r ? r.key : null);
    });
    return {
      set(next) { current = next.get; format = next.fmt; tint = next.color; draw(); },
    };
  }

  /** A histogram over the land hexes of one lens; hovering a bar lights up its hexes. */
  function cellHistogram(parent, lensId, { fmt, label, marker }) {
    const lens = app.lensById?.get(lensId);
    const values = lens?.values;
    if (!values) { parent.innerHTML = `<p class="adv-empty">${t("Sin datos.")}</p>`; return null; }
    const [d0, d1] = lens.domain || [0, 1];
    return histogram(parent, {
      values: land.map((i) => ({ key: i, v: values[i] })), bins: 30, height: 112, fmt, label, unitLabel: t("casillas"),
      colorOf: (v) => rampColor(lens.ramp, clamp((v - d0) / (d1 - d0 || 1), 0, 1)),
      markers: fin(marker) ? [{ v: marker, label: t("Media") }] : [],
      onHover: (bin) => hoverCells(bin ? new Set(bin.keys) : null, bin ? t("{a} a {b}", { a: fmt(bin.x0), b: fmt(bin.x1) }) : ""),
    });
  }
  const followHistogram = (get) => mapHot.push((cell) => {
    const { hist, values } = get();
    if (!hist) return;
    hist.setHot(cell >= 0 ? hist.binOf(values?.[cell])?.i ?? null : null);
  });

  // --- headline -------------------------------------------------------------------------------------------------
  el.insertAdjacentHTML("beforeend", tiles([
    { label: t("Bosque"), value: pct(G.forest, 0), sub: t("de la superficie"), color: LAND_COLOR.forest },
    { label: t("Cultivo y pasto"), value: pct(G.farmland, 0), sub: t("de la superficie"), color: LAND_COLOR.pasture },
    { label: t("Urbanizado"), value: pct(G.developed, 1), sub: t("de la superficie"), color: LAND_COLOR.developed },
  ]));

  // --- composition ----------------------------------------------------------------------------------------------
  const cBody = section(el, { title: t("Qué cubre Galicia"), kicker: "ESA WorldCover 2021", note: t("Parte de la superficie en cada tipo de suelo. Pasa el puntero por un tipo para ver las casillas donde abunda; púlsalo para dejarlas marcadas.") });
  const coverCells = new Map(LAND_KEYS.map((k) => [k, new Set(land.filter((i) => (P[k]?.[i] || 0) >= MIN_SHARE[k]))]));
  const sb = shareBar(cBody, {
    parts: LAND_KEYS.map((k) => ({ key: k, label: LAND_LABEL[k], value: G[k], color: LAND_COLOR[k], text: pct(G[k]) })).sort((a, b) => b.value - a.value),
    onHover: (p) => hoverCells(p ? coverCells.get(p.key) : null, p ? t("{label}: {n} % o más", { label: p.label, n: MIN_SHARE[p.key] }) : ""),
    onClick: (p) => {
      const k = p.key;
      if (pinned?.id === `cover-${k}`) return pin(null);
      const cells = coverCells.get(k);
      pin({
        id: `cover-${k}`, cells, color: LAND_COLOR[k], info: coverInfo, lens: LENS_OF[k], off: () => sb.setSelected(null),
        html: t("<b>{label}</b>: ocupa el {n} % o más de <b>{cells}</b> casillas ({share} de las de tierra).", { label: esc(LAND_LABEL[k]), n: MIN_SHARE[k], cells: int(cells.size), share: pct(cells.size / land.length, 1) }),
      });
      sb.setSelected(k);
    },
  });
  const cellInfo = div(cBody, "adv-note");
  cellInfo.style.minHeight = "2.8em";
  const cellText = (cell) => {
    if (!(cell >= 0 && w.raw.owner[cell] >= 0)) return t("Señala una casilla del mapa para ver su reparto.");
    const list = LAND_KEYS.map((k) => [k, P[k]?.[cell] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return list.length ? t("En la casilla señalada: {lista}.", { lista: list.map(([k, v]) => `${LAND_LABEL[k].toLowerCase()} ${int(v)} %`).join(", ") }) : t("La casilla señalada no tiene datos de suelo.");
  };
  cellInfo.textContent = cellText(-1);
  mapHot.push((cell) => { cellInfo.textContent = cellText(cell); });
  const coverInfo = div(cBody, "adv-brushinfo");
  const lensRow = div(cBody, "adv-row");
  for (const id of ["forest", "farmland", "developed"]) addLens(lensRow, id);

  // --- place by place -------------------------------------------------------------------------------------------
  const sBody = section(el, { title: t("El suelo, lugar a lugar"), note: t("Elige el nivel y el tipo de suelo para ordenar. Pasa el puntero por un lugar para verlo en el mapa; púlsalo para abrirlo.") });
  const sCtl = div(sBody, "adv-row");
  const sortRow = div(sBody, "adv-row");
  const sHost = div(sBody);
  const sNote = div(sBody, "adv-note");
  let sLevel = "states", sortKey = "forest", shape = "table";
  let table = null, grid = null;
  const keysOf = (lv) => LAND_KEYS.filter((k) => lv.field(k));
  const short = (k) => (k === "developed" ? t("Urbano") : LAND_LABEL[k]);
  const comp = (keys) => (r) => `<span class="adv-minibar">${keys.map((k) => {
    const v = r.v[k];
    return fin(v) && v > 0 ? `<i style="width:${(v * 100).toFixed(2)}%;background:${LAND_COLOR[k]}" title="${esc(`${LAND_LABEL[k]} ${pct(v)}`)}"></i>` : "";
  }).join("")}</span>`;
  segmented(sCtl, { label: t("Lugares"), value: sLevel, options: levelOptions, onChange: (v) => { sLevel = v; drawPlaces(); } });
  const shapeSeg = segmented(sCtl, { label: t("Ver como"), value: shape, options: [{ value: "table", label: t("Tabla") }, { value: "grid", label: t("Anillos") }], onChange: (v) => { shape = v; drawPlaces(); } });
  function drawPlaces() {
    const lv = data.levels[sLevel];
    const keys = keysOf(lv);
    if (!keys.includes(sortKey)) sortKey = "forest";
    shapeSeg.el.style.display = sLevel === "states" ? "" : "none";
    sortRow.innerHTML = "";
    const sortSeg = segmented(sortRow, { label: t("Ordenar por"), value: sortKey, options: keys.map((k) => ({ value: k, label: short(k) })), onChange: (k) => { sortKey = k; drawPlaces(); sortRow.querySelector(`[data-v="${k}"]`)?.focus(); } });
    sortSeg.el.style.flexWrap = "wrap";
    table?.destroy();
    table = null;
    grid = null;
    sHost.innerHTML = "";
    const rows = lv.rows.filter((r) => keys.some((k) => fin(r.v[k])));
    sNote.textContent = sLevel === "states" ? "" : t("En ciudades y concellos solo hay bosque, cultivo, pasto y suelo urbanizado: el hueco de cada barra es el resto. Una ciudad cuenta su concello entero.");
    const k = sortKey;
    if (sLevel === "states" && shape === "grid") {
      const sorted = [...rows].sort((a, b) => (b.v[k] ?? -1) - (a.v[k] ?? -1));
      grid = smallMultiples(sHost, {
        min: 92,
        items: sorted.map((r) => ({ key: r.key, label: r.name, row: r })),
        render: (cell, it) => donut(cell, {
          interactive: false, size: 62, thickness: 12,
          parts: keys.map((x) => ({ key: x, label: LAND_LABEL[x], value: it.row.v[x], color: LAND_COLOR[x] })),
          center: { big: pct(it.row.v[k], 0), small: "" },
          ariaLabel: `${it.row.name}: ${keys.map((x) => `${LAND_LABEL[x]} ${pct(it.row.v[x], 0)}`).join(", ")}`,
        }),
        onHover: (it) => link.hover(it ? rowsHighlight(lv, [it.row]) : null),
        onClick: (it) => lv.focus(it.row),
      });
      return;
    }
    table = createTable(sHost, {
      caption: lv.id === "metros" ? t("Suelo por ciudad") : lv.id === "states" ? t("Suelo por comarca") : t("Suelo por concello"), rank: true, maxHeight: 300, rows, sort: { key: "share", dir: "desc" },
      search: sLevel === "states" ? null : lv.id === "metros" ? t("Buscar ciudad") : t("Buscar concello"),
      columns: [
        { key: "name", label: lv.id === "metros" ? t("Ciudad") : lv.id === "states" ? t("Comarca") : t("Concello"), align: "l", width: "minmax(0,1.3fr)", value: (r) => r.name, text: (r) => r.name },
        { key: "comp", label: t("Reparto"), align: "l", width: "minmax(0,1.5fr)", value: (r) => r.v[k], html: comp(keys), tip: () => null, title: t("Ordenar por {tipo}", { tipo: LAND_LABEL[k].toLowerCase() }) },
        { key: "share", label: short(k), width: "minmax(0,.9fr)", value: (r) => r.v[k], html: (r) => `<span class="dot" style="background:${LAND_COLOR[k]}"></span>${pct(r.v[k], r.v[k] < 0.1 ? 1 : 0)}` },
      ],
      onHover: (r) => link.hover(r ? rowsHighlight(lv, [r]) : null),
      onClick: (r) => lv.focus(r),
    });
  }
  drawPlaces();
  cleanTables.push(() => table?.destroy());
  mapHot.push((cell) => {
    const r = cell >= 0 ? data.levels[sLevel].rowAtCell(cell) : null;
    table?.setHot(r ? r.key : null);
    grid?.setHot(r ? r.key : null);
  });

  // --- altitude -------------------------------------------------------------------------------------------------
  const elevation = valuesOf("elevation");
  if (elevation) {
    const aBody = section(el, { title: t("Altitud"), note: t("Casillas según su altitud media (MDT del IGN). Pasa el puntero por una barra para verlas.") });
    const known = land.filter((i) => fin(elevation[i]));
    const below = known.filter((i) => elevation[i] < 400).length / (known.length || 1);
    const top = known.reduce((m, i) => Math.max(m, elevation[i]), 0);
    aBody.insertAdjacentHTML("beforeend", statTiles([
      { label: t("Altitud media ≈"), value: `${int(G.elevation)} m`, sub: t("de las casillas") },
      { label: t("Bajo 400 m ≈"), value: pct(below, 0), sub: t("de las casillas") },
      { label: t("Casilla más alta"), value: `${int(top)} m`, sub: t("media de la casilla") },
    ]));
    addLens(div(aBody, "adv-row"), "elevation");
    const hist = cellHistogram(div(aBody), "elevation", { fmt: (v) => `${int(v)} m`, label: t("Casillas por altitud"), marker: G.elevation });
    followHistogram(() => ({ hist, values: elevation }));
    ranking(aBody, { get: (r) => r.v.elevation, fmt: (v) => `${int(v)} m`, color: "#a9b85a", n: 5, low: true });
  }

  // --- weather --------------------------------------------------------------------------------------------------
  const wBody = section(el, { title: t("El tiempo de 2025"), note: t("Medidas de las estaciones de MeteoGalicia, interpoladas a las casillas. Es un solo año, no el clima normal.") });
  let variable = CLIMATE[0];
  const vRow = div(wBody, "adv-row");
  const wTiles = div(wBody);
  const wLens = div(wBody, "adv-row");
  const wHist = div(wBody);
  const wRank = div(wBody);
  let weatherHist = null;
  const vSeg = segmented(vRow, { label: t("Medida"), value: variable.key, options: CLIMATE.map((c) => ({ value: c.key, label: c.label })), onChange: (k) => { variable = CLIMATE.find((c) => c.key === k); drawWeather(); } });
  vSeg.el.style.flexWrap = "wrap";
  const rank = ranking(wRank, { get: (r) => r.v[variable.key], fmt: variable.fmt, color: variable.color, n: 6, low: true });
  function drawWeather(first = false) {
    const c = variable;
    const values = valuesOf(c.key);
    let lo = Infinity, hi = -Infinity;
    for (const i of land) if (fin(values?.[i])) { lo = Math.min(lo, values[i]); hi = Math.max(hi, values[i]); }
    wTiles.innerHTML = statTiles([
      { label: t("Galicia ≈"), value: fin(G[c.key]) ? c.fmt(G[c.key]) : t("Sin dato"), sub: t("media de las casillas"), color: c.color },
      { label: t("Mínimo"), value: fin(lo) ? c.fmt(lo) : t("Sin dato"), sub: t("en una casilla") },
      { label: t("Máximo"), value: fin(hi) ? c.fmt(hi) : t("Sin dato"), sub: t("en una casilla") },
    ]);
    for (const b of lensButtons) if (wLens.contains(b)) lensButtons.delete(b);
    wLens.innerHTML = "";
    addLens(wLens, c.key);
    wHist.innerHTML = "";
    weatherHist = cellHistogram(wHist, c.key, { fmt: c.fmt, label: t("Casillas por {medida}", { medida: c.name.toLowerCase() }), marker: G[c.key] });
    if (!first) rank.set({ get: (r) => r.v[c.key], fmt: c.fmt, color: c.color });
    // A weather lens already on the map follows the chosen measure.
    const on = app.state.lens?.id;
    if (!first && on !== c.key && CLIMATE.some((x) => x.key === on) && app.lensById?.has(c.key)) app.setLens(c.key);
  }
  drawWeather(true);
  followHistogram(() => ({ hist: weatherHist, values: valuesOf(variable.key) }));

  /** "Incendios, año a año": hectares per year, a slider and a play button. The chosen year colours the map. */
  function fireTimeline(parent) {
    parent.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${t("Incendios, año a año")}</h4>
      <p class="adv-note">${t("Elige un año para ver en el mapa lo que ardió entonces. EFFIS cartografía los incendios desde unas 30 ha: los más pequeños no salen. Quedan fuera los que EFFIS sitúa en León, Asturias o Portugal.")}</p>`);
    const host = div(parent, "adv-fireyears");
    host.innerHTML = `<p class="adv-empty">${t("Cargando los años…")}</p>`;
    let fires = null, year = null, timer = 0, gone = false;
    let ui = null;
    let wanted = null; // a year asked for by the link before the file arrived

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = 0;
      ui?.play.setAttribute("aria-pressed", "false");
      if (ui) ui.play.textContent = t("Reproducir");
    };
    function select(y) {
      if (!fires || !fires.years.includes(y)) return;
      const lens = fireYearLens(data, fires, y);
      if (!lens) return;
      year = y;
      show();
      ctx.setLens(lens);
    }
    // Paint the controls for the current year without touching the map.
    function show() {
      if (!ui) return;
      const k = fires.years.indexOf(year);
      ui.range.value = String(year ?? fires.years[fires.years.length - 1]);
      ui.label.textContent = year == null ? t("Sin año") : String(year);
      ui.bars.setSelected(year == null ? null : String(year));
      if (k < 0) { ui.line.textContent = t("Elige un año con la barra, el control o Reproducir."); return; }
      const b = fires.by_year[k];
      ui.line.textContent = t("{n} perímetros, {ha} ha, {cells} casillas", { n: int(b.n), ha: int(b.ha), cells: int(b.cells_touched) });
    }
    function play() {
      if (timer) return stop();
      const ys = fires.years;
      let k = year == null ? -1 : ys.indexOf(year);
      if (k < 0 || k >= ys.length - 1) k = -1;
      const step = () => {
        k++;
        select(ys[k]);
        if (k >= ys.length - 1) stop();
      };
      step();
      if (k >= ys.length - 1) return;
      const slow = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      ui.play.setAttribute("aria-pressed", "true");
      ui.play.textContent = t("Parar");
      timer = setInterval(step, slow ? 2000 : 1000);
    }

    const unregister = app.hash.register("fireyear", {
      get: () => (year != null && app.state.lens?.id === `adv-fire-${year}` ? String(year) : null),
      set(v) {
        const y = Number(v);
        if (!v) { wanted = null; stop(); if (year != null) { year = null; show(); } return; }
        if (!fires) { wanted = y; return; }
        stop();
        select(y);
      },
    });
    // The map may already show a fire-year lens (a #lens= link, or the dock): follow it.
    const follow = () => {
      const m = /^adv-fire-(\d{4})$/.exec(app.state.lens?.id || "");
      const y = m ? Number(m[1]) : null;
      if (!fires) { if (y) wanted = y; return; }
      if (y !== year && (y == null || fires.years.includes(y))) { year = y; show(); }
    };
    ctx.on("lens", follow);
    // Any click in the view stops the play, except on its own button.
    const onClick = (e) => { if (!e.target.closest("[data-fire-play]")) stop(); };
    el.addEventListener("click", onClick, true);
    ctx.cleanup(() => { gone = true; stop(); unregister(); el.removeEventListener("click", onClick, true); });

    app.loadData("fires").catch(() => null).then((f) => {
      if (gone) return;
      if (!f?.years?.length) { host.innerHTML = `<p class="adv-empty">${t("No se han podido cargar los datos año a año.")}</p>`; return; }
      fires = f;
      host.innerHTML = "";
      const first = f.years[0], last = f.years[f.years.length - 1];
      const bars = barList(host, {
        compact: true, ariaLabel: t("Hectáreas quemadas por año"),
        rows: f.years.map((y, k) => ({ key: String(y), label: String(y), value: f.by_year[k].ha, text: `${int(f.by_year[k].ha)} ha`, color: FIRE })),
        onClick: (r) => { stop(); select(Number(r.key)); },
      });
      const ctl = div(host, "adv-fire-ctl");
      ctl.innerHTML = `<button type="button" class="adv-mini" data-fire-play aria-pressed="false">${t("Reproducir")}</button>
        <input type="range" min="${first}" max="${last}" step="1" value="${last}" aria-label="${esc(t("Año de los incendios"))}">
        <output class="adv-fire-year" aria-live="polite"></output>`;
      ui = { bars, range: ctl.querySelector("input"), label: ctl.querySelector("output"), play: ctl.querySelector("button"), line: div(host, "adv-brushinfo adv-fire-line") };
      ui.play.addEventListener("click", play);
      ui.range.addEventListener("input", () => { stop(); select(Number(ui.range.value)); });
      follow();
      if (wanted != null) { const y = wanted; wanted = null; if (y !== year) select(y); }
      show();
    });
  }

  // --- fire -----------------------------------------------------------------------------------------------------
  const burned = valuesOf("incendios");
  if (burned) {
    const fBody = section(el, { title: t("Superficie quemada, 2016 a 2025"), note: t("Perímetros de EFFIS vistos por satélite. Una zona que ardió dos veces cuenta una sola vez.") });
    const any = cellsWhere(burned, (v) => v > 0);
    const half = cellsWhere(burned, (v) => v >= 0.5);
    fBody.insertAdjacentHTML("beforeend", statTiles([
      { label: t("Quemado ≈"), value: pct(G.incendios, 1), sub: t("de la superficie"), color: FIRE },
      { label: t("Casillas tocadas"), value: int(any.size), sub: t("{share} de las de tierra", { share: pct(any.size / land.length, 0) }) },
      { label: t("Media casilla o más"), value: int(half.size), sub: t("casillas") },
    ]));
    const row = div(fBody, "adv-row");
    addLens(row, "incendios");
    addLens(row, "incendio_anyo");
    const years = app.lensById.get("incendio_anyo");
    const byYear = years?.categories?.map((c, i) => ({ c, cells: cellsWhere(years.values, (v) => v === i) }));
    if (byYear?.length) {
      fBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${t("Casillas según el año de su mayor incendio")}</h4>`);
      const yearBars = barList(div(fBody), {
        compact: true, ariaLabel: t("Casillas según el año de su mayor incendio"),
        rows: byYear.map(({ c, cells }) => ({ key: c.id, label: c.name, value: cells.size, text: cells.size === 1 ? t("{n} casilla", { n: int(cells.size) }) : t("{n} casillas", { n: int(cells.size) }), color: FIRE, cells })),
        onHover: (r) => hoverCells(r?.cells, r ? t("Incendios de {anyo}", { anyo: r.label }) : ""),
        onClick: (r) => {
          if (pinned?.id === `year-${r.key}` || !r.cells.size) return pin(null);
          pin({
            id: `year-${r.key}`, cells: r.cells, color: FIRE, info: fireInfo, off: () => yearBars.setSelected(null),
            html: r.cells.size === 1 ? t("<b>{label}</b>: año del mayor incendio en <b>{n}</b> casilla.", { label: esc(r.label), n: int(r.cells.size) }) : t("<b>{label}</b>: año del mayor incendio en <b>{n}</b> casillas.", { label: esc(r.label), n: int(r.cells.size) }),
          });
          yearBars.setSelected(r.key);
        },
      });
      mapHot.push((cell) => {
        const v = cell >= 0 ? years.values?.[cell] : null;
        yearBars.setHot(fin(v) ? years.categories[v]?.id ?? null : null);
      });
    }
    const fireInfo = div(fBody, "adv-brushinfo");
    fireTimeline(fBody);
    fBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${t("Dónde pesa más")}</h4>`);
    ranking(fBody, { get: (r) => r.v.incendios, fmt: (v) => pct(v, 1), color: FIRE, only: (v) => v > 0, empty: t("Sin superficie quemada registrada.") });
  }

  // --- floods ---------------------------------------------------------------------------------------------------
  const flood = valuesOf("inundacion");
  if (flood) {
    const iBody = section(el, { title: t("Zonas inundables"), note: t("Superficie dentro de la lámina de inundación con 100 años de periodo de retorno (SNCZI). La lámina incluye el propio cauce.") });
    const any = cellsWhere(flood, (v) => v > 0);
    iBody.insertAdjacentHTML("beforeend", statTiles([
      { label: t("En lámina ≈"), value: pct(G.inundacion, 1), sub: t("de la superficie"), color: WATER },
      { label: t("Casillas tocadas"), value: int(any.size), sub: t("{share} de las de tierra", { share: pct(any.size / land.length, 0) }) },
    ]));
    const row = div(iBody, "adv-row");
    addLens(row, "inundacion");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "adv-mini";
    b.textContent = t("Marcar las casillas tocadas");
    b.setAttribute("aria-pressed", "false");
    row.appendChild(b);
    const floodInfo = div(iBody, "adv-brushinfo");
    b.addEventListener("click", () => {
      if (pinned?.id === "flood") return pin(null);
      pin({
        id: "flood", cells: any, color: WATER, info: floodInfo, off: () => b.setAttribute("aria-pressed", "false"),
        html: t("<b>{n}</b> casillas tienen algo de zona inundable.", { n: int(any.size) }),
      });
      b.setAttribute("aria-pressed", "true");
    });
    iBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${t("Dónde pesa más")}</h4>`);
    ranking(iBody, { get: (r) => r.v.inundacion, fmt: (v) => pct(v, 1), color: WATER, only: (v) => v > 0, empty: t("Sin lámina cartografiada.") });
  }

  // Some vintages in sources.json are written in English and run past the dock: say them here in Spanish and let them wrap.
  const sourced = { source: (id) => { const s = data.source(id); return s && VINTAGE[id] ? { ...s, vintage: VINTAGE[id] } : s; } };
  el.insertAdjacentHTML("beforeend", sourcesHtml(sourced, ["worldcover", "mdt_ign", "meteogalicia", "effis", "snczi"], [
    t("WorldCover no distingue especies de árbol: bosque junta roble, pino y eucalipto. Los prados salen como pasto."),
    t("Las cifras de suelo, altitud, incendios e inundación se calculan sobre casillas de la malla, así que son aproximadas en lugares pequeños."),
    t("El tiempo se interpola desde las estaciones más próximas. Solo la temperatura se corrige por altitud; el viento y el sol son orientativos lejos de una estación."),
    t("EFFIS detecta con fiabilidad los incendios desde unas 30 ha: la mayoría de los pequeños no salen."),
    t("Solo hay lámina de inundación en los tramos de río y costa estudiados: un cero no significa que no haya riesgo."),
  ]));
  for (const v of el.querySelectorAll(".adv-sources .v")) v.style.whiteSpace = "normal";

  return {
    onMapHover(h) {
      for (const f of mapHot) f(h.cell);
    },
    onEscape() {
      if (pinned) { pin(null); return true; }
      return false;
    },
    destroy() {
      for (const f of cleanTables) f();
    },
  };
}
