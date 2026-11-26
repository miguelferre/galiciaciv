// City View "Ciudadanos" rows: the city's people as rows of small figures (citizens.json, IGE: Padrón and Censo).
//
//   citizensHtml(m, data) → HTML      the rows (placeholders for the figure canvases)
//   mountCitizens(host, m, data)       paints the figures and wires the hover / focus read-out
//
// Each row: N figures (counted in the pipeline by largest remainder), a caption ("cada figura ≈ 5,5 mil personas"),
// a read-out line that a hovered or focused figure fills ("En Vigo, 1 de cada 7 habitantes nació en el extranjero
// (Galicia: 1 de cada 8)") and a thin Galicia bar for comparison. A category's `key` names its data; its `art` names
// the figure drawn and its colour. A row the data leaves null is left out, never drawn as zeros.
import { esc, int, pct } from "../../format.js";
import { compact, num } from "./fmt.js";
import { CATEGORY_COLOR, figureCanvas, loadPainter } from "./figures.js";

// noun = [singular, plural]; fem picks "ninguna de las" / "casi todas las". year: which vintage the row comes from.
const ROWS = [
  { id: "workforce", title: "Ocupación", sub: "personas ocupadas", noun: ["persona ocupada", "personas ocupadas"], fem: true, year: (d) => `Censo ${d.census_year}` },
  { id: "age", title: "Generaciones", sub: "por edad", noun: ["habitante", "habitantes"], fem: false, year: (d) => `Padrón ${d.year}` },
  { id: "education", title: "Estudios", sub: "15 años o más", noun: ["persona de 15 años o más", "personas de 15 años o más"], fem: true, year: (d) => `Censo ${d.census_year}` },
  { id: "nativity", title: "Orígenes", sub: "lugar de nacimiento", noun: ["habitante", "habitantes"], fem: false, year: (d) => `Padrón ${d.year}` },
];

// [singular verb phrase, plural verb phrase] per category key, for "1 de cada 7 … trabaja" / "7 de cada 10 … trabajan".
const same = (sg, pl) => [sg, pl];
const PHRASE = {
  workforce: {
    cno1: same("trabaja en la dirección o la gerencia", "trabajan en la dirección o la gerencia"),
    cno2: same("tiene una profesión científica o intelectual", "tienen una profesión científica o intelectual"),
    cno3: same("trabaja en un puesto técnico o de apoyo", "trabajan en puestos técnicos o de apoyo"),
    cno4: same("trabaja en tareas administrativas o de oficina", "trabajan en tareas administrativas o de oficina"),
    cno5: same("trabaja en la hostelería, los servicios personales, la protección o el comercio", "trabajan en la hostelería, los servicios personales, la protección o el comercio"),
    cno6: same("tiene un oficio cualificado en el campo, el monte o la pesca", "tienen un oficio cualificado en el campo, el monte o la pesca"),
    cno7: same("tiene un oficio de la industria o la construcción", "tienen un oficio de la industria o la construcción"),
    cno8: same("maneja instalaciones o maquinaria, o hace montajes", "manejan instalaciones o maquinaria, o hacen montajes"),
    cno9: same("tiene una ocupación elemental", "tienen una ocupación elemental"),
  },
  age: {
    child: same("es menor de 15 años", "son menores de 15 años"),
    young: same("tiene de 15 a 34 años", "tienen de 15 a 34 años"),
    midlife: same("tiene de 35 a 64 años", "tienen de 35 a 64 años"),
    elder: same("tiene 65 años o más", "tienen 65 años o más"),
  },
  education: {
    primary: same("tiene como mucho educación primaria", "tienen como mucho educación primaria"),
    lower_secondary: same("tiene como nivel más alto la primera etapa de secundaria", "tienen como nivel más alto la primera etapa de secundaria"),
    upper_secondary: same("tiene como nivel más alto la segunda etapa de secundaria o una postsecundaria no superior", "tienen como nivel más alto la segunda etapa de secundaria o una postsecundaria no superior"),
    higher: same("tiene estudios superiores", "tienen estudios superiores"),
  },
  nativity: {
    same_concello: same("nació en el concello donde vive", "nacieron en el concello donde viven"),
    galicia: same("nació en otro concello de Galicia", "nacieron en otro concello de Galicia"),
    spain: same("nació en otra comunidad autónoma", "nacieron en otra comunidad autónoma"),
    abroad: same("nació en el extranjero", "nacieron en el extranjero"),
  },
};

/** "1 de cada 7", "3 de cada 10", "menos de 1 de cada 1000", "casi todas las" (fem), "ninguno de los". */
export function oneIn(share, fem = false) {
  if (share == null || !Number.isFinite(share)) return null;
  if (share <= 0) return { text: fem ? "ninguna de las" : "ninguno de los", plural: false, all: true };
  if (share < 0.001) return { text: `menos de 1 de cada ${int(1000)}`, plural: false };
  if (share >= 0.3) {
    const k = Math.round(share * 10);
    return k >= 10 ? { text: fem ? "casi todas las" : "casi todos los", plural: true, all: true }
      : { text: `${k} de cada 10`, plural: k !== 1 };
  }
  return { text: `1 de cada ${int(Math.round(1 / share))}`, plural: false };
}

/** "En Vigo, 1 de cada 7 habitantes nació en el extranjero (Galicia: 1 de cada 8)". */
export function sentence(rowId, key, share, natShare, cityName) {
  const rd = ROWS.find((r) => r.id === rowId);
  const a = oneIn(share, rd?.fem);
  const ph = PHRASE[rowId]?.[key];
  if (!a || !ph) return "";
  // "1 de cada 7 habitantes nació", "3 de cada 10 habitantes nacieron": the verb agrees with the count in front.
  const g = oneIn(natShare, rd.fem);
  const ref = !g ? "" : ` (Galicia: ${g.all ? g.text.replace(/( de)? (las|los)$/, "") : g.text})`;
  return `En ${cityName}, ${a.text} ${rd.noun[1]} ${a.plural ? ph[1] : ph[0]}${ref}`;
}

// Specialists by row/key from the file (ratios from unrounded shares).
function specMap(city) {
  const m = new Map();
  for (const s of city?.specialists || []) m.set(`${s.row}|${s.key}`, s);
  return m;
}

/** The Citizens rows. data = citizens.json (or null / undefined while loading). */
export function citizensHtml(m, data) {
  const c = m.city;
  if (data === undefined) return `<p class="muted cv-note">Cargando los ciudadanos…</p>`;
  if (!data || !data.cities) return `<p class="muted cv-note">Los datos de ciudadanos no están disponibles.</p>`;
  const row0 = data.cities[c.id];
  if (!row0) return `<p class="muted cv-note">El IGE no publica estas tablas para ${esc(c.name)}, así que no hay figuras.</p>`;
  const nat = data.national || {};
  const groups = data.groups || {};
  const specs = specMap(row0);
  const hiRule = data.rule?.specialist_high ?? 1.25, loRule = data.rule?.specialist_low ?? 0.8;
  const color = (rid, art) => CATEGORY_COLOR[rid]?.[art] || "#888";

  // Headline: mean age, higher education, foreign nationality, and the call-out of the strongest specialist.
  const chip = (v, ref, fmt, lbl, when, tip) => (v == null ? "" : `<div class="cv-cz-chip" title="${esc(tip)}"><b>${fmt(v)}</b><span>${esc(lbl)}</span><small>${ref != null ? `Galicia ${fmt(ref)} · ` : ""}${esc(when)}</small></div>`);
  const top = (row0.specialists || []).find((s) => s.ratio >= hiRule);
  const topRow = ROWS.find((r) => r.id === top?.row);
  const topGroup = top && (groups[top.row] || []).find((g) => g.key === top.key);
  const great = topRow && topGroup ? `<div class="cv-great" style="--fc:${esc(color(top.row, topGroup.art))}">
      <span class="cv-great-fig" data-great="${esc(top.row)}|${esc(topGroup.art)}" aria-hidden="true"></span>
      <div><small>Ciudadanos destacados</small><b>${esc(topGroup.label)}</b>
      <span>${pct(top.share, 1)} de ${topRow.fem ? "las" : "los"} ${esc(topRow.noun[1])} aquí, ${pct(top.national, 1)} en Galicia: ${num(top.ratio)} veces la parte gallega (${esc(topRow.year(data))}).</span></div></div>` : "";

  const rows = ROWS.filter((rd) => row0[rd.id]?.figures && groups[rd.id]).map((rd) => {
    const row = row0[rd.id];
    const gs = groups[rd.id];
    const head = `<div class="cv-cz-h"><b>${esc(rd.title)}</b><span>${esc(rd.sub)} · ${esc(rd.year(data))}</span></div>`;
    const figs = row.figures;
    const n = data.figures?.[rd.id] ?? gs.reduce((a, g) => a + (figs[g.key] || 0), 0);
    const per = row.total / n;
    const cells = [];
    for (const g of gs) {
      for (let j = 0; j < (figs[g.key] || 0); j++) {
        const sp = specs.get(`${rd.id}|${g.key}`);
        const mark = sp ? (sp.ratio >= 1 ? "up" : "down") : "";
        // One tab stop per category (its first figure), not one per figure.
        cells.push(`<span class="cv-fig${mark ? ` ${mark}` : ""}" tabindex="${j ? -1 : 0}" role="img" data-k="${esc(g.key)}" data-art="${esc(g.art)}" aria-label="${esc(g.label)}"></span>`);
      }
    }
    // Legend: every category, with its share, the Galicia share and a chevron for specialists. Categories that
    // round to no figure are still listed (greyed), so nothing silently disappears.
    const legend = gs.map((g) => {
      const sh = row.shares?.[g.key], ref = nat[rd.id]?.shares?.[g.key];
      const sp = specs.get(`${rd.id}|${g.key}`);
      const chev = sp ? `<em class="${sp.ratio >= 1 ? "up" : "down"}" title="${num(sp.ratio, 2)} veces la parte gallega">${sp.ratio >= 1 ? "▲" : "▼"}</em>` : "";
      return `<span class="cv-cz-k${figs[g.key] ? "" : " zero"}" data-k="${esc(g.key)}" title="${esc(g.label)}: ${sh != null ? pct(sh, 1) : "sin dato"}${ref != null ? ` (Galicia ${pct(ref, 1)})` : ""}${figs[g.key] ? "" : ". No llega a una figura."}"><i style="background:${esc(color(rd.id, g.art))}"></i>${esc(g.short)} <small>${pct(sh, 0)}</small>${chev}</span>`;
    }).join("");
    // Galicia comparison bar (shares), aligned with the figures' order.
    const refBar = nat[rd.id]?.shares ? `<div class="cv-cz-ref" title="Reparto en Galicia, en el mismo orden"><span>Galicia</span><div>${gs.map((g) => {
      const s = nat[rd.id].shares[g.key] || 0;
      return s > 0 ? `<i style="flex:${s};background:${esc(color(rd.id, g.art))}" title="${esc(g.short)}: ${pct(s, 1)} en Galicia"></i>` : "";
    }).join("")}</div></div>` : "";
    let extra = "";
    if (rd.id === "age" && row.mean != null) {
      extra = ` · edad media ${num(row.mean)} años${nat.age?.mean != null ? ` (Galicia ${num(nat.age.mean)})` : ""}`;
    }
    if (rd.id === "workforce" && row.unclassified) extra = ` · ${int(row.unclassified)} sin ocupación declarada, fuera de la fila`;
    const cap = `Cada figura ≈ ${compact(per)} ${rd.noun[1]} · ${int(row.total)} en total${extra}`;
    return `<div class="cv-cz-row" data-row="${rd.id}" style="--n:${n}">${head}
      <div class="cv-figs" role="group" aria-label="${esc(rd.title)}: ${esc(gs.filter((g) => figs[g.key]).map((g) => `${figs[g.key]} de ${n} ${g.short}`).join(", "))}">${cells.join("")}</div>
      ${refBar}
      <div class="cv-cz-out" aria-live="polite" data-default="${esc(cap)}">${esc(cap)}</div>
      <div class="cv-cz-legend">${legend}</div>
    </div>`;
  }).join("");

  const age = row0.age?.mean, higher = row0.education?.shares?.higher, foreign = row0.foreign_nationals;
  return `
    <div class="cv-cz-top">
      ${chip(age, nat.age?.mean, (v) => num(v), "edad media", `Padrón ${data.year}`, `Edad media de los habitantes, en años (Padrón ${data.year})`)}
      ${chip(higher, nat.education?.shares?.higher, (v) => pct(v, 0), "con estudios superiores", `Censo ${data.census_year}`, `Personas de 15 años o más con educación superior (Censo ${data.census_year})`)}
      ${chip(foreign, nat.foreign_nationals, (v) => pct(v, 0), "de nacionalidad extranjera", `Padrón ${data.year}`, `Habitantes con nacionalidad extranjera (Padrón ${data.year}). No es lo mismo que haber nacido en el extranjero.`)}
    </div>
    ${great}
    <div class="cv-cz">${rows}</div>
    <p class="cv-note">${esc(data.vintage)}. ${esc(data.rule?.text || "")} ▲▼ = al menos ${num(hiRule, 2)} veces o como mucho ${num(loRule, 1)} veces la parte de Galicia. Pasa o toca una figura para ver su parte.</p>`;
}

/** Paint the figure canvases and wire the read-outs. */
export function mountCitizens(host, m, data) {
  if (!host || !data?.cities?.[m.city.id]) return;
  const row0 = data.cities[m.city.id];
  const nat = data.national || {};
  const dpr = Math.min(3, Math.max(1, Math.round((devicePixelRatio || 1) * 2) / 2));
  const paintAll = () => {
    host.querySelectorAll(".cv-cz-row[data-row]").forEach((rowEl) => {
      const rid = rowEl.dataset.row;
      rowEl.querySelectorAll(".cv-fig").forEach((el) => {
        const src = figureCanvas(rid, el.dataset.art, 36, dpr);
        const cv = document.createElement("canvas");
        cv.width = src.width;
        cv.height = src.height;
        cv.getContext("2d").drawImage(src, 0, 0);
        el.replaceChildren(cv);
      });
    });
    const g = host.querySelector("[data-great]");
    if (g) {
      const [rid, art] = g.dataset.great.split("|");
      const src = figureCanvas(rid, art, 36, dpr);
      const cv = document.createElement("canvas");
      cv.width = src.width;
      cv.height = src.height;
      cv.getContext("2d").drawImage(src, 0, 0);
      g.replaceChildren(cv);
    }
  };
  paintAll();
  // Once the citizen painter (render/art/people.js) loads, repaint the figures.
  loadPainter().then(() => { if (host.isConnected) paintAll(); });

  host.querySelectorAll(".cv-cz-row[data-row]").forEach((rowEl) => {
    const rid = rowEl.dataset.row;
    const row = row0[rid];
    const out = rowEl.querySelector(".cv-cz-out");
    if (!row || !out) return;
    const show = (k) => {
      rowEl.querySelectorAll("[data-k]").forEach((el) => el.classList.toggle("lit", el.dataset.k === k));
      rowEl.classList.toggle("focus", !!k);
      if (!k) {
        out.textContent = out.dataset.default;
        out.classList.remove("on");
        return;
      }
      const sh = row.shares?.[k], ref = nat[rid]?.shares?.[k];
      out.innerHTML = `${esc(sentence(rid, k, sh, ref, m.city.name))}<small>${sh != null ? pct(sh, 1) : "sin dato"} aquí${ref != null ? ` · ${pct(ref, 1)} en Galicia` : ""}${row.counts?.[k] != null ? ` · ${int(row.counts[k])} personas` : ""}</small>`;
      out.classList.add("on");
    };
    let pinned = null;
    rowEl.addEventListener("pointerover", (e) => {
      const el = e.target.closest("[data-k]");
      if (el && rowEl.contains(el)) show(el.dataset.k);
    });
    rowEl.addEventListener("pointerleave", () => show(pinned));
    rowEl.addEventListener("focusin", (e) => {
      const el = e.target.closest("[data-k]");
      if (el) show(el.dataset.k);
    });
    rowEl.addEventListener("focusout", () => show(pinned));
    // A tap pins the category (phones have no hover); another tap on it lets go.
    rowEl.addEventListener("click", (e) => {
      const el = e.target.closest("[data-k]");
      if (!el) return;
      pinned = pinned === el.dataset.k ? null : el.dataset.k;
      show(pinned);
    });
  });
}
