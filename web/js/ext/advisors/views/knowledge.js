// Knowledge advisor: higher education, professional occupations, the Science yield and the tech district.
import { esc, fin, ratio, robustDomain, colorScale, RAMPS } from "../core/util.js";
import { euros, pct, int, dec, count3, fmtShort } from "../core/fmt.js";
import { barList, stackedBars, histogram, swatchLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, mapPicker, frameBtn, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight, extendData } from "../core/data.js";
import { scienceLens } from "../core/lenses.js";
import { t, prep } from "../../../i18n.js";

const STUDY_COLORS = { primary: "#7d6c55", lower_secondary: "#ab9468", upper_secondary: "#4a74ad", higher: "#9cd0f5" };
const JOB_COLORS = { cno2: "#4a86d6", cno3: "#a9d3f2" };
const GAL = "galicia"; // key of the Galicia reference row in the city charts
const times = (x) => (fin(x) ? `×${dec(x, 2)}` : "–");
// City names wrap instead of being cut: "Santiago de Compostela ×1,53" does not fit the label column.
const wrapNames = (host) => host.querySelectorAll(".adv-srow .lb").forEach((n) => (n.style.whiteSpace = "normal"));
// Round thousands (the axis ticks) are short so they clear the axis title; other incomes stay exact.
const income = (v) => (fin(v) && v >= 1000 && v % 1000 === 0 ? `${int(v / 1000)} mil` : euros(v));

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const files = await extendData(data, ["districts", "citizens"]);
  const cz = files.citizens;
  const districts = files.districts;
  const { metros, counties } = data.levels;
  const galicia = data.galicia;
  const sci = app.data.nation.yields?.find((y) => y.key === "science");
  const galSci = galicia.y_science;
  const galSciShare = ratio(galSci, galicia.affiliates);
  const galStudies = cz?.national?.education?.shares?.higher;
  const galJobs = cz?.national?.workforce?.shares;
  const hoverCity = (r) => link.hover(r?.row ? rowsHighlight(metros, [r.row]) : null);

  el.insertAdjacentHTML("beforeend", tiles([
    ...(fin(galStudies) ? [{ label: t("Estudios superiores"), value: pct(galStudies), sub: t("15 años o más, Censo 2021") }] : []),
    ...(galJobs ? [{ label: t("Profesionales y técnicos"), value: pct(galJobs.cno2 + galJobs.cno3), sub: t("ocupados, Censo 2021") }] : []),
    { label: t("Rama de Ciencia ≈"), value: count3(galSci), sub: t("{p} de la afiliación", { p: pct(galSciShare) }), color: sci?.color },
  ]));

  // --- the map: higher education by default, or the Science yield's share by city --------------------------------
  const mapRow = document.createElement("div");
  mapRow.className = "adv-sec adv-mapsec";
  el.appendChild(mapRow);
  const hasStudies = app.lensById?.has("estudios_superiores");
  const picker = mapPicker(ctx, mapRow, {
    value: hasStudies ? "estudios" : "science",
    options: [
      ...(hasStudies ? [{ value: "estudios", label: t("Estudios superiores"), lens: () => "estudios_superiores" }] : []),
      { value: "science", label: t("Rama de Ciencia"), lens: () => scienceLens(data) },
      { value: "terrain", label: t("Terreno"), lens: () => null },
    ],
  });

  // --- higher education: concellos and cities -------------------------------------------------------------------
  let scatter = null, hist = null, table = null;
  let level = "counties";
  const lv = () => data.levels[level];
  let clearSel = () => {};
  if (counties) {
    const studies = counties.rows.map((r) => r.v.estudios_superiores);
    const dom = robustDomain(studies, 0) || [0, 0.5];
    const eBody = section(el, {
      title: t("Estudios superiores"),
      note: t("Personas de 15 años o más con educación superior (Censo 2021). El histograma reparte los {n} concellos: pasa el puntero por una barra para verlos en el mapa.", { n: int(counties.rows.length) }),
    });
    const color = colorScale({ type: "seq", domain: [0, 1], ramp: RAMPS.seq });
    hist = histogram(eBody, {
      values: counties.rows.map((r) => ({ key: r.key, v: r.v.estudios_superiores })), bins: 28, domain: dom, height: 120,
      fmt: (v) => fmtShort("pct", Math.round(v * 100) / 100), unitLabel: t("concellos"), label: t("Histograma de estudios superiores por concello"),
      markers: fin(galStudies) ? [{ v: galStudies, label: t("Galicia {p}", { p: pct(galStudies) }) }] : [],
      colorOf: (_, ty) => color(ty),
      onHover: (bin) => link.hover(bin?.keys.length ? rowsHighlight(counties, bin.keys.map((k) => counties.byKey.get(k)), { dim: true }) : null),
    });
    const ctl = document.createElement("div");
    ctl.className = "adv-row";
    eBody.appendChild(ctl);
    segmented(ctl, {
      label: t("Lugares"), value: level,
      options: [{ value: "counties", label: t("Concellos") }, { value: "metros", label: t("Ciudades") }],
      onChange: (v) => { level = v; drawLevel(); },
    });
    table = createTable(eBody, {
      caption: t("Estudios superiores por lugar"), rank: true, maxHeight: 240, search: t("Buscar un lugar"), rows: [],
      columns: [
        { key: "name", label: t("Lugar"), align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>` },
        { key: "population", label: t("Habitantes"), value: (r) => r.v.population, text: (r) => count3(r.v.population) },
        { key: "estudios_superiores", label: t("Superiores"), value: (r) => r.v.estudios_superiores, text: (r) => pct(r.v.estudios_superiores), bar: { max: dom[1], color: "rgba(74,134,214,.4)" } },
      ],
      sort: { key: "estudios_superiores", dir: "desc" },
      onHover: (r) => { link.hover(r ? rowsHighlight(lv(), [r]) : null); scatter?.setHot(r ? r.key : null); },
      onClick: (r) => lv().focus(r),
    });

    // --- studies vs income --------------------------------------------------------------------------------------
    const dBody = section(el, {
      title: t("Estudios y renta"),
      note: t("Cada punto es un lugar (los mismos que en la tabla anterior): estudios superiores (2021) frente a renta neta media por persona (INE, 2024). Arrastra para seleccionar o pasa por el mapa para encontrar un lugar."),
    });
    const selInfo = document.createElement("div");
    selInfo.className = "adv-brushinfo";
    scatter = createScatter(dBody, {
      height: 300, points: [],
      x: { label: t("Estudios superiores"), fmt: (v) => fmtShort("pct", v) },
      y: { label: t("Renta neta por persona (€)"), fmt: income },
      size: { label: t("Habitantes"), fmt: count3, max: 14, min: 1.8 },
      onHover: (p) => { link.hover(p ? rowsHighlight(lv(), [p.row]) : null); table.setHot(p ? p.key : null, false); },
      onClick: (p) => lv().focus(p.row),
      onBrush: (set) => {
        const sel = set ? lv().rows.filter((r) => set.has(r.key)) : [];
        link.base(sel.length ? rowsHighlight(lv(), sel, { dim: true }) : null, { frame: sel.length > 1 });
        table.setSelected(set);
        const noun = sel.length === 1 ? lv().noun : lv().label.toLowerCase();
        selInfo.innerHTML = sel.length ? `<b>${int(sel.length)}</b> ${esc(noun)} · ${t("{n} habitantes", { n: count3(sel.reduce((a, r) => a + (r.v.population || 0), 0)) })} ${frameBtn()}<button type="button" class="adv-mini" data-clear>${t("Quitar")}</button>` : "";
      },
    });
    dBody.appendChild(selInfo);
    clearSel = () => { scatter.setSelected(null); table.setSelected(null); link.base(null); selInfo.innerHTML = ""; };
    selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clearSel(); });
  }
  function drawLevel() {
    if (!scatter) return;
    clearSel();
    const rows = lv().rows;
    table.setRows(rows);
    scatter.update({
      points: rows.map((r) => ({ key: r.key, x: r.v.estudios_superiores, y: r.v.renta_pc, s: r.v.population, label: r.name, sub: r.sub, row: r })),
      labels: topBy(rows, (r) => r.v.population, { n: 6 }).map((x) => x.r.key),
    });
  }
  drawLevel();

  // --- cities: the education mix and the professional occupations ------------------------------------------------
  if (cz) {
    const cityRows = (rowName) => metros.rows.filter((r) => cz.cities?.[r.key]?.[rowName]?.shares).map((r) => ({ r, s: cz.cities[r.key][rowName].shares }));

    // education mix
    const keys = (cz.groups?.education || []).map((g) => ({ key: g.key, label: g.short, color: STUDY_COLORS[g.key] }));
    const mix = cityRows("education");
    const mBody = section(el, {
      title: t("Reparto de estudios en las ciudades"),
      note: t("Personas de 15 años o más según su nivel de estudios (Censo 2021) en las {n} ciudades, con Galicia como referencia. El número de la derecha es la parte del nivel elegido.", { n: int(mix.length) }),
    });
    const mHost = document.createElement("div");
    let by = "higher", all = false;
    segmented(mBody, {
      label: t("Ordenar por"), value: by,
      options: keys.slice().reverse().map((k) => ({ value: k.key, label: k.label })),
      onChange: (v) => { by = v; drawMix(); },
    });
    mBody.insertAdjacentHTML("beforeend", swatchLegend(keys));
    mBody.appendChild(mHost);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "adv-mini";
    more.addEventListener("click", () => { all = !all; drawMix(); });
    mBody.appendChild(more);
    function drawMix() {
      mHost.innerHTML = "";
      const sorted = mix.slice().sort((a, b) => b.s[by] - a.s[by]);
      const rows = (all ? sorted : sorted.slice(0, 12)).map((x) => ({ key: x.r.key, label: x.r.name, parts: x.s, total: 1, text: pct(x.s[by]), row: x.r }));
      const nat = cz.national?.education?.shares;
      if (nat) rows.unshift({ key: GAL, label: t("Galicia"), parts: nat, total: 1, text: pct(nat[by]), row: null });
      stackedBars(mHost, {
        rows, keys, normalize: true, fmt: (v) => pct(v), ariaLabel: t("Reparto de estudios por ciudad"),
        onHover: (x) => hoverCity(x?.row),
        onClick: (x) => { if (x.row?.row) metros.focus(x.row.row); },
      });
      wrapNames(mHost);
      more.textContent = all ? t("Ver solo las 12 primeras") : t("Ver las {n} ciudades", { n: int(mix.length) });
    }
    drawMix();

    // professional and technical occupations
    const label = new Map((cz.groups?.workforce || []).map((g) => [g.key, g]));
    const jobKeys = ["cno2", "cno3"].map((k) => ({ key: k, label: label.get(k)?.label || k, color: JOB_COLORS[k] }));
    const jobs = cityRows("workforce");
    const oBody = section(el, {
      title: t("Profesionales y técnicos"),
      note: t("Parte de las personas ocupadas que viven en cada ciudad (Censo 2021) en dos grupos de ocupación. Junto al nombre, las veces que representa la parte de Galicia. Las 12 ciudades con más peso."),
    });
    const oHost = document.createElement("div");
    let group = "both";
    segmented(oBody, {
      label: t("Grupo"), value: group,
      options: [{ value: "both", label: t("Los dos") }, { value: "cno2", label: label.get("cno2")?.short || "cno2" }, { value: "cno3", label: label.get("cno3")?.short || "cno3" }],
      onChange: (v) => { group = v; drawJobs(); },
    });
    oBody.insertAdjacentHTML("beforeend", swatchLegend(jobKeys));
    oBody.appendChild(oHost);
    function drawJobs() {
      oHost.innerHTML = "";
      const shown = group === "both" ? jobKeys : jobKeys.filter((k) => k.key === group);
      const val = (s) => shown.reduce((a, k) => a + (s?.[k.key] || 0), 0);
      const base = val(galJobs);
      const list = jobs.slice().sort((a, b) => val(b.s) - val(a.s)).slice(0, 12);
      const max = Math.max(base, ...list.map((x) => val(x.s)));
      const parts = (s) => Object.fromEntries(shown.map((k) => [k.key, s[k.key]]));
      const rows = list.map((x) => ({ key: x.r.key, label: x.r.name, sub: times(ratio(val(x.s), base)), parts: parts(x.s), text: pct(val(x.s)), row: x.r }));
      if (galJobs) rows.unshift({ key: GAL, label: t("Galicia"), parts: parts(galJobs), text: pct(base), row: null });
      stackedBars(oHost, {
        rows, keys: shown, max, fmt: (v) => pct(v), ariaLabel: t("Profesionales y técnicos por ciudad"),
        onHover: (x) => hoverCity(x?.row),
        onClick: (x) => { if (x.row?.row) metros.focus(x.row.row); },
      });
      wrapNames(oHost);
    }
    drawJobs();
  }

  // --- the Science yield ----------------------------------------------------------------------------------------
  const sBody = section(el, { title: t("El rendimiento de Ciencia"), note: esc(sci?.description || "") });
  const sHost = document.createElement("div");
  let mode = "share";
  segmented(sBody, {
    label: t("Ordenar por"), value: mode,
    options: [{ value: "share", label: t("Peso en la afiliación") }, { value: "abs", label: t("Más personas") }],
    onChange: (v) => { mode = v; drawSci(); },
  });
  const sMap = document.createElement("button");
  sMap.type = "button";
  sMap.className = "adv-mini";
  sMap.textContent = t("Colorear el mapa con esta rama");
  sMap.addEventListener("click", () => picker.set("science"));
  sBody.append(sMap, sHost);
  const share = (r) => ratio(r.v.y_science, r.v.affiliates);
  function drawSci() {
    sHost.innerHTML = "";
    const list = topBy(metros.rows, mode === "abs" ? (r) => r.v.y_science : share, { n: 12 });
    barList(sHost, {
      rank: true, ariaLabel: t("Ciudades en la rama de Ciencia"),
      rows: list.map((x) => ({
        key: x.r.key, label: x.r.name, value: x.v, color: sci?.color, row: x.r,
        sub: mode === "abs" ? pct(share(x.r)) : t("{x} Galicia", { x: times(ratio(share(x.r), galSciShare)) }),
        text: mode === "abs" ? `≈ ${count3(x.v)}` : pct(x.v),
      })),
      onHover: hoverCity,
      onClick: (r) => metros.focus(r.row),
    });
  }
  drawSci();

  // --- tech district --------------------------------------------------------------------------------------------
  const tech = districts?.catalog?.find((c) => c.id === "tech");
  if (tech && counties) {
    const techOf = (r) => districts.counties?.[r.key]?.districts?.find((d) => d[0] === "tech");
    const places = counties.rows.filter(techOf);
    const galUnits = tech.divisions.reduce((a, k) => a + (districts.divisions?.[k]?.units || 0), 0);
    const specialty = (r) => {
      const d = districts.cities?.[r.key]?.districts?.find((x) => x.id === "tech");
      return d?.sub ? t("{sub}: {n} establecimientos, {x}", { sub: tech.sub?.[d.sub] || d.sub, n: int(d.sub_units), x: times(d.sub_lq) }) : "";
    };
    const tBody = section(el, {
      title: tech.name,
      note: `${esc(tech.description)} ${t("Cumplen la regla {n} concellos. En toda Galicia hay {u} establecimientos de estas actividades, el {p} del total (IGE, {y}). Se cuentan establecimientos (unidades locales).", { n: int(places.length), u: int(galUnits), p: pct(ratio(galUnits, districts.national?.units)), y: esc(districts.year) })}`,
    });
    createTable(tBody, {
      caption: t("Concellos con distrito tecnológico"), rank: true, maxHeight: 280, rows: places,
      columns: [
        { key: "name", label: t("Concello"), align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>` },
        { key: "units", label: t("Estab."), title: t("Establecimientos de tecnología"), value: (r) => techOf(r)[2], text: (r) => int(techOf(r)[2]) },
        { key: "share", label: t("Del total"), title: t("Parte de los establecimientos del concello"), value: (r) => ratio(techOf(r)[2], r.v.units), text: (r) => pct(ratio(techOf(r)[2], r.v.units)) },
        { key: "lq", label: t("Cociente"), title: t("Cociente de localización frente a Galicia"), value: (r) => techOf(r)[1], text: (r) => times(techOf(r)[1]), bar: { max: Math.max(...places.map((r) => techOf(r)[1])), color: "rgba(74,123,208,.4)" } },
      ],
      sort: { key: "lq", dir: "desc" },
      onHover: (r) => link.hover(r ? rowsHighlight(counties, [r]) : null),
      onClick: (r) => counties.focus(r),
    });
    for (const r of places) {
      const s = specialty(r);
      if (s) tBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${t("Especialidad {lugar}: {s} la parte de Galicia.", { lugar: esc(prep("en", r.name)), s: esc(s) })}</p>`);
    }
    if (districts.rule?.text) tBody.insertAdjacentHTML("beforeend", `<details class="adv-note"><summary class="adv-link" style="cursor:pointer">${t("Cómo se decide un distrito")}</summary><p>${esc(districts.rule.text)}</p></details>`);
  }

  if (!counties) el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">${t("No se han podido cargar los datos por concello, así que faltan sus gráficos.")}</p>`);

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["ige_censo", "ige_ramas", "ige_afiliacion", "ige_unidades", "ine_adrh"], [
    t("La rama de Ciencia es una estimación: el porcentaje de la rama en 2024 aplicado a la afiliación de septiembre de 2026. Incluye finanzas e inmobiliarias."),
    t("Estudios, ocupaciones y afiliación se cuentan donde vive cada persona, no donde trabaja o estudió."),
    t("Estudios y ocupaciones son del Censo de 2021. La parte por ocupación deja fuera a las personas sin ocupación declarada."),
    t("El mapa de la rama de Ciencia colorea solo las ciudades: las casillas en gris quedan fuera de ellas."),
    t("El distrito tecnológico cuenta establecimientos: uno grande pesa lo mismo que uno pequeño."),
  ]));

  return {
    onMapHover(h) {
      if (!counties) return;
      const r = h.cell >= 0 ? lv().rowAtCell(h.cell) : null;
      scatter?.setHot(r ? r.key : null);
      table?.setHot(r ? r.key : null);
      const c = h.cell >= 0 ? counties.rowAtCell(h.cell) : null;
      hist?.setHot(c ? hist.binOf(c.v.estudios_superiores)?.i ?? null : null);
    },
    onEscape() {
      if (scatter?.selected) { clearSel(); return true; }
      return false;
    },
  };
}
