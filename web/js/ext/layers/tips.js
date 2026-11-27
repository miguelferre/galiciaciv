// Hover tooltips for the map-art layers (HTML strings; every data value is escaped), in Spanish with es-ES numbers.
// Each says where the number comes from and the caveat that matters for it (one day of mobility, a drawn arc).
import { esc, int, pct } from "../../format.js";
import { t, prep, locale } from "../../i18n.js";
import { FORT_KINDS, fortKind, WONDER_KINDS } from "../../render/art/sites.js";

const muted = (s) => `<span class="muted">${s}</span>`;
const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±");

const dec = (x, d = 1) => x.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });

/** Plain-Spanish stage of a PIE project (fp.json pie[].status). */
export const FP_STATUS = {
  aprobado: t("Aprobado definitivamente"),
  declarado: t("Declarado PIE, pendiente de aprobación"),
  ambiental_finalizada: t("Evaluación ambiental terminada"),
  informacion_publica_finalizada: t("Información pública terminada"),
  en_tramitacion_ambiental: t("En tramitación ambiental"),
};
const FP_TYPE = { CIFP: t("Centro integrado de FP (CIFP)"), IES: t("Instituto de educación secundaria (IES)") };

export const tips = {
  // A centre with FP offer: its top families by places (cycles = rows of the offer, one per cycle and shift).
  fpCentre(c, m) {
    const raw = m.w.raw;
    const conc = raw.counties?.find((x) => x.geoid === c.concello)?.name;
    const kind = FP_TYPE[c.type] || t("Centro ({code})", { code: c.type_code });
    const own = c.ownership === "publica" ? t("público") : c.concertado ? t("privado concertado") : t("privado");
    const lines = [`<b>${esc(c.name)}</b>`, muted(`${esc(kind)} · ${own}${conc ? ` · ${esc(conc)}` : ""}`)];
    const by = new Map();
    for (const o of c.offer || []) {
      const e = by.get(o.family) || { n: 0, p: 0 };
      e.n++;
      e.p += o.places || 0;
      by.set(o.family, e);
    }
    const top = [...by].sort((a, b) => b[1].p - a[1].p).slice(0, 3);
    for (const [f, e] of top) {
      const v = { fam: esc(m.fp?.families.get(f) || f), n: e.n, p: int(e.p) };
      lines.push(e.n === 1 ? t("{fam}: {n} ciclo, {p} plazas", v) : t("{fam}: {n} ciclos, {p} plazas", v));
    }
    if (by.size > top.length) lines.push(muted(by.size - top.length === 1 ? t("y {n} familia más", { n: 1 }) : t("y {n} familias más", { n: by.size - top.length })));
    lines.push(t("<b>{n}</b> plazas de primer curso en 2026-27", { n: int(c.places) }));
    lines.push(muted(t("Curso completo ordinario. Xunta de Galicia.")));
    return lines.join("<br>");
  },
  fpPie(p, m) {
    const conc = m.w.raw.counties?.find((x) => x.geoid === p.concello)?.name;
    const lines = [`<b>${esc(p.company)}</b>`, muted(`${t("Proyecto industrial estratégico")}${conc ? ` · ${esc(conc)}` : ""}`)];
    if (p.project) lines.push(esc(p.project));
    if (p.jobs_total != null) lines.push(t("<b>{n}</b> empleos anunciados (directos e indirectos)", { n: int(p.jobs_total) }));
    lines.push(esc(FP_STATUS[p.status] || p.status_text || ""));
    if (p.jobs_note) lines.push(muted(esc(p.jobs_note)));
    lines.push(muted(t("Posición: centro del concello, no la parcela.")));
    return lines.join("<br>");
  },
  // Ports and airports carry no traffic figures: Puertos del Estado and Aena require prior written authorisation.
  port(p) {
    const lines = [`<b>${t("Puerto {lugar}", { lugar: esc(prep("de", p.name)) })}</b>`];
    if (p.authority && p.authority !== p.name) lines.push(muted(t("Autoridad Portuaria {lugar}", { lugar: esc(prep("de", p.authority)) })));
    lines.push(muted(t("Puerto de interés general. Posición: Wikidata.")));
    return lines.join("<br>");
  },
  airport(a) {
    const lines = [`<b>${esc(a.id)} · ${esc(a.name)}</b>`];
    if (a.city) lines.push(muted(esc(a.city)));
    lines.push(muted(t("Posición: OpenStreetMap.")));
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
    const k = WONDER_KINDS[x.kind]?.name || t("Maravilla");
    const rule = m.data.wonders?.rules?.find((r) => r.id === x.rule);
    const mt = x.metrics || {};
    const lines = [`<b>${esc(x.name)}</b>`];
    const where = [mt.concello, x.state_name].filter(Boolean).join(", ");
    if (where) lines.push(muted(esc(where)));
    lines.push(esc(rule?.name || k));
    if (mt.unesco_id) lines.push(t("Referencia UNESCO {id}", { id: esc(mt.unesco_id) }));
    if (mt.category) lines.push(t("Categoría: {c}", { c: esc(mt.category) }));
    if (mt.protected_km2 != null) lines.push(t("{n} km² de área protegida", { n: dec(mt.protected_km2, mt.protected_km2 < 10 ? 2 : 0) }));
    if (mt.area_km2 != null) lines.push(mt.declared ? t("{n} km² · declarado en {year}", { n: int(mt.area_km2), year: esc(mt.declared) }) : `${int(mt.area_km2)} km²`);
    if (rule?.text) lines.push(muted(esc(rule.text)));
    return lines.join("<br>");
  },
  // Hover on a Camino line: its name(s) and the km of Camino inside the concello under the pointer (shared stretches counted once).
  camino(l, m, x, y) {
    const names = l.routes.map((id) => m.camino?.routes.get(id)?.name || id);
    const lines = [`<b>${names.map(esc).join(" · ")}</b>`];
    const raw = m.w.raw, grid = m.w.grid;
    const cell = x != null ? grid.cellAt(x, y) : -1;
    const ci = cell >= 0 ? raw.county[cell] : -1;
    const row = ci >= 0 ? m.camino?.byConcello[raw.counties[ci].geoid] : null;
    if (row) lines.push(t("{km} km de Camino {lugar}", { km: dec(row.km), lugar: esc(prep("en", raw.counties[ci].name)) }));
    lines.push(muted(esc(m.data.camino?.attribution || "")));
    return lines.join("<br>");
  },
  route(rt, m) {
    const r = rt.route;
    const tr = m.data.trade || {};
    const a = rt.a?.short || rt.a?.name || r.a, b = rt.b?.short || rt.b?.name || r.b;
    const lines = [
      `<b>${esc(a)} ⇄ ${esc(b)}</b> ${muted(t("flujo n.º {n}", { n: esc(r.rank) }))}`,
      t("<b>{n}</b> viajes el {date}", { n: int(r.trips), date: esc(tr.date_text || tr.date || "") }),
      `${esc(a)} → ${esc(b)}: ${int(r.trips_ab)}<br>${esc(b)} → ${esc(a)}: ${int(r.trips_ba)}`,
    ];
    if (r.km != null) lines.push(t("{n} km por viaje de media, en línea recta", { n: dec(r.km) }));
    const work = r.purposes?.trabajo_estudio;
    if (work != null) lines.push(t("Con destino al trabajo o al estudio: {p}", { p: pct(work, 0) }));
    lines.push(muted(t("Un solo día, no una media. El arco es dibujo: MITMA no da el recorrido.")));
    if (tr.attribution?.text) lines.push(muted(esc(tr.attribution.text)));
    return lines.join("<br>");
  },
};
