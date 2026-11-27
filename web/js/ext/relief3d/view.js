// The full-screen layer of the relief view: canvas, header, controls, legend and cell tooltip around scene.js.
import { createReliefScene, DEFAULT_EXAGGERATION } from "./scene.js";
import {
  altitudeColors, soilColors, lensColors, SOIL, SEA, NO_DATA, ALTITUDE_STOPS, ALTITUDE_TOP, isLandOfGalicia,
} from "./colors.js";
import { RIVER } from "./rivers.js";
import { normalTerrain, loadDetail } from "./terrain.js";
import { css } from "../../color.js";
import { formatLensValue, formatLensTick } from "../../ui/lenses.js";
import { esc, int } from "../../format.js";
import { t } from "../../i18n.js";

const PHONE = "(max-width: 700px), (pointer: coarse) and (max-height: 500px)";
const SOIL_LEGEND = [
  [t("Bosque"), SOIL.forest], [t("Cultivo"), SOIL.crop], [t("Pasto"), SOIL.pasture], [t("Monte alto"), SOIL.mountain],
  [t("Roca"), SOIL.rock], [t("Urbano"), SOIL.developed], [t("Mar"), SEA.stops[2][1]],
];
const RIVER_CREDIT = t("Ríos: © colaboradores de OpenStreetMap.");
// Altitudes of the normal mesh (world.json) come from the same two sources.
const RELIEF_CREDIT = t("Obra derivada de MDT200 2015 CC-BY 4.0 ign.es. Mar y Portugal: NOAA ETOPO1.");
// The fine mesh is a derived work of these two: their licences ask for exactly these lines (LICENCIAS.md).
const DETAIL_CREDIT = t("Obra derivada de MDT200 2015 CC-BY 4.0 ign.es. Mar y Portugal: NOAA ETOPO1.") + " " +
  "© ESA WorldCover project / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.";
const DETAIL_LEGEND = [
  [t("Bosque"), "forest"], [t("Matorral"), "shrub"], [t("Pasto"), "pasture"], [t("Cultivo"), "crop"], [t("Monte alto"), "mountain"],
  [t("Urbano"), "developed"], [t("Suelo desnudo"), "rock"], [t("Humedal"), "wetland"],
];
const CLASS_NAMES = {
  10: t("Bosque"), 20: t("Matorral"), 30: t("Pasto"), 40: t("Cultivo"), 50: t("Urbano"), 60: t("Suelo desnudo"), 70: t("Nieve"),
  90: t("Humedal"), 95: t("Humedal"), 100: t("Musgo y liquen"),
};
const km = (v) => String(v).replace(".", ",");
const PCT_NAMES = {
  forest: t("Bosque"), crop: t("Cultivo"), pasture: t("Pasto"), grass: t("Pastizal"), shrub: t("Matorral"), wetland: t("Humedal"),
  developed: t("Urbano"),
};

const TEMPLATE = `
  <canvas class="r3d-canvas" tabindex="0" role="img"></canvas>
  <svg class="r3d-mark" aria-hidden="true"><polygon points=""/></svg>
  <header class="r3d-head">
    <button type="button" class="r3d-btn r3d-back"><span aria-hidden="true">←</span> ${t("Volver al mapa")}</button>
    <h2 id="r3d-title">${t("Relieve 3D")}</h2>
  </header>
  <section class="r3d-panel" aria-label="${t("Controles del relieve")}">
    <div class="r3d-field">
      <div class="r3d-label"><label for="r3d-exag">${t("Exageración de la altura")}</label><output class="r3d-num" for="r3d-exag"></output></div>
      <input id="r3d-exag" type="range" min="1" max="30" step="1">
    </div>
    <div class="r3d-field">
      <label class="r3d-label" for="r3d-color">${t("Color")}</label>
      <select id="r3d-color"></select>
    </div>
    <div class="r3d-field">
      <label class="r3d-label" for="r3d-detail">${t("Detalle")}</label>
      <select id="r3d-detail"><option value="normal">${t("Normal")}</option><option value="alto">${t("Alto")}</option></select>
      <p class="r3d-note" role="status" hidden></p>
    </div>
    <details class="r3d-legend">
      <summary>${t("Leyenda")}</summary>
      <div class="r3d-legend-body"></div>
    </details>
    <div class="r3d-row">
      <button type="button" class="r3d-btn r3d-reset">${t("Vista inicial")}</button>
      <div class="r3d-checks">
        <label class="r3d-check"><input type="checkbox" class="r3d-rivers" checked> ${t("Ríos")}</label>
        <label class="r3d-check"><input type="checkbox" class="r3d-curve" checked> ${t("Horizonte curvo")}</label>
      </div>
    </div>
    <p class="r3d-hint r3d-hint-mouse">${t("Arrastra para girar. Rueda para acercar. Botón derecho o Mayús para mover.")}</p>
    <p class="r3d-hint r3d-hint-touch">${t("Un dedo gira. Dos dedos mueven y acercan. Toca una celda para ver sus datos.")}</p>
  </section>
  <div class="r3d-tip" role="status" hidden></div>
  <div class="r3d-error" role="alert" hidden></div>`;

export function createView(app, { onClose }) {
  const w = app.w;
  const raw = w.raw;
  const lensFile = app.data.lenses || { groups: [], lenses: [] };
  const sources = app.data.sources || [];
  const byId = new Map(lensFile.lenses.map((l) => [l.id, l]));
  const phone = matchMedia(PHONE).matches;

  const root = document.createElement("div");
  root.className = "r3d";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "r3d-title");
  root.innerHTML = TEMPLATE;
  document.body.appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const canvas = $(".r3d-canvas"), head = $(".r3d-head"), panel = $(".r3d-panel"), tip = $(".r3d-tip");
  const slider = $("#r3d-exag"), output = $(".r3d-num"), select = $("#r3d-color");
  const legend = $(".r3d-legend"), legendBody = $(".r3d-legend-body"), riverBox = $(".r3d-rivers");
  const mark = $(".r3d-mark polygon");
  legend.open = !phone;

  let mode = "altitud"; // "altitud" (default), "suelo" or a lens id
  let lens = null;
  const normal = normalTerrain(w);
  let terrain = normal;
  const soils = new Map(); // terrain id -> soil colours
  const heightsTint = new Map(); // terrain id -> altitude colours
  let detail = null; // promise of the fine terrain
  let wanted = "normal";
  const detailBox = $("#r3d-detail"), note = $(".r3d-note");
  let userMoved = false;
  let visible = false;
  let tipCell = -1;
  let hoverAt = null;
  let hoverQueued = false;
  let restoreFocus = null;
  let madeInert = [];

  let scene = null;
  try {
    scene = createReliefScene(canvas, w, {
      mobile: phone,
      onMove: () => { userMoved = true; },
      onTap: (x, y, type) => {
        const i = scene.pick(x, y);
        if (type !== "mouse" && i === tipCell) return hideTip();
        showTip(i, x, y);
      },
      onHover: (x, y) => {
        hoverAt = [x, y];
        if (hoverQueued) return;
        hoverQueued = true;
        requestAnimationFrame(() => {
          hoverQueued = false;
          if (visible && hoverAt) showTip(scene.pick(...hoverAt), ...hoverAt);
        });
      },
      onGesture: () => {
        hoverAt = null;
        hideTip();
      },
    });
  } catch (err) {
    console.warn("relief3d: sin WebGL", err);
    const box = $(".r3d-error");
    box.hidden = false;
    box.textContent = t("Este navegador no puede dibujar en 3D (WebGL no disponible). Vuelve al mapa.");
    panel.hidden = true;
    canvas.hidden = true;
  }

  // --- colour and legend -------------------------------------------------------------------------------------------
  // The map's own "Altitud" lens (per game cell) stays in the list, told apart from the built-in colour.
  const lensTile = (l) => `<option value="${esc(l.id)}">${esc(l.name)}${l.id === "elevation" ? ` (${t("lente del mapa")})` : ""}</option>`;
  const known = new Set((lensFile.groups || []).map((g) => g.id));
  select.innerHTML = `<option value="altitud">${t("Altitud")}</option><option value="suelo">${t("Suelo")}</option>` + (lensFile.groups || []).map((g) => {
    const items = lensFile.lenses.filter((l) => l.group === g.id);
    return items.length ? `<optgroup label="${esc(g.name)}">${items.map(lensTile).join("")}</optgroup>` : "";
  }).join("") + lensFile.lenses.filter((l) => !known.has(l.group)).map(lensTile).join("");

  const swatch = (name, color, extra = "") =>
    `<li><i style="background:${esc(color)}"></i><span>${esc(name)}</span>${extra}</li>`;

  function sourceLine(l) {
    const src = sources.find((s) => s.id === l.source);
    const name = src ? src.publisher || src.title : l.source;
    return [name, src?.vintage || lensFile.vintage].filter(Boolean).join(" · ");
  }

  function renderLegend() {
    const credit = riverBox.checked ? `<p>${RIVER_CREDIT}</p>` : "";
    const fine = terrain.id === "alto";
    const source = fine ? `<p>${DETAIL_CREDIT}</p>` : "";
    const outside = `<p>${t("Fuera de Galicia, tono apagado. Junto al borde de la malla, esas celdas bajan y se funden con el mar.")}</p>`;
    if (mode === "altitud") {
      const gradient = ALTITUDE_STOPS.map(([m, c]) => `${c} ${(m / ALTITUDE_TOP) * 100}%`).join(", ");
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((u) => `<span>${u === 1 ? "≥ " : ""}${int(u * ALTITUDE_TOP)} m</span>`).join("");
      const keys = [[t("Mar"), SEA.stops[2][1]], [t("Embalse o lago"), SOIL.lake]];
      if (riverBox.checked) keys.push([t("Río"), RIVER.galicia]);
      legendBody.innerHTML = `<div class="r3d-ramp" style="background:linear-gradient(90deg, ${gradient})"></div>
        <div class="r3d-ticks r3d-num">${ticks}</div>
        <ul class="r3d-keys">${keys.map(([n, c]) => swatch(n, css(c))).join("")}</ul>
        <p>${t("Altitud media de cada celda de {r} km de radio. El sombreado de las laderas aclara u oscurece el color.", { r: km(terrain.grid.R) })}</p>
        ${outside}${fine ? source : `<p>${RELIEF_CREDIT}</p>`}${credit}`;
      return;
    }
    if (!lens) {
      const base = fine
        ? [...DETAIL_LEGEND.map(([n, key]) => [n, SOIL[key]]), [t("Mar"), SEA.stops[2][1]]] : SOIL_LEGEND;
      const keys = riverBox.checked ? [...base, [t("Río"), RIVER.galicia]] : base;
      const text = fine
        ? t("Color según la cobertura más frecuente (ESA WorldCover) en cada celda de {r} km de radio.", { r: km(terrain.grid.R) })
        : t("Color según la cobertura de cada celda (ESA WorldCover). La roca es un recurso de dibujo: aparece por altitud y relieve, no es un dato.");
      legendBody.innerHTML = `<ul class="r3d-keys">${keys.map(([n, c]) => swatch(n, css(c))).join("")}</ul>
        <p>${text}</p>
        ${outside}${source}${credit}`;
      return;
    }
    const l = lens;
    let missing = false;
    for (let i = 0; i < terrain.n && !missing; i++) {
      missing = isLandOfGalicia(terrain, i) && l.values[terrain.game[i]] == null;
    }
    const none = missing ? `<ul class="r3d-keys">${swatch(l.sparse ? t("Sin valor") : t("Sin datos"), css(NO_DATA))}</ul>` : "";
    let scale;
    if (l.format === "category" && Array.isArray(l.categories)) {
      scale = `<ul class="r3d-keys">${l.categories.map((c, k) => swatch(c.name, c.color || l.ramp[k])).join("")}</ul>`;
    } else {
      const ticks = [[0, 0], [0.5, 2], [1, 4]].map(([u, k]) => `<span>${esc(formatLensTick(l, u, k))}</span>`).join("");
      scale = `<div class="r3d-ramp" style="background:linear-gradient(90deg, ${l.ramp.map(esc).join(",")})"></div>
        <div class="r3d-ticks r3d-num">${ticks}</div>`;
    }
    const about = [l.description, l.note].filter(Boolean).map((u) => `<p>${esc(u)}</p>`).join("");
    const coarse = fine ? `<p>${t("Cada celda fina toma el valor de su celda del mapa (radio {r} km).", { r: km(w.grid.R) })}</p>` : "";
    legendBody.innerHTML = `${scale}${none}
      ${l.unit ? `<p>${t("Unidad: {unit}", { unit: esc(l.unit) })}</p>` : ""}<p>${esc(sourceLine(l))}</p>${coarse}
      ${source}${credit}${about ? `<details class="r3d-about"><summary>${t("Qué mide")}</summary>${about}</details>` : ""}`;
  }

  const cached = (map, make) => {
    let colors = map.get(terrain.id);
    if (!colors) map.set(terrain.id, (colors = make(terrain)));
    return colors;
  };
  function paintTerrain() {
    if (scene) {
      // The slope shading is strongest on the soil picture, softer on the altitude ramp and half on a lens, so that the
      // colours can still be read against their legend.
      if (lens) scene.setColors(lensColors(terrain, lens, cached(soils, soilColors)), 0.5);
      else if (mode === "suelo") scene.setColors(cached(soils, soilColors), 1);
      else scene.setColors(cached(heightsTint, altitudeColors), 0.7);
      scene.setRiversQuiet(!!lens);
    }
    renderLegend();
    describe();
    hideTip();
  }

  /** The colour of the cells: "altitud" (also for null), "suelo" or a lens id. */
  function setLens(id) {
    lens = (id && byId.get(id)) || null;
    mode = lens ? lens.id : id === "suelo" ? "suelo" : "altitud";
    select.value = mode;
    paintTerrain();
  }

  // --- detail ------------------------------------------------------------------------------------------------------
  function showTerrain(next) {
    terrain = next;
    scene?.setTerrain(terrain);
    paintTerrain();
  }
  const labelDetail = (fine) => {
    detailBox.options[0].textContent = t("Normal (celdas de {r} km)", { r: km(w.grid.R) });
    detailBox.options[1].textContent = fine ? t("Alto (celdas de {r} km)", { r: km(fine.grid.R) }) : t("Alto");
  };
  /** "normal" or "alto". Resolves to the one on screen: "normal" too if the fine mesh cannot be loaded. */
  async function setDetail(id) {
    wanted = id === "alto" ? "alto" : "normal";
    detailBox.value = wanted;
    note.hidden = true;
    if (wanted === "normal") {
      if (terrain.id !== "normal") showTerrain(normal);
      return "normal";
    }
    if (terrain.id === "alto") return "alto";
    note.hidden = false;
    note.textContent = t("Cargando el detalle…");
    try {
      detail ??= loadDetail(w);
      const fine = await detail;
      labelDetail(fine);
      if (wanted !== "alto") return terrain.id; // changed their mind while it loaded
      note.hidden = true;
      showTerrain(fine);
    } catch (err) {
      console.warn("relief3d: sin detalle alto", err);
      detail = null;
      wanted = "normal";
      detailBox.value = "normal";
      note.hidden = false;
      note.textContent = t("Sin detalle alto: {msg}.", { msg: err.message });
    }
    return terrain.id;
  }
  detailBox.addEventListener("change", () => setDetail(detailBox.value));

  function setExaggeration(v, apply = true) {
    const value = Math.min(30, Math.max(1, Math.round(Number(v) || 1)));
    slider.value = String(value);
    output.textContent = value === 1 ? t("×1 (real)") : `×${value}`;
    slider.setAttribute("aria-valuetext", output.textContent);
    if (apply && scene) scene.setExaggeration(value);
    describe();
    hideTip();
  }
  // Dragging the slider: rebuild at most once per frame.
  let exagQueued = false;
  slider.addEventListener("input", () => {
    setExaggeration(slider.value, false);
    if (exagQueued) return;
    exagQueued = true;
    requestAnimationFrame(() => {
      exagQueued = false;
      scene?.setExaggeration(+slider.value);
    });
  });
  select.addEventListener("change", () => setLens(select.value));
  $(".r3d-curve").addEventListener("change", (e) => {
    scene?.setCurved(e.target.checked);
    hideTip();
  });
  function setRivers(on) {
    riverBox.checked = !!on;
    scene?.setRivers(!!on);
    renderLegend();
    hideTip();
  }
  riverBox.addEventListener("change", () => setRivers(riverBox.checked));
  $(".r3d-reset").addEventListener("click", () => reset());
  $(".r3d-back").addEventListener("click", () => onClose());

  function describe() {
    canvas.setAttribute("aria-label",
      t("Relieve de Galicia en 3D, altura exagerada por {n}, color: {color}. Flechas para girar, más y menos para acercar.",
        { n: slider.value, color: lens ? lens.name : mode === "suelo" ? t("suelo") : t("altitud") }));
  }

  // --- tooltip -----------------------------------------------------------------------------------------------------
  function tipHtml(i) {
    const T = terrain;
    const m = (v) => `<span class="r3d-num">${int(v)} m</span>`;
    const through = riverBox.checked && !T.water[i] ? scene.riversAt(i) : [];
    const rivers = through.length ? `<br><span class="r3d-river">${through.map(esc).join(" · ")}</span>` : "";
    if (T.water[i] === 3) {
      return `<b>${t("Embalse o lago")}</b>${T.elev[i] > 0 ? `<br>${t("Altitud {v}", { v: m(T.elev[i]) })}` : ""}`;
    }
    if (T.water[i]) return `<b>${t("Mar")}</b>${T.elev[i] < 0 ? `<br>${t("Profundidad {v}", { v: m(-T.elev[i]) })}` : ""}`;
    const top = T.elevMax?.[i] > T.elev[i] ? ` <span class="r3d-muted">${t("(máx. {v})", { v: m(T.elevMax[i]) })}</span>` : "";
    const height = `${t("Altitud media {v}", { v: m(T.elev[i]) })}${top}`;
    const o = T.owner[i];
    if (!(o >= 0)) return `<b>${t("Fuera de Galicia")}</b><br>${height}${rivers}`;
    const g = T.game[i];
    const county = raw.county[g] >= 0 ? raw.counties[raw.county[g]].name : "";
    const comarca = app.data.states?.[o]?.name || raw.states[o].name;
    const title = county ? `<b>${esc(county)}</b> <span class="r3d-muted">${esc(comarca)}</span>` : `<b>${esc(comarca)}</b>`;
    let value;
    if (lens) value = `${esc(lens.name)}: <b class="r3d-num">${esc(formatLensValue(lens, lens.values[g]))}</b>`;
    else if (mode === "altitud") value = ""; // the altitude line already says it
    else if (!T.pct) value = esc(CLASS_NAMES[T.cover[i]] || "");
    else {
      value = Object.entries(PCT_NAMES).map(([k, name]) => [name, T.pct[k]?.[i] || 0]).filter(([, p]) => p >= 5)
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, p]) => `${name} <span class="r3d-num">${p} %</span>`).join(" · ");
    }
    return [title, height, value].filter(Boolean).join("<br>") + rivers;
  }

  function showTip(i, clientX, clientY) {
    if (i < 0) return hideTip();
    if (i !== tipCell) {
      tipCell = i;
      const box0 = root.getBoundingClientRect();
      mark.setAttribute("points", scene.outline(i).map(([px, py]) => `${(px - box0.left).toFixed(1)},${(py - box0.top).toFixed(1)}`).join(" "));
      tip.innerHTML = tipHtml(i);
    }
    tip.hidden = false;
    const box = root.getBoundingClientRect(), r = tip.getBoundingClientRect();
    const x = clientX - box.left, y = clientY - box.top;
    // Right and below the pointer; flips left or up when it would leave the screen.
    const left = x + 16 + r.width > box.width - 8 ? x - r.width - 12 : x + 16;
    const topPx = y + 16 + r.height > box.height - 8 ? y - r.height - 12 : y + 16;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, topPx)}px`;
  }

  function hideTip() {
    tip.hidden = true;
    mark.setAttribute("points", "");
    tipCell = -1;
  }

  // --- layout, keys, show / hide -----------------------------------------------------------------------------------
  // The area the controls leave free: beside a column on the left, or above a sheet along the bottom.
  function insets() {
    const top = head.offsetHeight;
    const sheet = panel.offsetWidth > root.clientWidth * 0.8;
    return sheet ? { top, right: 0, bottom: panel.offsetHeight, left: 0 }
      : { top, right: 0, bottom: 0, left: panel.offsetLeft + panel.offsetWidth };
  }
  function layout() {
    if (!visible || !scene) return;
    hideTip();
    root.style.setProperty("--r3d-head-h", `${head.offsetHeight}px`);
    scene.setSize(root.clientWidth, root.clientHeight, insets());
    if (!userMoved) scene.fit();
  }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout()) : null;

  function reset() {
    scene?.fit();
    userMoved = false;
    hideTip();
  }

  // While open, the map's keyboard shortcuts stay quiet (Escape still reaches main.js, which leaves the mode).
  const KEYS = {
    ArrowLeft: [(o) => o.rotate(0.09, 0), (o) => o.pan(60, 0)],
    ArrowRight: [(o) => o.rotate(-0.09, 0), (o) => o.pan(-60, 0)],
    ArrowUp: [(o) => o.rotate(0, 0.07), (o) => o.pan(0, 60)],
    ArrowDown: [(o) => o.rotate(0, -0.07), (o) => o.pan(0, -60)],
    "+": [(o) => o.zoom(0.85)], "=": [(o) => o.zoom(0.85)], "-": [(o) => o.zoom(1 / 0.85)],
  };
  function onKey(e) {
    if (e.key === "Escape") return;
    e.stopPropagation();
    if (!scene || e.ctrlKey || e.metaKey || e.altKey || (e.target !== canvas && e.target !== document.body)) return;
    if (e.key === "0" || e.key === "Home") {
      e.preventDefault();
      reset();
      return;
    }
    const act = KEYS[e.key];
    if (!act) return;
    e.preventDefault();
    hideTip();
    (act[e.shiftKey && act[1] ? 1 : 0])(scene.orbit);
  }

  function show() {
    if (visible) return;
    visible = true;
    restoreFocus = document.activeElement;
    root.hidden = false;
    // Keep Tab inside the layer: everything behind it is inert while it is open.
    madeInert = [...document.body.children].filter((el) => el !== root && !el.inert && el.tagName !== "SCRIPT");
    for (const el of madeInert) el.inert = true;
    window.addEventListener("keydown", onKey, true);
    scene?.resume();
    layout();
    observer?.observe(root);
    observer?.observe(panel);
    $(".r3d-back").focus({ preventScroll: true });
  }

  function hide() {
    if (!visible) return;
    visible = false;
    observer?.disconnect();
    window.removeEventListener("keydown", onKey, true);
    hideTip();
    scene?.orbit.reset();
    scene?.pause();
    root.hidden = true;
    for (const el of madeInert) el.inert = false;
    madeInert = [];
    if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus({ preventScroll: true });
  }

  if (!observer) window.addEventListener("resize", layout);

  setExaggeration(DEFAULT_EXAGGERATION);
  labelDetail(null);
  showTerrain(terrain);
  // Fine by default on a computer; phones start on the normal mesh and can switch.
  const ready = setDetail(phone || !scene ? "normal" : "alto");

  return {
    ready,
    setDetail,
    get terrain() { return terrain; },
    element: root,
    show,
    hide,
    reset,
    setLens,
    setExaggeration,
    setRivers,
    /** Camera values for tests: {az, el, dist, tx, tz}. */
    setCamera: (values) => scene?.orbit.set(values),
    setCurved(on) {
      $(".r3d-curve").checked = !!on;
      scene?.setCurved(on);
    },
    get scene() { return scene; },
    get lens() { return lens; },
    get color() { return mode; },
  };
}
