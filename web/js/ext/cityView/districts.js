// City View "Distritos": the city's real specialisation (districts.json, IGE local business units) as strategy-game
// districts. The data count establishments (local units), never jobs.
//
//   cityDistricts(ddata, id) → [district]        the city's districts, strongest first, each with what the dock and
//                                                the map plaques need ({id, name, short, color, icon, lq, units, …})
//   badgeOf(ddata, id) → {label, text, color, icon, district} | null | undefined   the city-type badge
//   districtsHtml(m, ddata) → HTML               the section body
//   badgeHtml(m, ddata) → HTML                   the header badge
import { esc, int, pct } from "../../format.js";
import { compact, num } from "./fmt.js";
import { icon } from "../../ui/icon.js";
import { hasIcon } from "../../icons.js";

// Icons the district catalog names (d-*) are not drawn; a near icon from the set stands in, with an emoji in reserve.
const FALLBACK = {
  industry: ["i-manufacturing", "🏭"], quarry: ["i-mining", "⛏️"], transport: ["i-transportation", "🚚"],
  commerce: ["i-retail", "🛍️"], offices: ["i-professional", "🏢"], tech: ["i-information", "💻"],
  tourism: ["i-accommodation", "🍽️"], culture: ["i-arts", "🎭"], utilities: ["i-utilities", "⚡"],
};

const units = (n) => `${int(n)} ${n === 1 ? "establecimiento" : "establecimientos"}`;

const catCache = new WeakMap();
function catalog(ddata) {
  let m = catCache.get(ddata);
  if (!m) catCache.set(ddata, (m = new Map((ddata?.catalog || []).map((c) => [c.id, c]))));
  return m;
}

export function iconFor(id, cat) {
  if (cat?.icon && hasIcon(cat.icon)) return cat.icon;
  const f = FALLBACK[id]?.[0];
  return f && hasIcon(f) ? f : null;
}

/** The city's districts: districts.json entries, strongest first. */
export function cityDistricts(ddata, id) {
  const cat = catalog(ddata);
  const row = ddata?.cities?.[id] || null;
  return (row?.districts || []).map((d) => {
    const c = cat.get(d.id) || {};
    const spec = d.via === "specialty" && d.sub;
    const subName = d.sub ? c.sub?.[d.sub] || ddata.divisions?.[d.sub]?.title || d.sub : null;
    return {
      ...d, name: c.name || d.id, color: c.color || "#5a6a7a", icon: iconFor(d.id, c), emoji: FALLBACK[d.id]?.[1] || "◆",
      cat: c, subName,
      // The map plaque: a speciality-qualified district is labelled by that speciality (its own LQ is the reason).
      short: spec ? subName : c.short || c.name || d.id,
      mapLq: spec ? d.sub_lq : d.lq,
    };
  });
}

/** The city-type badge; undefined while districts.json is loading, null when there is none. */
export function badgeOf(ddata, id) {
  if (!ddata) return ddata; // undefined (loading) or null (missing)
  const row = ddata.cities?.[id];
  if (!row) return null;
  if (!row.badge) return { label: "Diversificada", text: "Ningún distrito cumple la regla: ningún grupo de actividades destaca.", color: "#6a7484", icon: null, district: null };
  const c = catalog(ddata).get(row.badge.district) || {};
  return { ...row.badge, color: c.color || "#6a7484", icon: iconFor(row.badge.district, c), emoji: FALLBACK[row.badge.district]?.[1] };
}

export function badgeHtml(m, ddata) {
  const b = badgeOf(ddata, m.city.id);
  if (!b) return "";
  return `<span class="cv-type${b.district ? "" : " plain"}" style="--tc:${esc(b.color)}" title="Tipo de ciudad: ${esc(b.text || b.label)} (IGE, unidades locales ${esc(String(ddata.year || ""))})">
    <span class="cv-type-ic">${icon(b.icon, b.emoji || "◆", { size: 13 })}</span>${esc(b.label)}</span>`;
}

function lqTag(lq, tip) {
  if (lq == null) return "";
  const cls = lq >= 1.25 ? "hi" : lq <= 0.75 ? "lo" : "mid";
  return `<span class="cv-lq ${cls}" title="${esc(tip || `Cociente de localización: ${num(lq, 2)} veces la parte gallega de los establecimientos`)}">×${num(lq)}</span>`;
}

function districtCard(d) {
  const c = d.cat || {};
  const facts = [];
  if (d.units != null) {
    facts.push(`<div><span>Establecimientos</span><b>${int(d.units)}</b><small>${d.share != null ? `${pct(d.share, 1)} de los del concello` : ""}</small></div>`);
  }
  if (d.strength != null) {
    facts.push(`<div title="Establecimientos por encima de lo esperado con el reparto de Galicia (el mayor entre el distrito y su especialidad). Así se ordenan los distritos."><span>Sobre lo esperado</span><b>+${int(Math.max(0, Math.round(d.strength)))}</b><small>establecimientos</small></div>`);
  }
  let spec = "";
  if (d.sub && d.subName) {
    spec = `<p class="cv-dc-sub">${d.via === "specialty" ? "Entra por su especialidad" : "Especialidad destacada"}: <b>${esc(d.subName)}</b> ${lqTag(d.sub_lq)}${
      d.sub_units != null ? ` <small>${units(d.sub_units)}</small>` : ""}${
      d.via === "specialty" && d.lq != null ? `<br><small>El conjunto del distrito está en ${num(d.lq, 2)} veces la parte gallega; solo esta especialidad cumple la regla.</small>` : ""}</p>`;
  }
  return `<div class="cv-dc" style="--dc:${esc(d.color)}" title="${esc(c.description || "")}">
    <div class="cv-dc-h"><span class="cv-dc-hex">${icon(d.icon, d.emoji, { size: 18 })}</span>
      <div class="cv-dc-t"><b>${esc(d.name)}</b><small>${esc(c.description || "")}</small></div>
      ${lqTag(d.lq)}</div>
    ${facts.length ? `<div class="cv-dc-f">${facts.join("")}</div>` : ""}
    ${spec}
  </div>`;
}

function topTable(row, ddata) {
  const top = row?.top || [];
  if (!top.length) return "";
  const max = Math.max(...top.map((t) => t.lq || 0), 1);
  return `<h4 class="cv-h4">Actividades más especializadas <span class="muted">por cociente de localización</span></h4>
  <div class="cv-top" role="table" aria-label="Actividades más especializadas">
    <div class="cv-top-r cv-top-hd" role="row"><span role="columnheader">Actividad</span><span role="columnheader" title="Establecimientos (unidades locales)">Establec.</span><span role="columnheader" title="Veces la parte gallega">× Gal.</span></div>
    ${top.map((t) => {
      const title = ddata.divisions?.[t.div]?.title || `CNAE ${t.div}`;
      return `<div class="cv-top-r" role="row" title="${esc(title)} (CNAE ${esc(t.div)}): ${units(t.units)}">
        <span role="cell" class="cv-top-n">${esc(title)}<i style="width:${((Math.log(1 + (t.lq || 0)) / Math.log(1 + max)) * 100).toFixed(1)}%"></i></span>
        <span role="cell">${int(t.units)}</span>
        <span role="cell"><b>${num(t.lq)}</b></span></div>`;
    }).join("")}
  </div>`;
}

/** The Districts section body. ddata: districts.json (undefined while loading, null when missing). */
export function districtsHtml(m, ddata) {
  if (ddata === undefined) return `<p class="muted cv-note">Cargando los distritos…</p>`;
  if (!ddata) return `<p class="muted cv-note">Los datos de distritos no están disponibles.</p>`;
  const id = m.city.id;
  const row = ddata.cities?.[id] || null;
  const list = cityDistricts(ddata, id);
  const b = badgeOf(ddata, id);
  let lead;
  if (!row) {
    lead = `<p class="cv-lead">No hay datos de establecimientos para ${esc(m.city.name)}, así que no tiene distritos.</p>`;
  } else {
    lead = `<p class="cv-lead">${b?.district ? `<b class="cv-type-l" style="--tc:${esc(b.color)}">${esc(b.label)}</b> · ${esc(b.text || "")}. ` : ""}${
      units(row.units)} en el concello (IGE, ${esc(String(ddata.year || ""))}).</p>`;
  }
  const cards = list.length
    ? `<div class="cv-dcs">${list.map(districtCard).join("")}</div>`
    : row ? `<p class="muted cv-note">Ningún distrito cumple la regla aquí: ningún grupo de actividades destaca lo suficiente frente al reparto de Galicia.</p>` : "";
  return `${lead}
    ${cards}
    ${topTable(row, ddata)}
    ${list.length ? `<div class="cv-schematic">
      <p><b>◆ En el mapa</b> cada distrito aparece como una placa en el concello, cerca de la ciudad. La posición es esquemática: dice en qué se especializa la ciudad, no dónde están los establecimientos.</p>
    </div>` : ""}
    <details class="cv-more cv-rule"><summary>Cómo se eligen los distritos</summary>
      <p>${esc(ddata.rule?.text || "")}</p>
      <p>El directorio deja fuera el sector primario y la administración pública, así que no hay distritos de campo, pesca ni gobierno.</p>
    </details>
    <p class="cv-note">${esc(ddata.vintage || "IGE, directorio de empresas")}. Las cifras son establecimientos (unidades locales), no empleos. ×N = cociente de localización: veces la parte gallega.</p>`;
}
