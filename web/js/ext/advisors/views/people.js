// People advisor: where people live, density, age and place of birth.
import { esc, fin, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { pct, int, dec, count3, fmtShort } from "../core/fmt.js";
import { barList, stackedBars, shareBar, histogram, rampLegend } from "../core/charts.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, mapPicker, frameBtn, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight, extendData } from "../core/data.js";
import { growthLens } from "../core/lenses.js";
import { t } from "../../../i18n.js";

const AGE_COLOR = { child: "#f6dc8a", young: "#7fbf8e", midlife: "#4f8fa8", elder: "#a8639e" };
const BIRTH_COLOR = { same_concello: "#c9a45c", galicia: "#8fb86a", spain: "#5a9ad0", abroad: "#d8675c" };
const years = (v) => (fin(v) ? t("{n} años", { n: dec(v, 1) }) : "–");

const perKm2 = (v) => (fin(v) ? `${v >= 100 ? int(v) : dec(v, 1)} hab./km²` : "–");

export async function mount(ctx) {
  const { data, el, link } = ctx;
  const gal = data.galicia;
  const { states, metros, counties } = data.levels;
  const cz = (await extendData(data, ["citizens"])).citizens;
  if (!el.isConnected) return {}; // switched away while the file loaded

  const nat = cz?.national;
  const meanAge = nat?.age?.mean ?? gal.edad_media;
  const cityPop = popOf(metros.rows);
  const outside = nat ? nat.nativity.shares.spain + nat.nativity.shares.abroad : gal.nacidos_fuera;
  el.insertAdjacentHTML("beforeend", tiles([
    { label: t("Habitantes"), value: count3(gal.population), sub: perKm2(gal.density) },
    { label: t("Edad media"), value: years(meanAge), sub: cz ? t("Padrón {year}", { year: cz.year }) : t("media de los concellos") },
    { label: t("Nacidos fuera"), value: pct(outside), sub: t("fuera de Galicia") },
  ]));

  // --- the map: density by default, so the map tells the same story as the first chart --------------------------
  const mapRow = document.createElement("div");
  mapRow.className = "adv-sec adv-mapsec";
  el.appendChild(mapRow);
  const lensOpt = (value, label) => ({ value, label, lens: () => value });
  const picker = mapPicker(ctx, mapRow, {
    value: "density",
    options: [
      lensOpt("density", t("Densidad")), lensOpt("edad_media", t("Edad media")), lensOpt("nacidos_fuera", t("Nacidos fuera")),
      ...(counties?.field("growth") ? [{ value: "growth", label: t("Variación"), lens: () => growthLens(data) }] : []),
      { value: "terrain", label: t("Terreno"), lens: () => null },
    ],
  });

  // --- where people live ----------------------------------------------------------------------------------------
  const wBody = section(el, { title: t("Dónde vive la gente"), note: t("Las {n} ciudades (concellos de 10 000 habitantes o más) reúnen el {p} de la población de Galicia. Pasa el puntero por una barra para verla en el mapa; pulsa para ir.", { n: int(metros.rows.length), p: pct(cityPop / gal.population) }) });
  const wCtl = document.createElement("div");
  wCtl.className = "adv-row";
  wBody.appendChild(wCtl);
  let wLevel = counties ? "counties" : "states", wKey = "population";
  if (counties) segmented(wCtl, { label: t("Territorio"), value: wLevel, options: [{ value: "counties", label: t("Concellos") }, { value: "states", label: t("Comarcas") }], onChange: (v) => { wLevel = v; drawWhere(); } });
  segmented(wCtl, { label: t("Orden"), value: wKey, options: [{ value: "population", label: t("Habitantes") }, { value: "density", label: t("Densidad") }], onChange: (v) => { wKey = v; drawWhere(); } });
  const wHost = document.createElement("div");
  wBody.appendChild(wHost);
  let wBars = null;
  const wView = () => (wLevel === "counties" ? counties : states);
  function drawWhere() {
    wHost.innerHTML = "";
    const lv = wView();
    const byPop = wKey === "population";
    const rows = topBy(lv.rows, (r) => r.v[wKey], { n: 10 }).map((x) => ({
      key: x.r.key, label: x.r.name, sub: x.r.sub === x.r.name ? "" : x.r.sub, value: x.v, row: x.r,
      text: byPop ? count3(x.v) : perKm2(x.v),
    }));
    wBars = barList(wHost, {
      rows, rank: true, ariaLabel: byPop ? t("Territorios con más habitantes") : t("Territorios con más densidad"),
      onHover: (r) => link.hover(r ? rowsHighlight(lv, [r.row]) : null),
      onClick: (r) => lv.focus(r.row),
    });
  }
  drawWhere();

  // --- density --------------------------------------------------------------------------------------------------
  let hist = null, drawHist = null, pinnedBin = null, binInfo = null;
  if (counties) {
    const dBody = section(el, { title: t("Densidad"), note: t("Concellos según sus habitantes por km² (escala logarítmica). Elige <i>habitantes</i> para que cada concello pese según su población. Pasa el puntero por una barra para ver esos concellos; pulsa para dejarlos marcados.") });
    const dCtl = document.createElement("div");
    dCtl.className = "adv-row";
    dBody.appendChild(dCtl);
    let weighted = false;
    segmented(dCtl, { label: t("Contar"), value: "counties", options: [{ value: "counties", label: t("Concellos") }, { value: "people", label: t("Habitantes") }], onChange: (v) => { weighted = v === "people"; drawHist(); } });
    const dLens = document.createElement("button");
    dLens.type = "button";
    dLens.className = "adv-mini";
    dLens.textContent = t("Colorear el mapa por densidad");
    dLens.addEventListener("click", () => picker.set("density"));
    dCtl.appendChild(dLens);
    const histHost = document.createElement("div");
    dBody.appendChild(histHost);
    binInfo = document.createElement("div");
    binInfo.className = "adv-brushinfo";
    dBody.appendChild(binInfo);
    const cByKey = counties.byKey;
    const densRamp = RAMPS.heat;
    drawHist = () => {
      histHost.innerHTML = "";
      const vals = counties.rows.map((r) => ({ key: r.key, v: r.v.density, w: r.v.population }));
      const dom = [2, 7000];
      hist = histogram(histHost, {
        values: vals, log: true, bins: 30, domain: dom, weighted, height: 130,
        fmt: (v) => fmtShort("float", v), unitLabel: t("concellos"), weightFmt: (w) => t("{n} habitantes", { n: count3(w) }),
        label: t("Histograma de la densidad de población de los concellos"),
        colorOf: (_, tk) => colorScale({ type: "seq", domain: [0, 1], ramp: densRamp })(tk),
        markers: [{ v: gal.density, label: t("Media de Galicia") }],
        onHover: (bin) => link.hover(bin ? rowsHighlight(counties, bin.keys.map((k) => cByKey.get(k)), { dim: true }) : null),
        onClick: (bin) => {
          pinnedBin = pinnedBin === bin.i ? null : bin.i;
          const rows = pinnedBin != null ? bin.keys.map((k) => cByKey.get(k)) : [];
          link.base(rows.length ? rowsHighlight(counties, rows, { dim: true }) : null, { frame: rows.length > 1 });
          binInfo.innerHTML = rows.length ? `${t("<b>{n}</b> {noun} de {a} a {b} hab./km² · {pop} habitantes", { n: int(rows.length), noun: rows.length === 1 ? t("concello") : t("concellos"), a: fmtShort("float", bin.x0), b: fmtShort("float", bin.x1), pop: count3(popOf(rows)) })} ${frameBtn()}<button type="button" class="adv-mini" data-clear>${t("Quitar")}</button>` : "";
        },
      });
    };
    binInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) { pinnedBin = null; link.base(null); binInfo.innerHTML = ""; } });
    drawHist();
  }

  // --- age and birthplace of the cities -------------------------------------------------------------------------
  const cityBars = []; // the current stacked bars of each block, for the map hover
  // One block: Galicia as a single bar (a click on its legend re-sorts the list) and the same split for some cities.
  function cityBlock({ row, title, note, colors, sorts }) {
    const body = section(el, { title, note });
    const groups = cz.groups[row];
    body.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${t("Toda Galicia")}</h4>`);
    shareBar(body, {
      parts: groups.map((g) => ({ key: g.key, label: g.label, value: nat[row].counts[g.key], text: t("{n} habitantes", { n: int(nat[row].counts[g.key]) }), color: colors[g.key] })),
      onClick: (p) => {
        seg.set("__none");
        draw({ of: (c) => c[row].shares[p.key], fmt: (v) => pct(v), caption: t("Dónde pesa más: {grupo}", { grupo: p.label.toLowerCase() }) });
      },
    });
    const ctl = document.createElement("div");
    ctl.className = "adv-row";
    body.appendChild(ctl);
    const seg = segmented(ctl, { label: t("Orden de las ciudades"), value: sorts[0].value, options: sorts, onChange: (v) => draw(sorts.find((s) => s.value === v)) });
    const host = document.createElement("div");
    body.appendChild(host);
    const slot = cityBars.push(null) - 1;
    function draw(sort) {
      host.innerHTML = `<h4 class="adv-h4">${esc(sort.caption)}</h4>`;
      const list = topBy(metros.rows, (r) => (cz.cities[r.key] ? sort.of(cz.cities[r.key]) : null), { n: 8, asc: !!sort.asc });
      cityBars[slot] = stackedBars(host, {
        rows: list.map((x) => ({ key: x.r.key, label: x.r.name, parts: cz.cities[x.r.key][row].shares, total: 1, text: sort.fmt(x.v), row: x.r })),
        keys: groups.map((g) => ({ key: g.key, label: g.label, color: colors[g.key] })),
        normalize: true, fmt: (v) => pct(v), ariaLabel: sort.caption,
        onHover: (h) => link.hover(h?.row ? rowsHighlight(metros, [h.row.row]) : null),
        onClick: (h) => metros.focus(h.row.row),
      });
    }
    draw(sorts[0]);
  }
  if (cz) {
    cityBlock({
      row: "age", title: t("Qué edad tiene"), colors: AGE_COLOR,
      note: t("Reparto por edad en cuatro tramos; cada barra de la lista es una ciudad. Pulsa un tramo de la leyenda para ver en qué ciudades pesa más."),
      sorts: [
        { value: "old", label: t("Más mayores"), of: (c) => c.age.mean, fmt: years, caption: t("Ciudades con la edad media más alta") },
        { value: "young", label: t("Más jóvenes"), of: (c) => c.age.mean, asc: true, fmt: years, caption: t("Ciudades con la edad media más baja") },
      ],
    });
    cityBlock({
      row: "nativity", title: t("Dónde nació"), colors: BIRTH_COLOR,
      note: t("Habitantes por lugar de nacimiento. Nacer fuera no es lo mismo que tener otra nacionalidad: en Galicia tiene nacionalidad extranjera el {p}.", { p: pct(nat.foreign_nationals) }),
      sorts: [
        { value: "outside", label: t("Fuera de Galicia"), of: (c) => c.nativity.shares.spain + c.nativity.shares.abroad, fmt: (v) => pct(v), caption: t("Ciudades con más nacidos fuera de Galicia") },
        { value: "abroad", label: t("En el extranjero"), of: (c) => c.nativity.shares.abroad, fmt: (v) => pct(v), caption: t("Ciudades con más nacidos en el extranjero") },
      ],
    });
  }

  // --- age and born outside Galicia, concello by concello -------------------------------------------------------
  let scatter = null, selInfo = null;
  if (counties) {
    const aBody = section(el, { title: t("Edad y origen por concello"), note: t("Cada punto es un concello: edad media en horizontal, nacidos fuera de Galicia en vertical, tamaño según habitantes y color según densidad. Arrastra un rectángulo para seleccionar concellos y verlos en el mapa.") });
    const aCtl = document.createElement("div");
    aCtl.className = "adv-row";
    aBody.appendChild(aCtl);
    aCtl.innerHTML = `<span class="adv-note">${t("Colorear el mapa por")}</span><button type="button" class="adv-mini" data-map="edad_media">${t("edad media")}</button><button type="button" class="adv-mini" data-map="nacidos_fuera">${t("nacidos fuera")}</button>`;
    aCtl.addEventListener("click", (e) => { const v = e.target.closest("[data-map]")?.dataset.map; if (v) picker.set(v); });
    const dDom = robustDomain(counties.rows.map((r) => r.v.density), 0.02, true) || [3, 700];
    const dColor = colorScale({ type: "seq", domain: dDom, log: true, ramp: RAMPS.heat });
    const big = topBy(counties.rows, (r) => r.v.population, { n: 7 }).map((x) => x.r.key);
    const mid = medianOf(counties.rows, "edad_media");
    scatter = createScatter(aBody, {
      height: 310,
      points: counties.rows.map((r) => ({ key: r.key, x: r.v.edad_media, y: r.v.nacidos_fuera, s: r.v.population, c: r.v.density, label: r.name, sub: r.sub, row: r })),
      x: { label: t("Edad media (años)"), fmt: (v) => dec(v, Number.isInteger(v) ? 0 : 1) },
      y: { label: t("Nacidos fuera de Galicia"), fmt: (v) => fmtShort("pct", v) },
      size: { label: t("Habitantes"), fmt: count3, max: 14, min: 1.4 },
      color: (c) => dColor(c), colorLabel: t("Densidad"), colorFmt: perKm2,
      labels: big,
      refX: fin(mid) ? [{ v: mid, label: t("mediana") }] : [],
      ariaLabel: t("Diagrama de dispersión de los concellos: nacidos fuera de Galicia frente a edad media"),
      onHover: (p) => link.hover(p ? rowsHighlight(counties, [p.row]) : null),
      onClick: (p) => counties.focus(p.row),
      onBrush: (set) => {
        const sel = set ? counties.rows.filter((r) => set.has(r.key)) : [];
        link.base(sel.length ? rowsHighlight(counties, sel, { dim: true }) : null, { frame: sel.length > 1 });
        selInfo.innerHTML = sel.length ? selSummary(sel) : "";
      },
    });
    aBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.heat, domain: dDom, log: true, fmt: (v) => fmtShort("float", v), label: t("Habitantes por km²") }));
    selInfo = document.createElement("div");
    selInfo.className = "adv-brushinfo";
    aBody.appendChild(selInfo);
    selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) { scatter.setSelected(null); link.base(null); selInfo.innerHTML = ""; } });
  } else {
    el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">${t("No se han podido cargar los datos de los concellos.")}</p>`);
  }
  function selSummary(sel) {
    const pop = popOf(sel);
    const top = [...sel].sort((a, b) => (b.v.population || 0) - (a.v.population || 0)).slice(0, 5);
    return `${t("<b>{n}</b> {noun} · {pop} habitantes ({p} de Galicia)", { n: int(sel.length), noun: sel.length === 1 ? t("concello") : t("concellos"), pop: count3(pop), p: pct(pop / gal.population) })}<br><span class="sub">${t("Los más poblados: {lista}", { lista: top.map((r) => esc(r.name)).join(" · ") })}</span> ${frameBtn()}<button type="button" class="adv-mini" data-clear>${t("Quitar")}</button>`;
  }

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["ine_padron", "ige_poboacion", "ige_comarcas", "ign_limites"], [
    t("La densidad es la población entre la superficie, calculada de un contorno simplificado de los concellos (escala 1:1M)."),
    t("«Nacidos fuera de Galicia» suma a quienes nacieron en otra comunidad autónoma o en el extranjero."),
    ...(nat ? [t("Los habitantes salen del padrón del INE y los repartos por edad y lugar de nacimiento, de las tablas del IGE. Sus totales no coinciden exactamente (Galicia: {a} y {b}).", { a: int(gal.population), b: int(nat.age.total) })] : []),
    ...(data.countiesOffMap ? [t("{n} concellos no ocupan ninguna casilla, así que al seleccionarlos no se marca nada en el mapa.", { n: int(data.countiesOffMap) })] : []),
  ]));

  return {
    onMapHover(h) {
      const on = h.cell >= 0;
      const county = on && counties ? counties.rowAtCell(h.cell) : null;
      const city = on ? metros.rowAtCell(h.cell) : null;
      const where = wLevel === "counties" ? county : on ? states.rowAtCell(h.cell) : null;
      wBars?.setHot(where ? where.key : null);
      for (const b of cityBars) b?.setHot(city ? city.key : null);
      scatter?.setHot(county ? county.key : null);
      hist?.setHot(county ? hist.binOf(county.v.density)?.i ?? null : null);
    },
    onEscape() {
      if (scatter?.selected || pinnedBin != null) {
        scatter?.setSelected(null); pinnedBin = null; link.base(null);
        if (selInfo) selInfo.innerHTML = "";
        if (binInfo) binInfo.innerHTML = "";
        return true;
      }
      return false;
    },
    destroy() { scatter?.destroy(); },
  };
}

const popOf = (rows) => rows.reduce((a, r) => a + (r.v.population || 0), 0);

function medianOf(rows, k) {
  const s = rows.map((r) => r.v[k]).filter(fin).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}
