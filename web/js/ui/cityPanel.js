import { css } from "../color.js";
import { esc } from "../format.js";
import { isCapital, stateIndex } from "../world.js";
import { yieldGrid, amenities, industries, gdpRow, popLine, growthSpan, showPanel, hidePanel } from "./infoPanel.js";
import { t } from "../i18n.js";

/**
 * ctx: {w, nation, onClose, onPedia, onState(stateIndex)}
 */
export function openCityPanel(city, ctx) {
  const { w, nation } = ctx;
  const n = nation.nation;
  const owner = city.cell != null ? w.raw.owner[city.cell] : -1;
  const col = css(w.stateColor[owner] || [190, 190, 190]);

  // The city's states as links to their state panels.
  const states = (city.states || [])
    .map((key) => ({ key, i: stateIndex(w, key) })) // key = comarca fips (unique) or an unambiguous abbr
    .map(({ key, i }) => (i >= 0 && ctx.onState
      ? `<button class="chip" data-state="${i}" title="${t("Abrir {name}", { name: esc(w.raw.states[i].name) })}">${esc(w.raw.states[i].name)}</button>`
      : `<span class="chip">${esc(key)}</span>`))
    .join("");

  const growth = growthSpan(city, n);

  showPanel({
    kind: "city",
    stripe: col,
    title: city.name,
    titleHtml: `${isCapital(city) ? `<span class="cap" title="${t("Capital de Galicia")}">★</span> ` : ""}${esc(city.name)}`,
    sub: `${esc(city.full || "")}${states ? `<div class="chips">${states}</div>` : ""}`,
    headExtra: popLine(city, growth),
    sections: [
      { title: t("Rendimientos"), html: `<div class="yield-grid">${yieldGrid(nation, city.yields)}</div>` },
      { title: t("Paro, renta y PIB"), html: amenities(city, n) + gdpRow(city) },
      { title: t("Sectores · dónde trabaja la gente"), html: industries(city, nation) },
    ],
    foot: `${t("Fuente: {v}", { v: esc(nation.vintage) })}${nation.gdp_vintage ? `; ${t("PIB: {v}", { v: esc(nation.gdp_vintage) })}` : ""}.
      ${t("Verde ×N = el peso de este sector en el empleo es N veces el de Galicia.")}`,
    onClose: ctx.onClose,
    onPedia: ctx.onPedia,
    wire(panel) {
      panel.querySelectorAll("[data-state]").forEach((b) => (b.onclick = () => ctx.onState(+b.dataset.state)));
    },
  });
}

export const closeCityPanel = hidePanel;
