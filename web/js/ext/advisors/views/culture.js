// Culture advisor ("Custodia de las maravillas"): wonders by published rule (wonders.json), the Culture yield (an
// estimate of the affiliates of one IGE branch, not of people who work in culture) and the concellos with a culture
// district (districts.json, which counts establishments).
import { esc, fin, ratio, el as mk } from "../core/util.js";
import { int, pct, dec, count3 } from "../core/fmt.js";
import { barList } from "../core/charts.js";
import { section, tiles, segmented, mapPicker, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { stateLens } from "../core/lenses.js";

// One entry per rule of wonders.json: the short label of the filter and the marker colour.
const RULES = {
  unesco: { short: "UNESCO", color: "#e0b54c" },
  bic: { short: "BIC", color: "#c25b9a" },
  parque_nacional: { short: "Parque", color: "#6aa84f" },
};
const ruleColor = (id) => RULES[id]?.color || "#ccc";
const BRANCH = "AAPP, Educación, Sanidade e outros servizos";
const SHARE_RAMP = ["#221030", "#43215c", "#6a3790", "#9556c0", "#bd8be0", "#efe0fa"];

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const [won, dist] = await Promise.all(["wonders", "districts"].map((f) => app.loadData(f).catch(() => null)));
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
  if (fin(galShare)) {
    const shareLens = () => stateLens(data, "culture-branch", (_, r) => share(r), {
      group: "work", name: "Peso de la rama Cultura", unit: "de las personas afiliadas", format: "pct", source: "ige_ramas", ramp: SHARE_RAMP,
      description: `Estimación de las personas afiliadas en la rama «${BRANCH}» entre todas las afiliadas que viven en la comarca (IGE). No son trabajadores de la cultura.`,
    });
    const mapRow = mk("div", "adv-sec adv-mapsec");
    el.appendChild(mapRow);
    picker = mapPicker(ctx, mapRow, {
      value: "terrain",
      options: [
        { value: "terrain", label: "Terreno", lens: () => null },
        { value: "share", label: "Peso de la rama", lens: shareLens },
      ],
    });
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
    if (picker) {
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

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [...(won?.sources || []), "ige_ramas", "ige_afiliacion", "ige_unidades"], [
    "La lista del Patrimonio Mundial sale de Wikidata, no es la lista oficial de la UNESCO: puede faltar o sobrar algún elemento.",
    "La superficie de un BIC se cruza con su punto por una regla heurística y mide extensión, no valor ni grado de protección.",
    "El rendimiento Cultura es una estimación de afiliados de una rama amplia, no un recuento de empleo cultural.",
    "El directorio de unidades locales no incluye el sector primario ni la administración pública.",
  ]));

  return {
    onMapHover(h) {
      const yr = h.cell >= 0 ? yieldLevel.rowAtCell(h.cell) : null;
      yieldBars?.setHot(yr ? yr.key : null);
      const c = h.cell >= 0 && counties ? counties.rowAtCell(h.cell) : null;
      plazaBars?.setHot(c ? c.key : null);
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
