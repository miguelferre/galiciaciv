// Asesor de Energía y recursos: los aerogeneradores, las canteras y las lonjas que salen en el mapa.
import { esc, fin } from "../core/util.js";
import { int, money, pct } from "../core/fmt.js";
import { barList, shareBar, stackedBars, sizeLegend, swatchLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, chips, segmented, sourcesHtml } from "../core/view.js";
import { frameBox, focusPoint, gpxScale, FRAME_MAX_GPX } from "../core/frame.js";
import { glyph } from "../../../ui/icon.js";
import { t } from "../../../i18n.js";

// One group per resource category of resources.json: each has its own unit, so its own circle scale on the map.
const GROUPS = [
  { id: "wind", category: "energy", label: t("Eólica"), measure: t("Aerogeneradores"), one: t("aerogenerador"), many: t("aerogeneradores"), short: t("aerog."), places: t("casillas"), rank: 3, rMax: 10, legend: [5, 15, 35] },
  { id: "quarries", category: "mineral", label: t("Canteras"), measure: t("Canteras"), one: t("explotación"), many: t("explotaciones"), short: t("explot."), places: t("casillas"), rank: 2, rMax: 10, legend: [2, 8, 15] },
  { id: "fish", category: "agri", label: t("Lonjas"), measure: t("Venta en lonja"), money: true, places: t("concellos"), rank: 1, rMax: 20, legend: [1e6, 2e7, 8e7] },
];
// The slate-dark brown of "otras_rocas" cannot be told apart from the dark panel and the dimmed map.
const LIGHTER = { otras_rocas: "#8f7b68" };
const TOP_COMARCAS = 12;

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const res = app.data.resources;
  if (!res) {
    el.innerHTML = `<p class="adv-empty pad">${t("No se ha podido cargar resources.json: no hay recursos que mostrar.")}</p>`;
    return {};
  }
  const groups = GROUPS.map((g) => ({ ...g, types: res.types.filter((ty) => ty.category === g.category).map((ty) => ty.id) })).filter((g) => g.types.length);
  const types = groups.flatMap((g) => g.types.map((id) => res.types.find((ty) => ty.id === id)));
  const typeById = new Map(types.map((ty) => [ty.id, ty]));
  const groupOf = new Map(groups.flatMap((g) => g.types.map((ty) => [ty, g])));
  const items = res.items.map((it, i) => ({ ...it, idx: i, key: String(i) })).filter((it) => typeById.has(it.type));
  const colorOf = (id) => LIGHTER[id] || typeById.get(id)?.color || "#c9a45c";
  const comarca = (abbr) => data.stateByAbbr.get(abbr) || null;
  const comarcaName = (abbr) => comarca(abbr)?.name || abbr || "–";

  // Totals over the mapped items: {value, count (marks), cells} of any subset.
  const sum = (list) => ({
    value: list.reduce((a, it) => a + (fin(it.value) ? it.value : 0), 0),
    count: list.length,
    cells: new Set(list.map((it) => it.cell)).size,
  });
  const byType = new Map(types.map((ty) => [ty.id, sum(items.filter((it) => it.type === ty.id))]));
  const byGroup = new Map(groups.map((g) => [g.id, { ...sum(items.filter((it) => g.types.includes(it.type))), max: Math.max(1, ...items.filter((it) => g.types.includes(it.type) && fin(it.value)).map((it) => it.value)) }]));
  const qty = (g, v) => (g.money ? money(v) : `${int(v)} ${v === 1 ? g.one : g.many}`);
  const places = (g, n) => `${int(n)} ${n === 1 ? g.places.slice(0, -1) : g.places}`;

  const st = { on: new Set(types.map((ty) => ty.id)), state: null, measure: groups[0]?.id, allRows: false };
  ctx.setShowResources(true);

  // --- headline -------------------------------------------------------------------------------------------------
  const TILE = {
    wind: (s) => ({ label: t("Aero­generadores"), value: int(s.value), sub: t("en {n} casillas; en marcha, autorizados o en obras", { n: int(s.cells) }) }),
    quarries: (s) => ({ label: t("Canteras activas"), value: int(s.value), sub: t("explotaciones en {n} casillas (servicio de 2015)", { n: int(s.cells) }) }),
    fish: (s) => ({ label: t("Venta en lonja"), value: money(s.value), sub: t("primera venta de 2025, en {n} concellos", { n: int(s.count) }) }),
  };
  const top = el.appendChild(document.createElement("div"));
  top.innerHTML = tiles(groups.map((g) => TILE[g.id](byGroup.get(g.id)))) +
    `<p class="adv-callout">${t("<b>Solo cuenta lo que sale en el mapa</b>, no es el total de Galicia ni de una comarca. Una casilla sale con 2 aerogeneradores o más, o con alguna explotación activa de un mismo grupo de rocas; las lonjas se suman por concello.")}</p>`;

  // --- quarries by type -----------------------------------------------------------------------------------------
  const quarry = groups.find((g) => g.id === "quarries");
  let mixBars = null;
  if (quarry) {
    const mixBody = section(el, { title: t("Canteras por tipo"), kicker: t("Explotaciones que salen en el mapa"), note: t("Explotaciones marcadas como activas en la base BDMIN del IGME. El servicio es de <b>2015</b>: «activa» puede no serlo hoy. Pulsa un tipo para dejarlo solo en el mapa.") });
    const total = byGroup.get(quarry.id).value || 1;
    const parts = quarry.types.map((id) => {
      const ty = typeById.get(id), s = byType.get(id);
      return { key: id, label: ty.name, value: s.value, color: colorOf(id), text: `${int(s.value)} · ${pct(s.value / total, 0)}`, sub: places(quarry, s.count), icon: glyph(ty, 14) };
    }).sort((a, b) => b.value - a.value);
    const mixHover = (p) => emphasise(p ? (it) => it.type === p.key : null);
    shareBar(mixBody, { parts, legend: false, onHover: mixHover, onClick: (p) => solo(p.key) });
    mixBars = barList(mixBody, { rows: parts, onHover: mixHover, onClick: (p) => solo(p.key), ariaLabel: t("Explotaciones en el mapa por tipo") });
  }
  function solo(typeId) {
    const only = st.on.size === 1 && st.on.has(typeId);
    st.on = only ? new Set(types.map((ty) => ty.id)) : new Set([typeId]);
    typeChips.set(st.on);
    apply();
  }

  // --- filters --------------------------------------------------------------------------------------------------
  const fBody = section(el, { title: t("Filtrar el mapa"), note: t("Activa o desactiva tipos (Alt + clic para dejar solo uno). El mapa atenúa el terreno y dibuja un círculo por cada marca, según su tamaño dentro de su grupo.") });
  const typeChips = chips(fBody, {
    label: t("Tipos de recurso"),
    items: types.map((ty) => {
      const g = groupOf.get(ty.id), s = byType.get(ty.id);
      return { key: ty.id, label: ty.name, color: colorOf(ty.id), icon: glyph(ty, 13), count: int(g.money ? s.count : s.value) };
    }),
    onChange: (on) => { st.on = on; apply(); },
  });
  const quick = document.createElement("div");
  quick.className = "adv-row";
  quick.innerHTML = groups.map((g) => `<button type="button" class="adv-mini" data-g="${g.id}">${esc(g.label)}</button>`).join("") +
    `<button type="button" class="adv-mini" data-g="all">${t("Todo")}</button><button type="button" class="adv-mini" data-g="none">${t("Nada")}</button>`;
  fBody.appendChild(quick);
  quick.addEventListener("click", (e) => {
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (!g) return;
    st.on = g === "all" ? new Set(types.map((ty) => ty.id)) : g === "none" ? new Set() : new Set(groups.find((x) => x.id === g).types);
    typeChips.set(st.on);
    apply();
  });
  const stateChip = document.createElement("div");
  stateChip.className = "adv-row adv-filterbar";
  fBody.appendChild(stateChip);
  stateChip.addEventListener("click", (e) => { if (e.target.closest("[data-clear-state]")) setState(null); });
  const legendBox = document.createElement("div");
  fBody.appendChild(legendBox);

  // --- sites ----------------------------------------------------------------------------------------------------
  const tBody = section(el, { title: t("Sitios"), note: t("Todas las marcas del mapa que pasan los filtros. Pasa el puntero para encontrarlas; pulsa para ir hasta ellas.") });
  const table = createTable(tBody, {
    caption: t("Recursos que salen en el mapa"),
    search: t("Buscar nombre, parque o comarca"),
    searchText: (r) => `${r.name} ${comarcaName(r.state)} ${r.detail || ""} ${typeById.get(r.type)?.name || ""}`,
    rank: true,
    columns: [
      { key: "name", label: t("Sitio"), align: "l", width: "minmax(0,1.8fr)", value: (r) => r.name, html: (r) => `<span class="ic">${glyph(typeById.get(r.type), 13)}</span> ${esc(r.name)}` },
      { key: "type", label: t("Tipo"), align: "l", width: "minmax(0,1fr)", hideBelow: 520, value: (r) => typeById.get(r.type)?.name, text: (r) => typeById.get(r.type)?.name || r.type },
      { key: "state", label: t("Comarca"), align: "l", width: "minmax(0,1fr)", value: (r) => comarcaName(r.state), text: (r) => comarcaName(r.state) },
      // Units differ between groups, so the sort goes by group first and by size inside it.
      { key: "value", label: t("Tamaño"), width: "minmax(0,.9fr)", value: (r) => (fin(r.value) ? groupOf.get(r.type).rank * 1e12 + r.value : null), text: (r) => sizeText(r), title: t("Ordenar por grupo (eólica, canteras, lonjas) y, dentro de cada uno, por tamaño") },
    ],
    rows: [],
    sort: { key: "value", dir: "desc" },
    maxHeight: 300,
    empty: t("Ningún sitio pasa los filtros."),
    onHover: (r) => hoverSite(r),
    onClick: (r) => goTo(r),
  });
  function sizeText(r) {
    const g = groupOf.get(r.type);
    if (!fin(r.value)) return "–";
    return g.money ? money(r.value) : `${int(r.value)} ${g.short}`;
  }
  function hoverSite(r) {
    link.hover(r ? { resources: new Set([r.idx]), dimOthers: true, label: r.name } : null);
    for (const l of layers) l.bubbles.setHot(r ? r.key : null);
  }
  function goTo(r) {
    // A site picked from a chart may be filtered out: switch its type back on so the map can show it.
    if (!st.on.has(r.type)) {
      st.on.add(r.type);
      typeChips.set(st.on);
      apply();
    }
    flyTo(r);
  }
  function flyTo(r) {
    // Close enough for every resource icon to be drawn.
    focusPoint(app, r.x, r.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, gpxScale(FRAME_MAX_GPX))));
  }

  // --- comarcas -------------------------------------------------------------------------------------------------
  const sBody = section(el, { title: t("Qué comarcas destacan"), note: t("Suma de lo que sale en el mapa en cada comarca. Pulsa una para filtrar todo por ella; púlsala de nuevo para quitar el filtro.") });
  const pickRow = sBody.appendChild(document.createElement("div"));
  pickRow.className = "adv-row";
  segmented(pickRow, { label: t("Qué comparar"), options: groups.map((g) => ({ value: g.id, label: g.measure })), value: st.measure, onChange: (v) => { st.measure = v; st.allRows = false; drawComarcas(); } });
  const rankBox = sBody.appendChild(document.createElement("div"));
  let stacks = null;
  function drawComarcas() {
    const g = groups.find((x) => x.id === st.measure);
    const total = byGroup.get(g.id).value;
    const all = data.levels.states.rows.map((row) => {
      const parts = {};
      let ty = 0;
      for (const it of items) {
        if (it.state !== row.v.abbr || !g.types.includes(it.type) || !fin(it.value)) continue;
        parts[it.type] = (parts[it.type] || 0) + it.value;
        ty += it.value;
      }
      return { key: row.v.abbr, label: row.name, ref: row.ref, parts, total: ty, text: g.money ? money(ty) : int(ty) };
    });
    const rows = all.filter((r) => r.total > 0).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"));
    rankBox.innerHTML = "";
    const first = rows.slice(0, 3);
    if (first.length && total > 0) {
      rankBox.insertAdjacentHTML("beforeend", `<p class="adv-note">${t("Destacan {lista}: suman el {p} {que} del mapa.", { lista: first.map((r) => `<b>${esc(r.label)}</b> (${esc(qty(g, r.total))})`).join(", "), p: pct(first.reduce((a, r) => a + r.total, 0) / total, 0), que: g.money ? t("de la venta") : g.id === "wind" ? t("de los aerogeneradores") : t("de las explotaciones") })}</p>`);
    }
    stacks = stackedBars(rankBox, {
      rows: st.allRows ? rows : rows.slice(0, TOP_COMARCAS),
      max: rows[0]?.total || 1,
      keys: g.types.map((id) => ({ key: id, label: typeById.get(id).name, color: colorOf(id) })),
      fmt: (v) => qty(g, v),
      ariaLabel: t("{m} por comarca", { m: g.measure }),
      onHover: (x) => {
        if (!x) { link.hover(null); return emphasise(null); }
        const part = g.types.length > 1 ? x.part : null;
        link.hover({ states: new Set([x.row.ref]), dimOthers: true, label: part ? `${x.row.label}: ${typeById.get(part).name}` : x.row.label });
        emphasise((it) => it.state === x.row.key && (part ? it.type === part : g.types.includes(it.type)));
      },
      onClick: (x) => setState(st.state === x.row.key ? null : x.row.key, true),
    });
    stacks.setSelected(st.state);
    if (g.types.length > 1) rankBox.insertAdjacentHTML("beforeend", swatchLegend(g.types.map((id) => ({ label: typeById.get(id).name, color: colorOf(id) }))));
    if (rows.length > TOP_COMARCAS) {
      rankBox.insertAdjacentHTML("beforeend", `<div class="adv-row"><button type="button" class="adv-mini" data-more aria-expanded="${st.allRows}">${st.allRows ? t("Ver solo las {n} primeras", { n: TOP_COMARCAS }) : t("Ver las {n} comarcas", { n: int(rows.length) })}</button></div>`);
    }
    const none = all.length - rows.length;
    if (none > 0) rankBox.insertAdjacentHTML("beforeend", `<p class="adv-note">${t("{n} de las {total} comarcas no tienen {que} en el mapa.", { n: int(none), total: int(all.length), que: g.money ? t("ninguna lonja") : g.id === "wind" ? t("aerogeneradores") : t("canteras") })}</p>`);
  }
  rankBox.addEventListener("click", (e) => {
    if (!e.target.closest("[data-more]")) return;
    st.allRows = !st.allRows;
    drawComarcas();
    rankBox.querySelector("[data-more]")?.focus();
  });

  // --- lonjas ---------------------------------------------------------------------------------------------------
  const fish = groups.find((g) => g.id === "fish");
  if (fish) {
    const lBody = section(el, { title: t("Las lonjas que más venden"), note: t("Valor de la primera venta de pesca fresca en 2025, sumado por concello. Pulsa una para ir hasta ella.") });
    const best = items.filter((it) => fish.types.includes(it.type) && fin(it.value)).sort((a, b) => b.value - a.value).slice(0, 10);
    barList(lBody, {
      rank: true,
      rows: best.map((it) => ({ key: it.key, label: it.name.replace(/^Lonja de /, ""), sub: comarcaName(it.state), value: it.value, text: money(it.value), color: colorOf(it.type), it })),
      onHover: (r) => hoverSite(r ? r.it : null),
      onClick: (r) => goTo(r.it),
      ariaLabel: t("Lonjas por valor de primera venta"),
    });
  }

  // --- explainer ------------------------------------------------------------------------------------------------
  const eBody = section(el, { title: t("Qué significan los símbolos"), note: t("Cada tipo de recurso, lo que hace falta para que salga en el mapa y de dónde viene el dato.") });
  const tileText = (s) => String(s || "").replace(/un hexágono/g, t("una casilla"));
  const srcLine = (id) => {
    const src = data.source(id);
    return t("Fuente: {src}", { src: esc(src ? `${src.title} (${src.vintage || src.publisher})` : id) });
  };
  eBody.innerHTML = groups.map((g) => {
    // A description is "what it is. How it is mapped."; the second part is written once when the whole group shares it.
    const split = g.types.map((id) => {
      const d = tileText(typeById.get(id).description), k = d.indexOf(". ");
      return k < 0 ? [d, ""] : [d.slice(0, k + 1), d.slice(k + 2)];
    });
    const shared = g.types.length > 1 && split[0][1] && split.every((s) => s[1] === split[0][1]) ? split[0][1] : "";
    return `<h4 class="adv-h4">${esc(g.label)}</h4>${shared ? `<p class="adv-note">${esc(shared)} ${srcLine(typeById.get(g.types[0]).source)}.</p>` : ""}${g.types.map((id, i) => {
      const ty = typeById.get(id), s = byType.get(id);
      return `<div class="adv-explain" style="--cc:${esc(colorOf(id))}"><span class="ic">${glyph(ty, 22)}</span><div>
        <b>${esc(ty.name)}</b> <span class="sub">${esc(places(g, s.count))} · ${esc(qty(g, s.value))}</span>
        <p>${esc(shared ? split[i][0] : tileText(ty.description))}</p>${shared ? "" : `<span class="src">${srcLine(ty.source)}</span>`}</div></div>`;
    }).join("")}`;
  }).join("");

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["xunta_eolica", "igme_bdmin", "pesca_lonxas", "ige_comarcas"], [
    t("Solo cuenta lo que sale en el mapa, según el umbral de cada casilla: <b>no</b> son los totales de Galicia ni de una comarca."),
    t("La capa eólica de la Xunta junta parques en funcionamiento, autorizados y en obras sin separarlos: no es un recuento de máquinas instaladas. Los parques en tramitación quedan fuera."),
    t("Las canteras salen de un servicio del IGME actualizado por última vez en marzo de 2015. Recoge rocas y minerales industriales, no la minería metálica, y no da tamaño ni producción."),
    t("El importe de una lonja es el del puerto de venta, no el del lugar donde reside la flota. Las lonjas sin un concello claro no salen."),
    t("Si una casilla junta sitios de varios concellos, cuenta entera en la comarca del concello que más tiene."),
  ]));
  // advisors.css keeps each source's vintage on one line, and these run wider than the dock: let them wrap.
  el.querySelectorAll(".adv-sources .v").forEach((n) => (n.style.whiteSpace = "normal"));

  // --- map ------------------------------------------------------------------------------------------------------
  const layers = groups.map((g) => ({
    g,
    bubbles: ctx.bubbles(g.id, {
      rMax: g.rMax,
      tip: (b) => {
        const it = b.it, ty = typeById.get(it.type);
        return `<b>${esc(it.name)}</b><br>${esc(ty.name)} · <b>${esc(qty(g, it.value))}</b>${it.state ? ` · ${esc(comarcaName(it.state))}` : ""}${it.detail ? `<br><span class="sub">${esc(it.detail)}</span>` : ""}`;
      },
      onHover: (b) => table.setHot(b ? b.key : null),
      onClick: (b) => { table.setHot(b.key); flyTo(b.it); },
    }),
  }));

  /** Fade every circle but those of the visible sites that pass `pred` (null: fade none). */
  function emphasise(pred) {
    const vis = pred ? visible().filter(pred) : null;
    for (const l of layers) {
      if (!vis) { l.bubbles.setSelected(null); continue; }
      const keys = vis.filter((it) => l.g.types.includes(it.type)).map((it) => it.key);
      l.bubbles.setSelected(new Set(keys.length ? keys : ["none"])); // an empty set would fade nothing
    }
  }

  function visible() {
    return items.filter((it) => st.on.has(it.type) && (!st.state || it.state === st.state));
  }

  function setState(abbr, fly = false) {
    st.state = abbr;
    stacks?.setSelected(abbr);
    apply();
    if (abbr && fly) {
      const b = app.highlightBounds({ states: new Set([comarca(abbr)?.ref]) });
      if (b) frameBox(app, b, { pad: 30 });
    }
  }

  function apply() {
    ctx.setResourceFilter(st.on.size === types.length ? null : { types: new Set(st.on) });
    const vis = visible();
    table.setRows(vis);
    const legends = [];
    for (const { g, bubbles } of layers) {
      const vMax = byGroup.get(g.id).max;
      const list = vis.filter((it) => g.types.includes(it.type) && fin(it.value));
      bubbles.set(list.map((it) => ({ key: it.key, x: it.x, y: it.y, value: it.value, color: colorOf(it.type), it })), { vMax });
      bubbles.setSelected(null);
      if (!list.length) continue;
      const r = (v) => g.rMax * Math.sqrt(v / vMax);
      legends.push(sizeLegend(g.legend.filter((v) => v <= vMax * 1.2), r, (v) => (g.money ? `${int(v / 1e6)} M` : int(v)), g.money ? t("Lonjas (€)") : g.measure));
    }
    legendBox.innerHTML = legends.join("");
    const row = st.state ? comarca(st.state) : null;
    link.base({ dimOthers: true, states: row ? new Set([row.ref]) : undefined });
    stateChip.innerHTML = st.state
      ? `<span class="adv-fchip">${t("Comarca")}: <b>${esc(comarcaName(st.state))}</b> · ${int(vis.length)} ${vis.length === 1 ? t("sitio") : t("sitios")}<button type="button" data-clear-state aria-label="${t("Quitar el filtro de comarca")}">✕</button></span>`
      : "";
    mixBars?.setSelected(st.on.size === 1 ? [...st.on][0] : null);
  }
  drawComarcas();
  apply();

  return {
    onMapHover(h) {
      if (h.resource) {
        const i = res.items.indexOf(h.resource);
        if (i >= 0) table.setHot(String(i));
      }
    },
    onEscape() {
      if (st.state) { setState(null); return true; }
      return false;
    },
    destroy() {},
  };
}
