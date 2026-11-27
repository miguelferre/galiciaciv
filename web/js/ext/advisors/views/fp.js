// Formación profesional advisor ("Gremio de oficios"): where FP is taught (fp.json: 216 centres with offer in 2026-27),
// how many places there are per 1 000 young people in each comarca, how the offer by family compares with the
// establishments of the comarca, and the PIE industrial projects with their announced jobs.
// The selected comarca is the one the map already has selected (#state=): this view adds no hash key of its own.
import { esc, fin, el as mk } from "../core/util.js";
import { int, pct, dec, signedPct } from "../core/fmt.js";
import { barList } from "../core/charts.js";
import { section, tiles, segmented, mapPicker, sourcesHtml } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { fpPlacesLens } from "../core/fp.js";
import { FP_STATUS } from "../../layers/tips.js";

const BLUE = "#47a1d6";
const PIE_COLOR = "#ff6b3d";
const LOW = 0.5, HIGH = 2; // ratio limits for «poca oferta» and «mucha oferta»
const NONE = "—";

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const fp = await app.loadData("fp").catch(() => null);
  if (!fp?.by_comarca) {
    el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">No se han podido cargar los datos de Formación profesional.</p>`);
    return {};
  }
  const { states } = data.levels;
  const gal = fp.galicia;
  const famName = new Map(fp.families.map((f) => [f.id, f.name]));
  const famNote = new Map(fp.families.filter((f) => f.note).map((f) => [f.id, f.note]));
  const minShare = fp.thresholds?.est_min_share ?? 0.02;
  const minTrend = fp.thresholds?.trend_min_units ?? 10;
  const rowOf = (fips) => states.byKey.get(String(fips)) || null;
  const cellOf = (x, y) => app.w.grid.cellAt(x, y);

  // --- headline --------------------------------------------------------------------------------------------------
  el.insertAdjacentHTML("beforeend", tiles([
    { label: "Centros con FP", value: int(gal.centres), sub: "curso 2026-27", color: BLUE },
    { label: "Centros integrados", value: int(gal.cifp), sub: "CIFP", color: "#ffd36a" },
    { label: "Plazas", value: int(gal.places), sub: "primer curso, ordinario" },
    { label: "Plazas por 1 000", value: dec(gal.places_per_1000, 1), sub: "jóvenes de 15 a 24 años" },
  ]));

  // --- map: lens and centres layer -------------------------------------------------------------------------------
  let picker = null;
  const mapRow = mk("div", "adv-sec adv-mapsec");
  el.appendChild(mapRow);
  picker = mapPicker(ctx, mapRow, {
    value: "terrain",
    options: [{ value: "terrain", label: "Terreno", lens: () => null }, { value: "places", label: "Plazas por 1 000 jóvenes", lens: () => fpPlacesLens(data, fp) }],
  });
  const layerOn = () => !!app.ui?.mapToggles?.().find((t) => t.id === "fp")?.on;
  if (app.ui?.setMapToggle) {
    // Draw the centres while this view is open; leave the switch as it was when it closes.
    if (!layerOn() && app.ui.setMapToggle("fp", true)) ctx.cleanup(() => { if (layerOn()) app.ui.setMapToggle("fp", false); });
    const b = mk("button", "adv-mini");
    b.type = "button";
    const sync = () => { b.textContent = layerOn() ? "Quitar los centros del mapa" : "Dibujar los centros en el mapa"; };
    sync();
    b.addEventListener("click", () => { app.ui.setMapToggle("fp", !layerOn()); sync(); });
    mapRow.appendChild(b);
    mapRow.insertAdjacentHTML("beforeend", `<p class="adv-note adv-fp-key"><i class="adv-fp-sym cifp"></i>CIFP <i class="adv-fp-sym pub"></i>centro público <i class="adv-fp-sym priv"></i>privado <i class="adv-fp-sym pie"></i>proyecto PIE</p>`);
  }

  // --- ranking by comarca ----------------------------------------------------------------------------------------
  // Comarcas with few young people give huge ratios from a handful of places (Terra de Trives: 62 places, 187 young).
  const MIN_YOUNG = 500;
  const allComarcas = Object.entries(fp.by_comarca).map(([fips, c]) => ({ fips, c, row: rowOf(fips) })).filter((x) => x.row);
  const comarcas = allComarcas.filter((x) => (x.c.young_15_24 || 0) >= MIN_YOUNG);
  const small = allComarcas.length - comarcas.length;
  const topVal = Math.max(...comarcas.map((x) => x.c.places_per_1000 || 0), 1);
  let rankBars = null, selFips = null;
  const rBody = section(el, { title: "Plazas por comarca", kicker: "Por cada 1 000 jóvenes de 15 a 24 años", note: "Pasa el puntero por una comarca para verla en el mapa; pulsa para ver su detalle." });
  const rHost = mk("div");
  let order = "most";
  segmented(rBody, { label: "Orden", value: order, options: [{ value: "most", label: "Más plazas" }, { value: "least", label: "Menos plazas" }], onChange: (v) => { order = v; drawRank(); } });
  rBody.appendChild(rHost);
  function drawRank() {
    rHost.innerHTML = "";
    const list = [...comarcas].sort((a, b) => (order === "most" ? b.c.places_per_1000 - a.c.places_per_1000 : a.c.places_per_1000 - b.c.places_per_1000)).slice(0, 12);
    rankBars = barList(rHost, {
      rank: true, ariaLabel: "Comarcas según las plazas de FP por 1 000 jóvenes", max: topVal, selected: selFips,
      rows: list.map(({ fips, c, row }) => ({
        key: fips, label: c.name, row, value: c.places_per_1000, color: BLUE,
        sub: c.centres ? `${int(c.places)} plazas · ${int(c.centres)} ${c.centres === 1 ? "centro" : "centros"}` : "sin centros con FP",
        text: dec(c.places_per_1000, 1),
      })),
      onHover: (x) => link.hover(x ? rowsHighlight(states, [x.row], { dim: true }) : null),
      onClick: (x) => states.focus(x.row),
    });
  }
  drawRank();
  rBody.insertAdjacentHTML("beforeend", `<p class="adv-note">Galicia: ${dec(gal.places_per_1000, 1)}.${small ? ` Fuera del orden: ${int(small)} comarcas con menos de ${int(MIN_YOUNG)} jóvenes, donde unas pocas plazas dan cifras muy altas; su detalle sigue abajo.` : ""} Los centros cuentan donde están, no donde vive el alumnado: la oferta de una ciudad sirve a su entorno.</p>`);

  // --- the selected comarca --------------------------------------------------------------------------------------
  const pBody = section(el, { title: "Una comarca", kicker: "Oferta frente a empresas" });
  const panel = mk("div", "adv-fp-panel");
  pBody.appendChild(panel);
  let sortBy = "places";
  let pieBars = null;

  const selection = () => {
    const i = app.state.selectedState;
    return i != null ? String(app.w.raw.states[i]?.fips ?? "") || null : null;
  };

  function tag(r) {
    if (!fin(r)) return "";
    if (r < LOW) return `<span class="adv-fp-tag low">poca oferta</span>`;
    if (r > HIGH) return `<span class="adv-fp-tag high">mucha oferta</span>`;
    return "";
  }

  function familyTable(c) {
    const all = Object.entries(c.by_family).map(([id, f]) => ({ id, f, km: c.nearest_km?.[id] }));
    const shown = all.filter((x) => x.f.places > 0 || (x.f.est_share ?? 0) >= minShare);
    const hidden = all.length - shown.length;
    const key = {
      places: (x) => -x.f.places,
      ratio: (x) => (fin(x.f.ratio) ? x.f.ratio : 1e9), // least offer first, unknown last
      km: (x) => (fin(x.km) ? -x.km : 1e9), // farthest first, unknown last
    }[sortBy];
    shown.sort((a, b) => key(a) - key(b) || b.f.places - a.f.places);
    const rows = shown.map(({ id, f, km }) => `<tr>
      <th scope="row">${esc(famName.get(id) || id)}${famNote.has(id) ? `<abbr class="adv-fp-star" title="${esc(famNote.get(id))}">*</abbr>` : ""}</th>
      <td>${int(f.places)}</td>
      <td>${f.offer_share == null ? NONE : esc(pct(f.offer_share, 1))}</td>
      <td>${f.est_share == null ? NONE : esc(pct(f.est_share, 1))}</td>
      <td class="adv-fp-ratio">${fin(f.ratio) ? dec(f.ratio, 2) : NONE}${tag(f.ratio)}</td>
      <td>${fin(f.trend) ? esc(signedPct(f.trend, 0)) : NONE}</td>
      <td>${fin(km) ? `${int(km)} km` : NONE}</td></tr>`).join("");
    const notes = shown.filter((x) => famNote.has(x.id)).map((x) => `<li><b>${esc(famName.get(x.id))}.</b> ${esc(famNote.get(x.id))}</li>`).join("");
    return `<div class="adv-fp-tablewrap"><table class="adv-fp-table">
      <caption class="adv-fp-cap">Familias profesionales de la comarca</caption>
      <thead><tr><th scope="col">Familia</th>
        <th scope="col" title="Plazas de primer curso en 2026-27">Plazas</th>
        <th scope="col" title="Parte de las plazas de la comarca">Oferta</th>
        <th scope="col" title="Parte de los establecimientos de la comarca">Empresas</th>
        <th scope="col" title="Oferta dividida entre empresas: 1 es oferta como el tejido de empresas">Cociente</th>
        <th scope="col" title="Cambio del número de establecimientos entre 2014 y 2024">Emp. 2014-24</th>
        <th scope="col" title="Distancia en línea recta al centro más cercano que ofrece la familia">Centro cercano</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="adv-note"><b>Cociente</b> = parte de las plazas entre parte de las empresas. 1 es una oferta como el tejido de empresas; menos de ${dec(LOW, 1)} es <b>poca oferta</b>; más de ${HIGH}, <b>mucha oferta</b>.
      Sale «${NONE}» cuando la familia pesa menos del ${pct(minShare, 0)} de los establecimientos (el cociente no sería fiable) y en la tendencia cuando había menos de ${int(minTrend)} en 2014.</p>
      ${hidden ? `<p class="adv-note">${int(hidden)} ${hidden === 1 ? "familia sin plazas y con menos" : "familias sin plazas y con menos"} del ${pct(minShare, 0)} de las empresas no se muestran.</p>` : ""}
      ${notes ? `<h4 class="adv-h4">Avisos sobre las empresas</h4><ul class="adv-caveats adv-fp-notes">${notes}</ul>` : ""}`;
  }

  const pieRows = (list) => list.map((p) => ({
    key: p.company, label: p.company, full: `${p.company}: ${p.project || ""}`, value: p.jobs_total,
    sub: FP_STATUS[p.status] || p.status_text || "", text: `${int(p.jobs_total)} empleos`, color: PIE_COLOR, pie: p,
  }));
  const pieHover = (r) => link.hover(r ? { cells: new Set([cellOf(r.pie.x, r.pie.y)].filter((c) => c >= 0)), label: r.pie.company } : null);

  function renderPanel() {
    pieBars = null;
    panel.innerHTML = "";
    const c = selFips ? fp.by_comarca[selFips] : null;
    if (!c) {
      panel.innerHTML = `<p class="adv-note">Elige una comarca en el mapa o en la lista de arriba para ver su oferta por familia, la distancia al centro más cercano y los proyectos PIE.</p>`;
      return;
    }
    panel.insertAdjacentHTML("beforeend", `<h4 class="adv-h4 adv-fp-name">${esc(c.name)}</h4>`);
    panel.insertAdjacentHTML("beforeend", tiles([
      { label: "Centros", value: int(c.centres), sub: "con oferta de FP", color: BLUE },
      { label: "Jóvenes", value: int(c.young_15_24), sub: "de 15 a 24 años" },
      { label: "Plazas", value: int(c.places), sub: "primer curso, 2026-27" },
      { label: "Plazas por 1 000", value: dec(c.places_per_1000, 1), sub: `Galicia ${dec(gal.places_per_1000, 1)}` },
    ]));
    if (!c.centres) panel.insertAdjacentHTML("beforeend", `<p class="adv-callout adv-caveat">Esta comarca no tiene centros con ciclos de FP en el curso ordinario. El alumnado va a los de otras comarcas: mira la última columna.</p>`);
    const ctl = mk("div", "adv-row");
    panel.appendChild(ctl);
    segmented(ctl, {
      label: "Ordenar por", value: sortBy,
      options: [{ value: "places", label: "Plazas" }, { value: "ratio", label: "Cociente" }, { value: "km", label: "Distancia" }],
      onChange: (v) => { sortBy = v; renderPanel(); },
    });
    panel.insertAdjacentHTML("beforeend", familyTable(c));
    const here = fp.pie.filter((p) => p.comarca === selFips);
    panel.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Proyectos PIE en la comarca</h4>`);
    if (!here.length) panel.insertAdjacentHTML("beforeend", `<p class="adv-note">Ninguno.</p>`);
    else {
      const host = mk("div");
      panel.appendChild(host);
      barList(host, { compact: true, ariaLabel: `Proyectos PIE en ${c.name}`, rows: pieRows(here), onHover: pieHover });
    }
  }

  function select(fips) {
    selFips = fips && fp.by_comarca[fips] ? fips : null;
    rankBars?.setSelected(selFips);
    renderPanel();
  }

  // --- PIE in Galicia --------------------------------------------------------------------------------------------
  const piBody = section(el, { title: "Proyectos industriales estratégicos", kicker: "PIE de Galicia", note: "Empleo total anunciado, directo más indirecto. La posición es el centro del concello." });
  const jobs = fp.pie.reduce((a, p) => a + (p.jobs_total || 0), 0);
  piBody.insertAdjacentHTML("beforeend", `<p class="adv-note"><b>${int(fp.pie.length)}</b> proyectos anuncian <b>${int(jobs)}</b> empleos entre todos (directos e indirectos).</p>`);
  const piHost = mk("div");
  piBody.appendChild(piHost);
  pieBars = null;
  barList(piHost, {
    rank: true, ariaLabel: "Proyectos PIE de Galicia por empleos anunciados",
    rows: pieRows([...fp.pie].sort((a, b) => b.jobs_total - a.jobs_total)),
    onHover: pieHover,
    onClick: (r) => { const row = rowOf(r.pie.comarca); if (row) states.focus(row); },
  });
  piBody.insertAdjacentHTML("beforeend", `<p class="adv-note">Pulsa un proyecto para ir a su comarca.</p>`);

  // --- caveats ---------------------------------------------------------------------------------------------------
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, fp.sources || [], [
    `La oferta es el curso completo ordinario 2026-27 de la Consellería (${int(gal.places)} plazas). No incluye la oferta modular, dual, acelerada ni semipresencial, que suma bastante más.`,
    "Las empresas son establecimientos (unidades locales), no empleos, y faltan el sector primario y la administración pública.",
    "El reparto de los sectores de actividad entre familias profesionales es una tabla propia, de criterio propio (la del INCUAL no se podía reutilizar): sirve para comparar, no para medir.",
    "El empleo de los PIE es el total anunciado, directo más indirecto, no empleo creado. Las familias afines son criterio propio.",
  ]));

  // --- wiring ----------------------------------------------------------------------------------------------------
  ctx.on("select", () => select(selection()));
  select(selection());

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? states.rowAtCell(h.cell) : null;
      rankBars?.setHot(r ? r.key : null);
    },
  };
}
