// Hover tooltips for the map-art layers (HTML strings; every data value is escaped), in Spanish with es-ES numbers.
// Each says where the number comes from and the caveat that matters for it (one day of mobility, a drawn arc).
import { esc, int, pct } from "../../format.js";
import { FORT_KINDS, fortKind, WONDER_KINDS } from "../../render/art/sites.js";

const muted = (s) => `<span class="muted">${s}</span>`;
const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±");

const dec = (x, d = 1) => x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

export const tips = {
  // Ports and airports carry no traffic figures: Puertos del Estado and Aena require prior written authorisation.
  port(p) {
    const lines = [`<b>Puerto de ${esc(p.name)}</b>`];
    if (p.authority && p.authority !== p.name) lines.push(muted(`Autoridad Portuaria de ${esc(p.authority)}`));
    lines.push(muted("Puerto de interés general. Posición: Wikidata."));
    return lines.join("<br>");
  },
  airport(a) {
    const lines = [`<b>${esc(a.id)} · ${esc(a.name)}</b>`];
    if (a.city) lines.push(muted(esc(a.city)));
    lines.push(muted("Posición: OpenStreetMap."));
    return lines.join("<br>");
  },
  fort(f, m) {
    const comp = m.data.military?.components?.find((c) => c.id === f.component);
    const name = comp?.name || FORT_KINDS[fortKind(f.component)]?.name || "Defense site";
    const tier = { major: "Major installation", base: "Base", site: "Site" }[f.tier] || "";
    const status = { act: "", semi: " · semi-active", care: " · caretaker status" }[f.status] ?? "";
    const lines = [
      `<b>${esc(f.name)}</b> ${muted(esc(f.state || ""))}`,
      `${esc(name)}${f.joint ? " · joint base" : ""} · ${esc(tier)}${esc(status)}`,
    ];
    if (f.area_km2 != null) lines.push(`Boundary ${int(f.area_km2)} km²`);
    lines.push(muted("DoD MIRTA. Sized by boundary area: no per-base headcount is published."));
    return lines.join("<br>");
  },
  range(r, m) {
    const comp = m.data.military?.components?.find((c) => c.id === r.component);
    return [
      `<b>${esc(r.name)}</b> ${muted(esc(r.state || ""))}`,
      `Restricted ground · ${esc(comp?.name || "")} · ${int(r.area_km2)} km²`,
      muted("One of the 30 largest DoD boundaries (MIRTA), drawn on the hexes it covers."),
    ].join("<br>");
  },
  wonder(x, m) {
    const k = WONDER_KINDS[x.kind]?.name || "Maravilla";
    const rule = m.data.wonders?.rules?.find((r) => r.id === x.rule);
    const mt = x.metrics || {};
    const lines = [`<b>${esc(x.name)}</b>`];
    const where = [mt.concello, x.state_name].filter(Boolean).join(", ");
    if (where) lines.push(muted(esc(where)));
    lines.push(esc(rule?.name || k));
    if (mt.unesco_id) lines.push(`Referencia UNESCO ${esc(mt.unesco_id)}`);
    if (mt.category) lines.push(`Categoría: ${esc(mt.category)}`);
    if (mt.protected_km2 != null) lines.push(`${dec(mt.protected_km2, mt.protected_km2 < 10 ? 2 : 0)} km² de área protegida`);
    if (mt.area_km2 != null) lines.push(`${int(mt.area_km2)} km²${mt.declared ? ` · declarado en ${esc(mt.declared)}` : ""}`);
    if (rule?.text) lines.push(muted(esc(rule.text)));
    return lines.join("<br>");
  },
  route(rt, m) {
    const r = rt.route;
    const t = m.data.trade || {};
    const a = rt.a?.short || rt.a?.name || r.a, b = rt.b?.short || rt.b?.name || r.b;
    const lines = [
      `<b>${esc(a)} ⇄ ${esc(b)}</b> ${muted(`flujo n.º ${esc(r.rank)}`)}`,
      `<b>${int(r.trips)}</b> viajes el ${esc(t.date_text || t.date || "")}`,
      `${esc(a)} → ${esc(b)}: ${int(r.trips_ab)}<br>${esc(b)} → ${esc(a)}: ${int(r.trips_ba)}`,
    ];
    if (r.km != null) lines.push(`${dec(r.km)} km por viaje de media, en línea recta`);
    const work = r.purposes?.trabajo_estudio;
    if (work != null) lines.push(`Con destino al trabajo o al estudio: ${pct(work, 0)}`);
    lines.push(muted("Un solo día, no una media. El arco es dibujo: MITMA no da el recorrido."));
    if (t.attribution?.text) lines.push(muted(esc(t.attribution.text)));
    return lines.join("<br>");
  },
};
