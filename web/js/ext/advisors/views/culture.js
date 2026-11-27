// Culture advisor ("Custodia de las maravillas"): wonders by published rule (wonders.json), the Culture yield (an
// estimate of the affiliates of one IGE branch, not of people who work in culture) and the concellos with a culture
// district (districts.json, which counts establishments).
import { esc, fin, ratio, el as mk } from "../core/util.js";
import { int, pct, dec, count3 } from "../core/fmt.js";
import { barList } from "../core/charts.js";
import { section, tiles, segmented, mapPicker, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { cultureLens, CULTURE_BRANCH as BRANCH } from "../core/lenses.js";
import { caminoLens } from "../core/camino.js";

// One entry per rule of wonders.json: the short label of the filter and the marker colour.
const RULES = {
  unesco: { short: "UNESCO", color: "#e0b54c" },
  bic: { short: "BIC", color: "#c25b9a" },
  parque_nacional: { short: "Parque", color: "#6aa84f" },
};
const ruleColor = (id) => RULES[id]?.color || "#ccc";

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const [won, dist, cam] = await Promise.all(["wonders", "districts", "camino"].map((f) => app.loadData(f).catch(() => null)));
  const { states: comarcas, metros, counties } = data.levels;
  const yieldDef = app.data.nation?.yields?.find((y) => y.key === "culture");
  const share = (r) => ratio(r.v.y_culture, r.v.affiliates);
  const galShare = ratio(data.galicia.y_culture, data.galicia.affiliates);

  const wonders = (won?.wonders || []).map((w) => ({ ...w, key: w.id }));
  const rules = won?.rules || [];
  const ruleName = (id) => rules.find((r) => r.id === id)?.name || RULES[id]?.short || id;
  const ofRule = (id) => wonders.filter((w) => w.rule === id).length;

  const culture = dist?.catalog?.find((c) => c.id === "culture");
  const plaza = culture && counties
    ? Object.entries(dist.counties || {}).flatMap(([geoid, c]) => {
      const hit = (c.districts || []).find((x) => x[0] === "culture");
      const row = counties.byKey.get(geoid);
      return hit && row ? [{ key: geoid, row, lq: hit[1], units: hit[2], total: c.units, badge: dist.cities?.[geoid]?.badge?.id === "culture" }] : [];
    }).sort((a, b) => b.lq - a.lq)
    : [];

  // --- headline -------------------------------------------------------------------------------------------------
  const headline = [];
  if (wonders.length) {
    headline.push({ label: "Maravillas", value: int(wonders.length), sub: `${int(ofRule("unesco"))} UNESCO · ${int(ofRule("bic"))} BIC · ${int(ofRule("parque_nacional"))} parque` });
  }
  if (fin(data.galicia.y_culture)) {
    headline.push({ label: "Rendimiento Cultura ≈", value: count3(data.galicia.y_culture), sub: "afiliados de una rama amplia", color: yieldDef?.color });
  }
  if (plaza.length) headline.push({ label: "Plaza de la cultura", value: int(plaza.length), sub: "concellos que cumplen la regla" });
  el.insertAdjacentHTML("beforeend", tiles(headline));

  // --- map colour -----------------------------------------------------------------------------------------------
  let picker = null;
  const hasCamino = !!(cam?.routes?.length && counties?.field("camino_km"));
  const mapOptions = [{ value: "terrain", label: "Terreno", lens: () => null }];
  if (fin(galShare)) mapOptions.push({ value: "share", label: "Peso de la rama", lens: () => cultureLens(data) });
  if (hasCamino) mapOptions.push({ value: "camino", label: "Km de Camino", lens: () => caminoLens(data) });
  if (mapOptions.length > 1) {
    const mapRow = mk("div", "adv-sec adv-mapsec");
    el.appendChild(mapRow);
    picker = mapPicker(ctx, mapRow, { value: "terrain", options: mapOptions });
  }

  // --- wonders --------------------------------------------------------------------------------------------------
  let wonderBars = [];
  const bubbles = ctx.bubbles("wonders", {
    rMax: 9, minR: 9, alpha: 0.28,
    tip: (b) => `<b>${esc(b.it.name)}</b><br>${esc(ruleName(b.it.rule))}${metricText(b.it) ? ` · ${esc(metricText(b.it))}` : ""}`,
    onHover: (b) => { for (const w of wonderBars) w.setHot(b ? b.key : null); },
    onClick: (b) => flyTo(b.it),
  });
  const cellsOf = (w) => new Set(w.cells?.length ? w.cells : w.cell != null ? [w.cell] : []);
  if (wonders.length) {
    const wBody = section(el, { title: "Maravillas", kicker: "Cada una sale de una regla publicada", note: "Pasa el puntero por una maravilla para encontrarla en el mapa; pulsa para ir hasta ella." });
    let kind = "all";
    segmented(wBody, {
      label: "Regla", value: kind,
      options: [{ value: "all", label: "Todas" }, ...rules.filter((r) => ofRule(r.id)).map((r) => ({ value: r.id, label: RULES[r.id]?.short || r.name }))],
      onChange: (v) => { kind = v; drawWonders(); },
    });
    const wHost = mk("div");
    wBody.appendChild(wHost);
    function drawWonders() {
      wHost.innerHTML = "";
      wonderBars = [];
      const vis = wonders.filter((w) => kind === "all" || w.rule === kind);
      for (const rule of rules) {
        const list = vis.filter((w) => w.rule === rule.id);
        if (!list.length) continue;
        wHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4"><i class="dot" style="background:${ruleColor(rule.id)}"></i>${esc(rule.name)} (${int(list.length)})</h4><p class="adv-note adv-rule">${esc(rule.text)}</p>`);
        const host = mk("div");
        wHost.appendChild(host);
        const sized = rule.id === "bic"; // the only rule that ranks by a figure
        const bars = barList(host, {
          rank: sized, compact: true, ariaLabel: rule.name,
          rows: list.map((w) => {
            const place = w.rule === "parque_nacional" ? "" : w.metrics?.concello || "";
            return {
              key: w.key, label: w.short || w.name, full: w.name, sub: w.short?.includes(place) ? "" : place,
              value: sized ? w.metrics?.protected_km2 : null, text: metricText(w), color: ruleColor(w.rule),
            };
          }),
          onHover: (r) => {
            const w = r ? wonders.find((x) => x.key === r.key) : null;
            link.hover(w ? { cells: cellsOf(w), label: w.short || w.name } : null);
            bubbles.setHot(w ? w.key : null);
          },
          onClick: (r) => flyTo(wonders.find((x) => x.key === r.key)),
        });
        if (!sized) bars.el.querySelectorAll(".tr").forEach((n) => n.remove()); // no figure, no empty bar
        wonderBars.push(bars);
      }
      bubbles.set(vis.filter((w) => fin(w.x) && fin(w.y)).map((w) => ({ key: w.key, x: w.x, y: w.y, value: 1, color: ruleColor(w.rule), it: w })), { vMax: 1 });
    }
    drawWonders();
  } else el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">No se han podido cargar las maravillas.</p>`);
  function flyTo(w) {
    if (!w) return;
    if (w.cells && w.cells.length > 2) {
      const b = app.highlightBounds({ cells: new Set(w.cells) });
      if (b) return frameBox(app, b, { pad: 60 });
    }
    focusPoint(app, w.x, w.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3.2)));
  }

  // --- the Culture yield ----------------------------------------------------------------------------------------
  let yieldBars = null, yieldLevel = comarcas;
  if (fin(galShare)) {
    const yBody = section(el, { title: "El rendimiento Cultura", kicker: "Estimación por rama de actividad" });
    yBody.insertAdjacentHTML("beforeend", `<p class="adv-callout adv-caveat"><b>No son trabajadores de la cultura.</b> Es la rama «${esc(BRANCH)}» entera, contada en personas afiliadas.</p>
      <p class="adv-note">${esc(yieldDef?.description || "")}</p>
      <p class="adv-note">En Galicia: <b>${int(data.galicia.y_culture)}</b> personas (≈), el ${esc(pct(galShare))} de las afiliadas.</p>`);
    let mode = "share";
    const row = mk("div", "adv-row");
    yBody.appendChild(row);
    segmented(row, {
      label: "Territorio", value: "states",
      options: [{ value: "states", label: "Comarcas" }, { value: "metros", label: "Ciudades" }],
      onChange: (v) => { yieldLevel = v === "metros" ? metros : comarcas; drawYield(); },
    });
    segmented(row, {
      label: "Ordenar por", value: mode,
      options: [{ value: "share", label: "Peso" }, { value: "abs", label: "Personas" }],
      onChange: (v) => { mode = v; drawYield(); },
    });
    const yHost = mk("div");
    yBody.appendChild(yHost);
    function drawYield() {
      yHost.innerHTML = "";
      const list = topBy(yieldLevel.rows, mode === "abs" ? (r) => r.v.y_culture : share, { n: 12 });
      yieldBars = barList(yHost, {
        rank: true, ariaLabel: `${yieldLevel.label} según la rama del rendimiento Cultura`,
        rows: list.map(({ r, v }) => ({
          key: r.key, label: r.name, row: r, value: v, color: yieldDef?.color,
          sub: mode === "abs" ? pct(share(r)) : `×${dec(share(r) / galShare, 2)} Galicia`,
          text: mode === "abs" ? `${int(v)} ≈` : `${pct(v)} ≈`,
        })),
        onHover: (x) => link.hover(x ? rowsHighlight(yieldLevel, [x.row], { dim: true }) : null),
        onClick: (x) => yieldLevel.focus(x.row),
      });
    }
    drawYield();
    if (picker && fin(galShare)) {
      const b = mk("button", "adv-mini");
      b.type = "button";
      b.textContent = "Colorear el mapa por comarcas según el peso";
      b.addEventListener("click", () => picker.set("share"));
      yBody.appendChild(b);
    }
  }

  // --- the culture district -------------------------------------------------------------------------------------
  let plazaBars = null;
  if (plaza.length) {
    const pBody = section(el, { title: "Plaza de la cultura", kicker: "Establecimientos, no empleos" });
    const natCulture = (culture.divisions || []).reduce((a, k) => a + (dist.divisions?.[k]?.units || 0), 0);
    pBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${esc(culture.description)} Se cuentan establecimientos (unidades locales), no empleos.</p>
      <p class="adv-note">En Galicia: <b>${int(natCulture)}</b> establecimientos de estas actividades, el ${esc(pct(ratio(natCulture, dist.national?.units)))} de ${int(dist.national?.units)}.</p>
      <h4 class="adv-h4">Concellos con distrito, por veces la parte gallega</h4>`);
    plazaBars = barList(pBody, {
      rank: true, ariaLabel: "Concellos con plaza de la cultura",
      rows: plaza.map((p) => ({
        key: p.key, label: p.row.name, sub: `${int(p.units)} establec.`, full: `${p.row.name}: ${int(p.units)} establecimientos de ${int(p.total)}`,
        value: p.lq, text: `×${dec(p.lq, 2)}`, color: culture.color, row: p.row,
      })),
      onHover: (x) => link.hover(x ? rowsHighlight(counties, [x.row], { dim: true }) : null),
      onClick: (x) => counties.focus(x.row),
    });
    const badged = plaza.filter((p) => p.badge).map((p) => p.row.name).sort((a, b) => a.localeCompare(b, "es"));
    if (badged.length) pBody.insertAdjacentHTML("beforeend", `<p class="adv-note">Ciudades cuyo tipo es «${esc(culture.badge?.label || "Ciudad cultural")}»: ${esc(badged.join(", "))}.</p>`);
    pBody.insertAdjacentHTML("beforeend", `<p class="adv-note adv-rule">${esc(dist.rule?.text || "")}</p>`);
  }

  // --- Camino de Santiago -----------------------------------------------------------------------------------------
  let caminoBars = null, caminoTop = null;
  if (hasCamino) {
    const cBody = section(el, { title: "Camino de Santiago", kicker: "Trazado del IGN, kilómetros por concello" });
    const crossed = (id) => counties.rows.filter((r) => cam.by_concello[r.key]?.routes.includes(id));
    cBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${int(cam.routes.length)} Caminos pasan por Galicia. El total no cuenta dos veces los tramos que comparten varios Caminos.</p>`);
    cBody.insertAdjacentHTML("beforeend", tiles([
      { label: "Caminos", value: int(cam.routes.length), sub: "con tramo en Galicia" },
      { label: "Km en Galicia", value: int(Math.round(cam.total_km)), sub: `${int(Object.keys(cam.by_concello).length)} concellos` },
    ]));
    const row = mk("div", "adv-row");
    cBody.appendChild(row);
    const lensB = mk("button", "adv-mini");
    lensB.type = "button";
    const syncLens = () => { lensB.textContent = picker?.value === "camino" ? "Quitar la lente Km de Camino" : "Ver la lente Km de Camino"; };
    syncLens();
    lensB.addEventListener("click", () => { picker?.set(picker.value === "camino" ? "terrain" : "camino"); syncLens(); });
    if (picker) { row.appendChild(lensB); ctx.on("lens", syncLens); }
    const layerB = mk("button", "adv-mini");
    layerB.type = "button";
    layerB.textContent = "Dibujar los Caminos en el mapa";
    layerB.addEventListener("click", () => app.ui?.setMapToggle?.("camino", true));
    if (app.ui?.setMapToggle) row.appendChild(layerB);
    cBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Km de cada Camino dentro de Galicia</h4>`);
    const rHost = mk("div");
    cBody.appendChild(rHost);
    caminoBars = barList(rHost, {
      rank: true, ariaLabel: "Km de cada Camino de Santiago dentro de Galicia",
      rows: [...cam.routes].sort((a, b) => b.km_galicia - a.km_galicia).map((r) => ({
        key: r.id, label: r.name, full: r.full_name || r.name, value: r.km_galicia, text: `${int(Math.round(r.km_galicia))} km`, color: r.color,
      })),
      onHover: (x) => link.hover(x ? rowsHighlight(counties, crossed(x.key), { dim: true }) : null),
    });
    cBody.insertAdjacentHTML("beforeend", `<p class="adv-note">Cada Camino cuenta su recorrido entero, variantes incluidas; por eso la suma de los Caminos pasa del total.</p><h4 class="adv-h4">Concellos con más km de Camino</h4>`);
    const top = topBy(counties.rows, (r) => r.v.camino_km, { n: 12 });
    caminoTop = barList(cBody, {
      rank: true, ariaLabel: "Concellos con más kilómetros de Camino",
      rows: top.map(({ r, v }) => ({
        key: r.key, label: r.name, row: r, value: v, color: "#f2c14e",
        sub: (() => {
          const ids = cam.by_concello[r.key]?.routes || [];
          return ids.length > 2 ? `${ids.length} Caminos` : ids.map((id) => cam.routes.find((x) => x.id === id)?.name || id).join(", ");
        })(),
        text: `${dec(v, 1)} km`,
      })),
      onHover: (x) => link.hover(x ? rowsHighlight(counties, [x.row], { dim: true }) : null),
      onClick: (x) => counties.focus(x.row),
    });
    cBody.insertAdjacentHTML("beforeend", `<p class="adv-note adv-rule">${esc(cam.rule || "")}</p><p class="adv-note">${esc(cam.attribution || "")}. ${esc(cam.vintage || "")}.</p>`);
  }

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [...(won?.sources || []), "ige_ramas", "ige_afiliacion", "ige_unidades", ...(hasCamino ? ["ign_camino"] : [])], [
    "La lista del Patrimonio Mundial sale de Wikidata, no es la lista oficial de la UNESCO: puede faltar o sobrar algún elemento.",
    "La superficie de un BIC se cruza con su punto por una regla heurística y mide extensión, no valor ni grado de protección.",
    "El rendimiento Cultura es una estimación de afiliados de una rama amplia, no un recuento de empleo cultural.",
    "El directorio de unidades locales no incluye el sector primario ni la administración pública.",
    ...(hasCamino ? ["El trazado de los Caminos es una ayuda a la marcha, no el trazado definitivo (aviso del CNIG). Los km por concello se miden sobre ese trazado."] : []),
  ]));

  return {
    onMapHover(h) {
      const yr = h.cell >= 0 ? yieldLevel.rowAtCell(h.cell) : null;
      yieldBars?.setHot(yr ? yr.key : null);
      const c = h.cell >= 0 && counties ? counties.rowAtCell(h.cell) : null;
      plazaBars?.setHot(c ? c.key : null);
      caminoTop?.setHot(c ? c.key : null);
      if (h.item?.kind === "wonder") for (const w of wonderBars) w.setHot(h.item.data?.id ?? null);
    },
    onMapClick(ev) {
      if (ev.item?.kind !== "wonder") return false;
      flyTo(wonders.find((w) => w.id === ev.item.data?.id));
      return true;
    },
  };
}

/** The figure a wonder's rule gives it ("" for World Heritage, which is not ranked by any). */
function metricText(w) {
  const m = w.metrics || {};
  if (fin(m.protected_km2)) return `${dec(m.protected_km2 * 100, 1)} ha`;
  if (fin(m.area_km2)) return `${dec(m.area_km2, 1)} km²${m.declared ? ` · desde ${m.declared}` : ""}`;
  return "";
}
