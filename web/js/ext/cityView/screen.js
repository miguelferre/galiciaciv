// The city screen: a docked dashboard (a bottom sheet on phones) with the header (and its city-type badge),
// Ciudadanos (figure rows from citizens.json, plus the concello's own figures from counties.json), Distritos
// (districts.json), Economía, Trabajo, Recursos and Comparar. Plain HTML strings; render(el, model, handlers) fills
// `el`. The citizens, districts and counties files load on demand and fill their sections when they arrive.
import { esc, euros, int, pct } from "../../format.js";
import { compact, money, num, popShort, yieldValue } from "./fmt.js";
import { icon, glyph } from "../../ui/icon.js";
import { css } from "../../color.js";
import { isCapital } from "../../world.js";
import { meter, bar } from "./charts.js";
import { rankCount, resourceValue, LAND } from "./model.js";
import { citizensHtml, mountCitizens } from "./citizens.js";
import { badgeHtml, cityDistricts, districtsHtml } from "./districts.js";
import { t } from "../../i18n.js";

const TABS = [
  ["citizens", t("Ciudadanos"), "pop"],
  ["districts", t("Distritos"), "l-developed"],
  ["economy", t("Economía"), "y-gold"],
  ["workforce", t("Trabajo"), "y-production"],
  ["resources", t("Recursos"), "resources"],
  ["compare", t("Comparar"), "layers"],
];

const rankCache = new WeakMap();
function countOf(cities, key) {
  let m = rankCache.get(cities);
  if (!m) rankCache.set(cities, (m = new Map()));
  if (!m.has(key)) m.set(key, rankCount(cities, key));
  return m.get(key);
}

// Medals among the map's cities (56): gold for the first 5, silver up to 15, bronze below.
function rankBadge(rank, of, label) {
  if (rank == null) return "";
  const tier = rank <= 5 ? "gold" : rank <= 15 ? "silver" : "bronze";
  return `<div class="cv-rank ${tier}" title="${esc(t("{label}: puesto {rank} de {of} ciudades (1 = el valor más alto)", { label, rank, of }))}">
    <span class="cv-medal">${rank}.º</span><span class="cv-rank-l">${esc(label)}</span></div>`;
}

function lqBadge(lq) {
  if (lq == null) return "";
  const tip = t("Cociente de localización: el peso de este sector es {n} veces el de Galicia", { n: num(lq, 2) });
  const cls = lq >= 1.25 ? "hi" : lq <= 0.75 ? "lo" : "mid";
  return `<span class="cv-lq ${cls}" title="${esc(tip)}">×${num(lq)}</span>`;
}

function medallion(id, fallback, bg, size = 18) {
  return `<span class="cv-med" style="--bg:${esc(bg)}">${icon(id, fallback, { size })}</span>`;
}

const perCapita = (c) => (c.gdp != null && c.population ? c.gdp / c.population : null);

// --- header --------------------------------------------------------------------------------------------------------
function header(m) {
  const c = m.city;
  const cities = m.cityList;
  const col = css(m.stateRGB);
  const chips = m.states.map((s) => (s.index >= 0
    ? `<button class="chip" data-state="${s.index}" title="${t("Abrir {name}", { name: esc(s.name) })}">${esc(s.name)}</button>`
    : `<span class="chip">${esc(s.name)}</span>`)).join("");
  const perCap = perCapita(c);
  const r = c.ranks || {};
  const N = (k) => countOf(cities, k);
  return `
  <div class="sheet-grip cv-grip" aria-hidden="true"></div>
  <header class="cv-head" style="--sc:${col}">
    <div class="cv-ribbon" aria-hidden="true"></div>
    <button class="icon-btn cv-close" data-close aria-label="${t("Cerrar la vista de ciudad (Esc)")}" title="${t("Volver al mapa (Esc)")}">${icon("close", "✕", { size: 13 })}</button>
    <div class="cv-kind">${t("Vista de ciudad · Concello")}</div>
    <div class="cv-title">
      <div class="cv-crest" aria-hidden="true"><span>${esc(popShort(c.population))}</span></div>
      <div class="cv-tt">
        <h2 class="cv-name" tabindex="-1">${isCapital(c) ? `<span class="cv-cap" title="${t("Capital de Galicia")}">★</span> ` : ""}${esc(c.name)}</h2>
        <div class="cv-full">${esc(c.full || "")}</div>
        <div class="cv-typeslot" data-ctype></div>
        ${chips ? `<div class="chips">${chips}</div>` : ""}
      </div>
    </div>
    <div class="cv-headline">
      <div class="cv-big"><span class="lbl">${icon("pop", "👥", { size: 13 })} ${t("Población")}${m.nation.year ? ` ${m.nation.year}` : ""}</span><b>${int(c.population)}</b></div>
      <div class="cv-big"><span class="lbl">${icon("y-gold", "💰", { size: 13 })} ${t("PIB")}${c.gdp_year ? ` ${c.gdp_year}` : ""}</span><b>${money(c.gdp)}</b>${
        perCap != null ? `<span class="cv-sub">${t("{v} por habitante", { v: euros(perCap) })}</span>` : ""}</div>
    </div>
    <div class="cv-ranks" aria-label="${t("Puestos entre las {n} ciudades del mapa", { n: cities.length })}">
      ${rankBadge(r.population, N("population"), t("Población"))}
      ${rankBadge(r.gdp, N("gdp"), t("PIB"))}
      ${rankBadge(r.gdp_per_capita, N("gdp_per_capita"), t("PIB por habitante"))}
    </div>
  </header>
  <nav class="cv-tabs" aria-label="${t("Secciones de la vista de ciudad")}">
    ${TABS.map(([id, label, ic]) => `<button type="button" data-tab="${id}">${icon(ic, "•", { size: 14 })}<span>${label}</span></button>`).join("")}
  </nav>`;
}

// --- citizens ------------------------------------------------------------------------------------------------------
function citizens(m) {
  const c = m.city, n = m.nation.nation;
  // sub: the small line beside the value; by default the Galicia value, left out when there is none.
  const row = (ic, fb, label, v, ref, fmt, better, max, sub = ref != null ? t("Galicia {v}", { v: fmt(ref) }) : "", tick = ref) => (v == null ? "" : `
    <div class="cv-stat">
      <div class="cv-stat-top"><span class="sl">${icon(ic, fb, { size: 14 })}${esc(label)}</span>
        <span class="sv"><b>${fmt(v)}</b>${sub ? `<small>${sub}</small>` : ""}</span></div>
      ${meter(v, tick, max ?? Math.max(v || 0, ref || 0) * 1.35, better)}
    </div>`);
  // Affiliated residents: a Galicia count says nothing beside it, so the share of residents (and Galicia's share).
  const empShare = c.employed != null && c.population > 0 ? c.employed / c.population : null;
  const refEmpShare = n.employed != null && n.population > 0 ? n.employed / n.population : null;
  const empSub = empShare == null ? ""
    : `${t("{p} de los habitantes", { p: pct(empShare) })}${refEmpShare != null ? ` · ${t("Galicia {v}", { v: pct(refEmpShare) })}` : ""}`;
  const tilesNote = m.residentsSum > 0
    ? t("En el mapa, algunas casillas del concello con suelo urbanizado muestran <b>≈ habitantes</b> (la población del concello repartida según la superficie de cada casilla: una estimación, no un recuento) y su <b>cobertura del suelo principal</b> (parte de la casilla). Con ese reparto, las {n} casillas suman unos {v} habitantes.", { n: int(m.tiles.length), v: compact(m.residentsSum) })
    : t("En el mapa, algunas casillas del concello con suelo urbanizado muestran <b>≈ habitantes</b> (la población del concello repartida según la superficie de cada casilla: una estimación, no un recuento) y su <b>cobertura del suelo principal</b> (parte de la casilla).");
  return `
  <section class="cv-sec" id="cv-citizens" data-sec="citizens" aria-labelledby="cv-h-citizens">
    <h3 id="cv-h-citizens">${icon("pop", "👥", { size: 15 })}${t("Ciudadanos")}</h3>
    <div class="cv-citizens" data-citizens>${citizensHtml(m, undefined)}</div>
    <h4 class="cv-h4">${t("Empleo y renta")}</h4>
    <div class="cv-stats">
      ${row("pop", "👥", t("Personas afiliadas que viven aquí"), c.employed, null, int, null, c.population, empSub, refEmpShare != null ? refEmpShare * c.population : null)}
      ${row("unemployment", "😐", t("Parados por habitante"), c.unemployment, n.unemployment, (x) => pct(x), "low")}
      ${row("l-income", "💶", t("Renta neta media por persona (2024)"), c.median_income, n.median_income, euros, "high")}
    </div>
    <p class="cv-note">${t("Parados por habitante: paro registrado entre la población. No es la tasa de paro.")}</p>
    <div class="cv-legend-tiles">${tileLegend(m)}<p>${tilesNote}</p></div>
    <h4 class="cv-h4">${t("El concello")}</h4>
    <div data-concello><p class="muted cv-note">${t("Cargando los datos del concello…")}</p></div>
  </section>`;
}

function tileLegend(m) {
  const counts = new Map();
  for (const tl of m.tiles) if (tl.land) counts.set(tl.land.key, (counts.get(tl.land.key) || 0) + 1);
  return `<div class="cv-tl">${LAND.filter((g) => counts.has(g.key)).map((g) =>
    `<span class="cv-tl-i" title="${t("Casillas donde es la cobertura principal")}"><i style="background:${esc(m.landColor(g.key))}"></i>${esc(g.label)} <small>${counts.get(g.key)}</small></span>`).join("")}</div>`;
}

// The concello's own figures that nothing else on the screen shows (counties.json column → format).
const CONCELLO = [
  ["land_km2", (v) => `${num(v)} km²`],
  ["density", (v) => `${int(v)} ${t("hab./km²")}`],
  ["gini", (v) => num(v)],
  ["nacidos_fuera", (v) => pct(v)],
];

export function concelloStats(m, data) {
  const none = `<p class="muted cv-note">${t("Los datos del concello no están disponibles.")}</p>`;
  if (!data || !Array.isArray(data.rows)) return none;
  const col = Object.fromEntries(data.columns.map((k, j) => [k, j]));
  const r = data.rows.find((x) => x[col.geoid] === m.city.id);
  if (!r) return none;
  const fields = new Map((Array.isArray(data.fields) ? data.fields : []).map((f) => [f.key, f]));
  const cells = CONCELLO.filter(([k]) => r[col[k]] != null).map(([k, fmt]) => {
    const f = fields.get(k) || {};
    return `<div title="${esc(f.description || "")}"><span class="lbl">${esc(f.label || k)}</span><b>${esc(fmt(r[col[k]]))}</b></div>`;
  }).join("");
  return `<div class="cv-cdata">${cells}</div>
    <p class="cv-note">${esc(data.vintage || "")}. ${t("Pasa por cada dato para ver su definición.")}</p>`;
}

// --- districts -----------------------------------------------------------------------------------------------------
function districts(m) {
  return `
  <section class="cv-sec" id="cv-districts" data-sec="districts" aria-labelledby="cv-h-districts">
    <h3 id="cv-h-districts">${icon("l-developed", "🏙", { size: 15 })}${t("Distritos")}</h3>
    <div data-districts>${districtsHtml(m, undefined)}</div>
  </section>`;
}

// --- economy -------------------------------------------------------------------------------------------------------
function economy(m) {
  const c = m.city, nat = m.nation, n = nat.nation;
  const r = c.ranks || {};
  const cities = m.cityList;
  const perCap = perCapita(c);
  const refPerCap = perCapita(n);
  const yields = nat.yields.map((y) => {
    const v = c.yields?.[y.key];
    const rk = r[y.key];
    return `<div class="cv-yield" style="--yc:${esc(y.color)}" title="${esc(y.label)}: ${esc(y.description || "")}">
      <div class="ico">${glyph(y, 20)}</div><div class="val">${yieldValue(y, v)}</div>
      <div class="lbl">${esc(y.key === "gold" ? t("PIB") : y.label)}</div>
      ${rk != null ? `<div class="rk">${rk}.º <small>${t("de {n}", { n: countOf(cities, y.key) })}</small></div>` : ""}</div>`;
  }).join("");
  return `
  <section class="cv-sec" id="cv-economy" data-sec="economy" aria-labelledby="cv-h-economy">
    <h3 id="cv-h-economy">${icon("y-gold", "💰", { size: 15 })}${t("Economía")}</h3>
    <div class="cv-gdp">
      <div><span class="lbl">${t("PIB")}${c.gdp_year ? ` (${c.gdp_year})` : ""}</span><b>${money(c.gdp)}</b>${r.gdp != null ? `<small>${t("{rank}.º de {n} ciudades", { rank: r.gdp, n: countOf(cities, "gdp") })}</small>` : ""}</div>
      <div><span class="lbl">${t("PIB por habitante")}</span><b>${euros(perCap)}</b>${
        refPerCap && perCap != null ? `<small class="${perCap >= refPerCap ? "good" : "bad"}">${t("Galicia {v}", { v: euros(refPerCap) })}</small>` : ""}</div>
      <div><span class="lbl">${t("Parte del PIB gallego")}</span><b>${c.gdp != null && n.gdp ? pct(c.gdp / n.gdp, 1) : "–"}</b><small>${t("{p} de la población", { p: pct(c.population / n.population, 1) })}</small></div>
    </div>
    <h4 class="cv-h4">${t("Rendimientos")} <span class="muted">${t("puesto entre las ciudades")}</span></h4>
    <div class="cv-yields">${yields}</div>
    <p class="cv-note">${t("{vintage}, en euros corrientes. PIB por habitante: PIB de {gy} entre la población de {py}. Alimento y Producción cuentan personas afiliadas que viven en el concello; Ciencia y Cultura son estimaciones. Pasa por cada rendimiento para ver su definición.", { vintage: esc(nat.gdp_vintage || t("IGE, PIB por concello")), gy: esc(String(c.gdp_year || "")), py: esc(String(nat.year || "")) })}</p>
  </section>`;
}

// --- workforce -----------------------------------------------------------------------------------------------------
function workforce(m) {
  const cards = m.inds.map((d) => {
    const spec = d.lq != null && d.lq >= 1.25;
    return `<div class="cv-bld${spec ? " spec" : ""}" title="${esc(t("{label}: {n} personas afiliadas que viven aquí ({p}; Galicia {g})", { label: d.label, n: int(d.jobs), p: pct(d.share), g: pct(d.natShare) }))}">
      ${medallion(d.icon, "•", d.color, 17)}
      <div class="cv-bld-t"><span class="cv-bld-n">${esc(d.label)}</span>
        <span class="cv-bld-v">${compact(d.jobs)} <small>${pct(d.share, 1)}</small></span></div>
      ${lqBadge(d.lq)}
    </div>`;
  }).join("");
  return `
  <section class="cv-sec" id="cv-workforce" data-sec="workforce" aria-labelledby="cv-h-workforce">
    <h3 id="cv-h-workforce">${icon("y-production", "⚙️", { size: 15 })}${t("Trabajo")}</h3>
    <p class="cv-lead">${t("Sectores en los que trabajan las {n} personas afiliadas a la Seguridad Social que viven en el concello. {lq} compara el peso de cada sector con el que tiene en Galicia.", { n: int(m.city.employed), lq: `<span class="cv-lq hi">×N</span>` })}</p>
    <div class="cv-blds">${cards || `<p class="muted cv-note">${t("Sin datos de sectores.")}</p>`}</div>
    <p class="cv-note">${t("IGE, afiliaciones por concello de residencia y sector (no donde está el puesto de trabajo). Los distritos del mapa salen de otra fuente, los establecimientos del directorio de empresas del IGE: ver Distritos.")}</p>
  </section>`;
}

// --- resources -----------------------------------------------------------------------------------------------------
function resources(m) {
  const list = m.sites.map((s, k) => {
    const ty = s.type;
    const val = resourceValue(s.item, ty, compact);
    return `<button type="button" class="cv-site" data-site="${k}" title="${t("Ir a {name}", { name: esc(s.item.name) })}">
      <span class="cv-med" style="--bg:${esc(ty?.color || "#3a4a5e")}">${glyph(ty, 16)}</span>
      <span class="cv-site-t"><b>${esc(s.item.name)}</b><small>${esc(ty?.name || s.item.type)}</small>
        ${s.item.detail ? `<small class="cv-site-d">${esc(s.item.detail)}</small>` : ""}</span>
      <span class="cv-site-v">${esc(val)}<i aria-hidden="true">›</i></span>
    </button>`;
  }).join("");
  const turbines = m.sites.filter((s) => s.item.type === "eolico").reduce((a, s) => a + (s.item.value || 0), 0);
  const threshold = t("El mapa solo muestra los sitios que superan el umbral de cada tipo: no es el total del concello.");
  const summary = m.sites.length
    ? `<p class="cv-lead">${m.sites.length === 1 ? t("{n} sitio en el mapa", { n: m.sites.length }) : t("{n} sitios en el mapa", { n: m.sites.length })}${
      turbines ? ` · ${t("{n} aerogeneradores (en funcionamiento, autorizados o en obras)", { n: int(turbines) })}` : ""}. ${t("Pulsa uno para ir allí.")}</p>`
    : `<p class="muted cv-note">${t("No hay recursos del mapa en este concello.")} ${threshold}</p>`;
  return `
  <section class="cv-sec" id="cv-resources" data-sec="resources" aria-labelledby="cv-h-resources">
    <h3 id="cv-h-resources">${icon("resources", "⛏️", { size: 15 })}${t("Recursos")}</h3>
    ${summary}
    <div class="cv-sites">${list}</div>
    ${m.sites.length ? `<p class="cv-note">${threshold}</p>` : ""}
  </section>`;
}

// --- compare -------------------------------------------------------------------------------------------------------
const COMPARE = [
  [t("Población"), (c) => c.population, popShort],
  [t("PIB / hab."), perCapita, euros],
  [t("Renta / pers."), (c) => c.median_income, euros],
  [t("Parados / hab."), (c) => c.unemployment, (v) => pct(v)],
];

export function compareTable(m) {
  const rows = [m.city, ...m.peers];
  const cols = COMPARE.filter(([, f]) => rows.some((c) => f(c) != null));
  const max = cols.map(([, f]) => Math.max(...rows.map((c) => Math.abs(f(c) ?? 0))) || 1);
  return `<div class="cv-cmp" role="table" aria-label="${t("{name} y ciudades parecidas", { name: esc(m.city.name) })}">
    <div class="cv-cmp-r cv-cmp-h" role="row"><span role="columnheader">${t("Ciudad")}</span>${cols.map(([l]) => `<span role="columnheader">${esc(l)}</span>`).join("")}</div>
    ${rows.map((c, k) => `<div class="cv-cmp-r${k === 0 ? " me" : ""}" role="row">
      <span role="cell">${k === 0 ? `<b class="cv-cmp-n">${esc(c.name)}</b>` : `<button type="button" class="cv-cmp-n" data-peer="${esc(c.id)}" title="${t("Abrir {name} en la vista de ciudad", { name: esc(c.name) })}">${esc(c.name)}</button>`}<small>${esc(m.comarcaOf(c))}</small></span>
      ${cols.map(([, f, fmt], j) => {
        const v = f(c);
        return `<span role="cell"><em>${v == null ? "–" : esc(fmt(v))}</em>${bar(v == null ? 0 : Math.abs(v) / max[j], k === 0 ? "#ecd08e" : "#8fa6bd")}</span>`;
      }).join("")}
    </div>`).join("")}
  </div>`;
}

function compare(m) {
  return `
  <section class="cv-sec" id="cv-compare" data-sec="compare" aria-labelledby="cv-h-compare">
    <h3 id="cv-h-compare">${icon("layers", "⚖️", { size: 15 })}${t("Comparar")}</h3>
    <p class="cv-lead">${t("Las {n} ciudades de población más parecida. Pulsa una para abrirla.", { n: m.peers.length })}</p>
    <div data-compare>${compareTable(m)}</div>
    <p class="cv-note">${t("Población de {py}. PIB por habitante: PIB de {gy} entre esa población. Renta neta media por persona de 2024. Parados registrados por habitante (no es la tasa de paro).", { py: esc(String(m.nation.year || "")), gy: esc(String(m.city.gdp_year || "")) })}</p>
  </section>`;
}

function footer(m) {
  const nat = m.nation;
  return `<div class="cv-foot">${t("Fuentes: {vintage}; ciudadanos: IGE, padrón y Censo 2021; distritos: IGE, directorio de empresas; recursos: Xunta de Galicia (parques eólicos), IGME (canteras y minas) y Pesca de Galicia (lonjas); cobertura del suelo: ESA WorldCover 2021. Los puestos son entre las {n} ciudades del mapa.", { vintage: `${esc(nat.vintage)}${nat.gdp_vintage ? `; ${t("PIB")}: ${esc(nat.gdp_vintage)}` : ""}`, n: m.cityList.length })}
    <a href="#" data-pedia>${t("Almanaque ›")}</a></div>`;
}

/**
 * Fill the dock. handlers: {onClose, onState(idx), onPeer(id), onSite(site), onSiteHover(site|null), onPedia,
 * loadCounties() → Promise<counties.json|null>, loadData(name) → Promise<data|null>, onDistricts(list)} (the
 * city's districts once districts.json is in, for the map plaques).
 */
/**
 * Scrolls the dock to a section (its tab id, e.g. "districts"). Citizens and districts arrive later and change the
 * heights above, so the section is re-aligned as they do, for up to 4 s or until the user scrolls themselves.
 */
export function goToSection(el, id) {
  const sec = el?.querySelector(`[data-sec="${id}"]`);
  if (!sec) return false;
  const align = () => {
    const nav = el.querySelector(".cv-tabs");
    el.scrollTop = Math.max(0, sec.offsetTop - (nav?.offsetHeight || 0) - 4);
    el.onscroll?.(); // the tab spy (a scroll event is not always sent for a programmatic jump)
  };
  align();
  let ro = null;
  const stop = () => {
    ro?.disconnect();
    ro = null;
    for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) el.removeEventListener(ev, stop);
  };
  for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) el.addEventListener(ev, stop, { passive: true });
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(() => { if (sec.isConnected) align(); else stop(); });
    for (const c of el.children) ro.observe(c);
  }
  setTimeout(stop, 4000);
  return true;
}

export function render(el, m, h) {
  el.classList.add("cv-dock");
  el.style.setProperty("--sc", css(m.stateRGB));
  el.innerHTML = header(m) + citizens(m) + districts(m) + economy(m) + workforce(m) + resources(m) + compare(m) + footer(m);
  el.scrollTop = 0;

  el.querySelector("[data-close]").onclick = () => h.onClose();
  el.querySelectorAll("[data-state]").forEach((b) => (b.onclick = () => h.onState(+b.dataset.state)));
  el.querySelector("[data-pedia]").onclick = (e) => { e.preventDefault(); h.onPedia(); };

  // Sites: hover lights the hex on the map, click flies there.
  el.querySelectorAll("[data-site]").forEach((b) => {
    const s = m.sites[+b.dataset.site];
    b.onclick = () => h.onSite(s);
    b.onmouseenter = b.onfocus = () => h.onSiteHover(s);
    b.onmouseleave = b.onblur = () => h.onSiteHover(null);
  });

  // Compare: peer links.
  el.querySelector("[data-compare]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-peer]");
    if (b) h.onPeer(b.dataset.peer);
  });

  // Tabs scroll to their section; the active tab follows the scroll position.
  const nav = el.querySelector(".cv-tabs");
  const tabs = [...el.querySelectorAll("[data-tab]")];
  const secs = tabs.map((tb) => el.querySelector(`[data-sec="${tb.dataset.tab}"]`));
  tabs.forEach((tb, k) => (tb.onclick = () => {
    const top = secs[k].offsetTop - nav.offsetHeight - 4;
    el.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));
  const spy = () => {
    const y = el.scrollTop + nav.offsetHeight + 24;
    let k = 0;
    secs.forEach((s, j) => { if (s.offsetTop <= y) k = j; });
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) k = secs.length - 1;
    tabs.forEach((tb, j) => tb.classList.toggle("on", j === k));
  };
  el.onscroll = spy;
  spy();

  // Citizens and districts arrive with their files (each loaded once, on demand).
  const czHost = el.querySelector("[data-citizens]");
  Promise.resolve(h.loadData?.("citizens")).then((data) => {
    if (!czHost.isConnected) return;
    czHost.innerHTML = citizensHtml(m, data ?? null);
    mountCitizens(czHost, m, data);
  }, () => { if (czHost.isConnected) czHost.innerHTML = citizensHtml(m, null); });
  const dHost = el.querySelector("[data-districts]");
  const typeSlot = el.querySelector("[data-ctype]");
  Promise.resolve(h.loadData?.("districts")).then((dd) => {
    if (!dHost.isConnected) return;
    dHost.innerHTML = districtsHtml(m, dd ?? null);
    typeSlot.innerHTML = badgeHtml(m, dd ?? null);
    h.onDistricts?.(dd ? cityDistricts(dd, m.city.id) : []);
  }, () => { if (dHost.isConnected) dHost.innerHTML = districtsHtml(m, null); });

  // The concello's figures arrive with counties.json (loaded once, on demand).
  const host = el.querySelector("[data-concello]");
  Promise.resolve(h.loadCounties()).then((data) => {
    if (host.isConnected) host.innerHTML = concelloStats(m, data);
  }, () => { if (host.isConnected) host.innerHTML = concelloStats(m, null); });
}
