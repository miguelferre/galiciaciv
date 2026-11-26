import { css } from "../color.js";
import { esc, popShort } from "../format.js";
import { isCapital, stateIndex } from "../world.js";
import { yieldGrid, amenities, industries, gdpRow, popLine, growthSpan, showPanel } from "./infoPanel.js";

/**
 * Opens the panel for state `idx` (index into world.json states / states.json).
 * ctx: {w, nation, states (states.json or null), cities, onClose, onPedia, onCity(city)}
 */
export function openStatePanel(idx, ctx) {
  const { w, nation } = ctx;
  const n = nation.nation;
  const geo = w.raw.states[idx] || {};
  // states.json is in the same order as world.json states; fall back to matching by fips.
  let st = ctx.states?.[idx];
  if (st && geo.fips && st.fips && st.fips !== geo.fips) st = ctx.states.find((s) => s.fips === geo.fips);
  st = st || { ...geo };
  const name = st.name || geo.name || "Comarca";
  const abbr = st.abbr || geo.abbr || "";
  const count = ctx.states?.length || w.raw.states.length;

  const cities = (ctx.cities || []).filter((c) => (c.states || []).some((k) => stateIndex(w, k) === idx)).slice(0, 8);
  const cityRows = cities.length
    ? `<div class="city-list">${cities
        .map((c) => {
          const multi = (c.states || []).length > 1 ? `<span class="muted"> · ${esc(c.states.map((k) => w.raw.states[stateIndex(w, k)]?.name || k).join("–"))}</span>` : "";
          return `<button class="city-row" data-city="${esc(c.id)}" title="${esc(c.full || c.name)}">
            <span class="cr-name">${isCapital(c) ? "★ " : ""}${esc(c.name)}${multi}</span>
            <span class="cr-pop">${popShort(c.population)}</span><span class="cr-go" aria-hidden="true">›</span></button>`;
        })
        .join("")}</div>`
    : `<p class="muted">No hay ciudades en los datos de esta comarca.</p>`;

  const hasEcon = st.population != null || st.yields;
  showPanel({
    kind: "state",
    stripe: css(w.stateColor[idx] || [190, 190, 190]),
    title: name,
    sub: `Comarca${abbr && abbr !== name ? ` · ${esc(abbr)}` : ""}${geo.fips ? ` · Código ${esc(geo.fips)}` : ""}`,
    headExtra: hasEcon ? popLine(st, growthSpan(st, n)) : "",
    sections: [
      st.yields && { title: "Rendimientos · puesto entre comarcas", html: `<div class="yield-grid">${yieldGrid(nation, st.yields, st.ranks, count)}</div>` },
      hasEcon && { title: "Paro, renta y PIB", html: amenities(st, n) + gdpRow(st) },
      st.jobs && { title: "Principales sectores · dónde trabaja la gente", html: industries(st, nation, 8) },
      { title: "Ciudades más grandes", html: cityRows },
      !hasEcon && { title: "Datos", html: `<p class="muted">Las estadísticas de la comarca no están en esta versión de los datos (falta states.json).</p>` },
    ],
    foot: `Fuente: ${esc(nation.vintage)}${nation.gdp_vintage ? `; PIB: ${esc(nation.gdp_vintage)}` : ""}. Los puestos son entre las ${count} comarcas del mapa (1 = la mayor).`,
    onClose: ctx.onClose,
    onPedia: ctx.onPedia,
    wire(panel) {
      panel.querySelectorAll("[data-city]").forEach((b) => {
        b.onclick = () => {
          const c = ctx.cities.find((x) => x.id === b.dataset.city);
          if (c) ctx.onCity(c);
        };
      });
    },
  });
}
