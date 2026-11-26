// Commerce advisor: one day of people's trips between comarcas (MITMA, trade.json; not freight), the ports and airports
// and the road and rail network (infrastructure.json).
import { esc, fin, el as mk, withAlpha } from "../core/util.js";
import { int, pct, dec, count3, signedPct } from "../core/fmt.js";
import { barList, shareBar, stackedBars, swatchLegend, sizeLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, segmented, sourcesHtml, frameBtn } from "../core/view.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { prepareRoutes } from "../../../render/art/improvements.js";
import { REF_KM } from "../../../render/art/lod.js";

const ROUTE_COLOR = "#b57ae0"; // the violet of the map layer's travel routes
const PURPOSE_COLOR = { trabajo_estudio: "#d9a457", casa: "#8fcbb8", frecuente: "#b57ae0", no_frecuente: "#4f9ad6" };
export async function mount(ctx) {
  const { app, el, link, data } = ctx;
  const [trade, infra] = await Promise.all([app.loadData("trade"), app.loadData("infrastructure")]);
  if (!trade && !infra) {
    el.innerHTML = `<p class="adv-empty pad">Faltan los datos de viajes y de infraestructuras, así que Comercio no tiene nada que mostrar.</p>`;
    return {};
  }
  const metros = data.levels.metros, comarcas = data.levels.states;
  const dayText = trade?.date_text || trade?.date || "";
  const attribution = trade?.attribution
    ? `<a href="${esc(trade.attribution.url)}" target="_blank" rel="noopener" style="color:var(--gold-bright)">${esc(trade.attribution.text)}</a>`
    : "";
  const reveal = (node) => node.firstElementChild?.scrollIntoView?.({ block: "nearest" });
  // Filled in by the routes block when trade.json is there.
  let trips = null;

  // --- headline -------------------------------------------------------------------------------------------------
  const nt = trade?.national_trips || {};
  const head = [];
  if (trade) head.push({ label: "Viajes en un día", value: count3(nt.galicia), sub: dayText });
  if (infra) head.push({ label: "Puertos y aeropuertos", value: int((infra.ports || []).length + (infra.airports || []).length), sub: `${int((infra.ports || []).length)} puertos · ${int((infra.airports || []).length)} aeropuertos` });
  el.insertAdjacentHTML("beforeend", tiles(head) + (trade ? `<p class="adv-callout">Viajes de <b>personas</b> en un solo día, el <b>${esc(dayText)}</b>: no son mercancías ni una media del año. ${int(nt.internal)} empiezan y acaban en Galicia, ${int(nt.outbound)} salen de ella y ${int(nt.inbound)} llegan de fuera. ${attribution}.</p>` : ""));

  // --- routes between comarcas -----------------------------------------------------------------------------------
  if (trade) trips = tradeSections();

  // --- ports and airports ----------------------------------------------------------------------------------------
  if (infra) infraSections();

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [...(trade?.sources || []), ...(infra?.sources || [])], [
    ...(trade ? [
      `Los viajes son de un solo día laborable, el ${esc(dayText)}. MITMA los estima con teléfonos móviles: viajes de más de 500 m de los residentes en España. No dicen qué se transporta ni en qué medio.`,
      "El motivo se deduce de la actividad en el destino del viaje.",
      `${esc(trade.path_note || "")} ${attribution}.`,
    ] : []),
    ...(infra ? [
      "Los puertos son los de interés general; los autonómicos no están. Su posición viene de Wikidata (CC0) y la de los aeropuertos de OpenStreetMap (ODbL). No se muestran cifras de tráfico: Puertos del Estado y Aena exigen autorización previa.",
      "Las carreteras y las vías del mapa son dibujo, no estadística.",
    ] : []),
  ]));

  return {
    onMapHover(h) {
      const kind = h.item?.kind;
      trips?.hover(h);
    },
    onMapClick(ev) {
      const kind = ev.item?.kind;
      if (kind === "port" || kind === "airport") { flyTo(ev.item.data); return true; }
      return trips?.click(ev) === true;
    },
    onEscape: () => trips?.escape() === true,
  };

  function flyTo(p) {
    if (!p) return;
    focusPoint(app, p.x, p.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3)));
  }

  function tradeSections() {
    const zoneById = new Map((trade.zones || []).map((z) => [z.id, z]));
    const purposes = trade.purposes || [];
    const purposeName = new Map(purposes.map((p) => [p.id, p.name]));
    const zName = (id) => zoneById.get(id)?.short || zoneById.get(id)?.name || id;
    // The same arcs the map's route layer draws, so the highlight sits on top of it.
    const routes = prepareRoutes(app.w, trade).map((a) => ({
      ...a.route, key: `${a.route.a}-${a.route.b}`, label: `${zName(a.route.a)} ⇄ ${zName(a.route.b)}`,
      path2d: a.path, pts: a.pts, bbox: a.bbox, ends: a.ends,
    }));
    const st = { purpose: null, zone: null, route: null };
    let hotRoute = null, purposeHot = null, routeBars = null;

    /** The trips a route counts for under a purpose (null = all of them). */
    const valueOf = (r, p = st.purpose) => (p ? r.trips * (r.purposes?.[p] || 0) : r.trips);
    const visibleRoutes = () => routes
      .filter((r) => !st.zone || r.a === st.zone || r.b === st.zone)
      .sort((a, b) => valueOf(b) - valueOf(a));
    const comarcaRows = (ids) => ids.map((id) => comarcas.byKey.get(id)).filter(Boolean);
    const comarcaHighlight = (ids, label) => {
      const rows = comarcaRows(ids);
      return rows.length ? { ...comarcas.highlight(rows), label } : null;
    };
    const zoneHighlight = (z) => comarcaHighlight([z.id], z.name);
    const routeHighlight = (r) => comarcaHighlight([r.a, r.b], r.label);
    const redraw = () => app.requestDraw();

    // Routes.
    const rBody = section(el, { title: "Rutas entre comarcas", kicker: esc(trade.vintage || ""), note: esc(trade.rule || "") });
    const totals = new Map(purposes.map((p) => [p.id, routes.reduce((a, r) => a + valueOf(r, p.id), 0)]));
    rBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Motivo de los viajes en las ${int(routes.length)} rutas</h4>`);
    const purposeBar = shareBar(rBody, {
      parts: purposes.map((p) => ({ key: p.id, label: p.name, value: totals.get(p.id), color: PURPOSE_COLOR[p.id] || "#999", text: `${count3(totals.get(p.id))} viajes` })),
      onHover: (p) => { purposeHot = p ? p.key : null; redraw(); },
      onClick: (p) => setPurpose(st.purpose === p.key ? null : p.key),
    });
    rBody.insertAdjacentHTML("beforeend", `<p class="adv-note">Pulsa un motivo para ordenar las rutas por esos viajes.</p>`);
    const fRow = mk("div", "adv-row adv-filterbar");
    rBody.appendChild(fRow);
    fRow.addEventListener("click", (e) => {
      if (e.target.closest("[data-clear-purpose]")) setPurpose(null);
      if (e.target.closest("[data-clear-zone]")) setZone(null);
    });
    const rHost = mk("div");
    const rDetail = mk("div", "adv-detail");
    rBody.append(rHost, rDetail);
    rBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${esc(trade.path_note || "")} El grosor sigue los viajes. ${attribution}, ${esc(dayText)}.</p>`);

    function drawRoutes() {
      const vis = visibleRoutes();
      if (st.route && !vis.includes(st.route)) { st.route = null; drawRouteDetail(); }
      rHost.innerHTML = "";
      routeBars = null;
      if (vis.length) {
        routeBars = barList(rHost, {
          rank: !st.zone, ariaLabel: "Rutas entre comarcas con más viajes",
          max: Math.max(1, ...routes.map((r) => valueOf(r))),
          rows: vis.map((r) => ({
            key: r.key, label: r.label, value: valueOf(r), text: count3(Math.round(valueOf(r))),
            color: st.purpose ? PURPOSE_COLOR[st.purpose] : ROUTE_COLOR,
            sub: st.purpose ? `${pct(r.purposes?.[st.purpose], 0)} de ${count3(r.trips)}` : `${dec(r.km)} km`,
            full: `${r.label} (n.º ${r.rank} por viajes totales, ${dec(r.km)} km por viaje de media)`,
          })),
          selected: st.route?.key,
          onHover: (row) => {
            const r = row ? routes.find((x) => x.key === row.key) : null;
            setHotRoute(r);
            link.hover(r ? routeHighlight(r) : null);
          },
          onClick: (row) => selectRoute(routes.find((x) => x.key === row.key)),
        });
      } else {
        rHost.innerHTML = `<p class="adv-empty">Ninguna de las ${int(routes.length)} rutas con más viajes toca esta comarca. Abajo están sus socios principales.</p>`;
      }
      fRow.innerHTML = (st.purpose ? `<span class="adv-fchip">Motivo: <b>${esc(purposeName.get(st.purpose))}</b><button type="button" data-clear-purpose aria-label="Quitar el filtro de motivo">✕</button></span>` : "")
        + (st.zone ? `<span class="adv-fchip">Comarca: <b>${esc(zName(st.zone))}</b> · ${int(vis.length)} ${vis.length === 1 ? "ruta" : "rutas"}<button type="button" data-clear-zone aria-label="Quitar el filtro de comarca">✕</button></span>` : "");
      purposeBar.setSelected(st.purpose);
      redraw();
    }
    function setPurpose(p) { st.purpose = p; drawRoutes(); }
    function setHotRoute(r) {
      if (hotRoute === (r || null)) return;
      hotRoute = r || null;
      redraw();
    }
    function selectRoute(r) {
      if (!r) return;
      st.route = st.route === r ? null : r;
      routeBars?.setSelected(st.route?.key ?? null);
      drawRouteDetail();
      redraw();
      if (st.route) {
        frameRoute(st.route);
        reveal(rDetail);
      }
    }
    function frameRoute(r) {
      const [x0, y0, x1, y1] = r.bbox;
      const m = REF_KM * 2;
      frameBox(app, { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m }, { pad: 40 });
    }
    function drawRouteDetail() {
      const r = st.route;
      if (!r) { rDetail.innerHTML = ""; return; }
      const a = zName(r.a), b = zName(r.b);
      rDetail.innerHTML = `<div class="adv-card-detail">
        <h4 class="adv-h4">${esc(r.label)}</h4>
        ${tiles([
          { label: "Viajes", value: int(r.trips), sub: "los dos sentidos" },
          { label: "Por viaje", value: `${dec(r.km)} km`, sub: "media, en línea recta" },
          { label: "Entre cabeceras", value: `${int(r.dist_km)} km`, sub: "en línea recta" },
        ])}
        <p class="adv-note"><b>${esc(a)} → ${esc(b)}:</b> ${int(r.trips_ab)} · <b>${esc(b)} → ${esc(a)}:</b> ${int(r.trips_ba)}</p>
        <p class="adv-note"><b>Motivo:</b> ${purposes.map((p) => `${esc(p.name)} ${pct(r.purposes?.[p.id])}`).join(" · ")}</p>
        <p class="adv-note">Un solo día, el ${esc(dayText)}. ${attribution}.</p>
        <button type="button" class="adv-mini" data-unpin>Cerrar</button></div>`;
      rDetail.querySelector("[data-unpin]").addEventListener("click", () => selectRoute(st.route));
    }

    // Comarcas and their partners.
    const zBody = section(el, {
      title: "Comarcas y sus socios",
      note: `Viajes del ${esc(dayText)} dentro de cada comarca, con otras comarcas y con fuera de Galicia. Pasa el puntero para verla en el mapa y pulsa para ver sus rutas y socios.`,
    });
    const outside = (z) => (z.totals_trips ? (z.totals_trips.inbound || 0) + (z.totals_trips.outbound || 0) : null);
    const zones = (trade.zones || []).map((z) => ({ ...z, key: z.id }));
    const num = (key, label, short, value, extra = {}) => ({ key, label, short, value, text: (z) => count3(value(z)), ...extra });
    const zTable = createTable(zBody, {
      caption: "Viajes por comarca", rank: true, maxHeight: 260, search: "Buscar comarca",
      searchText: (z) => z.name,
      columns: [
        { key: "name", label: "Comarca", align: "l", width: "minmax(0,1.7fr)", value: (z) => z.name, text: (z) => z.name },
        num("within", "Viajes dentro de la comarca", "Dentro", (z) => z.totals_trips?.within),
        num("other", "Viajes desde o hacia otras comarcas", "Otras", (z) => z.totals_trips?.other_zones,
          { bar: { max: Math.max(1, ...zones.map((z) => z.totals_trips?.other_zones || 0)), color: "rgba(47,164,184,.3)" } }),
        num("outside", "Viajes desde o hacia fuera de Galicia", "Fuera", outside, { hideBelow: 360 }),
      ],
      rows: zones, sort: { key: "other", dir: "desc" },
      onHover: (z) => link.hover(z ? zoneHighlight(z) : null),
      onClick: (z) => setZone(st.zone === z.id ? null : z.id),
    });
    const zDetail = mk("div", "adv-detail");
    zBody.appendChild(zDetail);

    function setZone(id) {
      st.zone = id;
      drawRoutes();
      zTable.setSelected(id ? new Set([id]) : null);
      const h = id ? zoneHighlight(zoneById.get(id)) : null;
      link.base(h ? { ...h, dimOthers: true } : null, { frame: true });
      drawZoneDetail();
      if (id) reveal(zDetail);
    }
    function drawZoneDetail() {
      const z = st.zone ? zoneById.get(st.zone) : null;
      if (!z) { zDetail.innerHTML = ""; return; }
      const names = (z.cities || []).map((id) => metros.byKey.get(id)?.name).filter(Boolean);
      const other = z.totals_trips?.other_zones;
      zDetail.innerHTML = `<div class="adv-card-detail"><h4 class="adv-h4">${esc(z.name)}</h4>
        <p class="adv-note">${int(z.counties)} ${z.counties === 1 ? "concello" : "concellos"} · ${names.length ? `${names.length === 1 ? "ciudad" : "ciudades"}: ${names.map(esc).join(", ")}` : "sin ciudades de 10 000 habitantes o más"}</p>
        ${tiles([
          { label: "Dentro", value: count3(z.totals_trips?.within), sub: "en la comarca" },
          { label: "Otras comarcas", value: count3(other), sub: "ida y vuelta" },
          { label: "Fuera de Galicia", value: count3(outside(z)), sub: "ida y vuelta" },
        ])}
        <h4 class="adv-h4">Socios principales (viajes en los dos sentidos)</h4><div class="adv-zp"></div>
        <div class="adv-row">${frameBtn()}<button type="button" class="adv-mini" data-unzone>Cerrar</button></div></div>`;
      barList(zDetail.querySelector(".adv-zp"), {
        compact: true, ariaLabel: "Comarcas socias principales",
        rows: (z.partners || []).map(([id, v]) => ({
          key: id, label: zName(id), value: v, text: count3(v), color: ROUTE_COLOR,
          sub: other > 0 ? `${pct(v / other, 0)} de «otras»` : "",
        })),
        onHover: (row) => { const pz = row ? zoneById.get(row.key) : null; link.hover(pz ? zoneHighlight(pz) : null); },
        onClick: (row) => { if (zoneById.has(row.key)) { link.hover(null); setZone(row.key); } },
      });
      zDetail.querySelector("[data-unzone]").addEventListener("click", () => setZone(null));
    }

    // The routes overlay: all visible routes (unless the map layer already draws them), the hovered one on top.
    const tradeLayerOn = () => (app.staticLayers?.() || []).some((l) => l.id === "trade" && (typeof l.visible !== "function" || l.visible()));
    ctx.cleanup(app.registerOverlay({
      id: "adv-commerce-routes", z: 18, space: "world",
      draw(ctx2, cam) {
        const s = cam.scale;
        const vMax = Math.max(1, ...routes.map((r) => valueOf(r, purposeHot || st.purpose)));
        const width = (r) => Math.sqrt(valueOf(r, purposeHot || st.purpose) / vMax);
        const hot = hotRoute || st.route;
        ctx2.save();
        ctx2.lineCap = "round";
        ctx2.lineJoin = "round";
        if (!tradeLayerOn()) {
          const color = PURPOSE_COLOR[purposeHot || st.purpose] || ROUTE_COLOR;
          for (const r of visibleRoutes()) {
            if (r === hot) continue;
            const wpx = 1.2 + 4.5 * width(r);
            ctx2.strokeStyle = "rgba(10,8,4,.55)";
            ctx2.lineWidth = (wpx + 2) / s;
            ctx2.stroke(r.path2d);
            ctx2.strokeStyle = withAlpha(color, 0.9);
            ctx2.lineWidth = wpx / s;
            ctx2.stroke(r.path2d);
          }
        }
        if (hot) {
          const wpx = 2.5 + 5 * width(hot);
          ctx2.strokeStyle = "rgba(10,8,4,.9)";
          ctx2.lineWidth = (wpx + 4) / s;
          ctx2.stroke(hot.path2d);
          ctx2.strokeStyle = "#ffd36a";
          ctx2.lineWidth = wpx / s;
          ctx2.stroke(hot.path2d);
          for (const k of [0, 2]) {
            ctx2.beginPath();
            ctx2.arc(hot.ends[k], hot.ends[k + 1], 5 / s, 0, Math.PI * 2);
            ctx2.fillStyle = "#fff3c4";
            ctx2.fill();
            ctx2.strokeStyle = "rgba(10,8,4,.9)";
            ctx2.lineWidth = 1.5 / s;
            ctx2.stroke();
          }
        }
        ctx2.restore();
      },
    }));
    drawRoutes();

    /** The visible route under a screen point (css px), within tol px of its arc. */
    function routeAt(sx, sy, tol) {
      if (!fin(sx) || !fin(sy)) return null;
      const [x, y] = app.cam.toWorld(sx, sy);
      let best = null, bestD = tol / app.cam.scale;
      for (const r of visibleRoutes()) {
        const p = r.pts;
        for (let k = 2; k < p.length; k += 2) {
          const d = segDist(x, y, p[k - 2], p[k - 1], p[k], p[k + 1]);
          if (d < bestD) { bestD = d; best = r; }
        }
      }
      return best;
    }
    const routeFromMap = (h, tol) => {
      if (h.item?.kind === "route") {
        const found = visibleRoutes().find((x) => x.a === h.item.data?.route?.a && x.b === h.item.data?.route?.b);
        if (found) return found;
      }
      // A city, a port or an airport under the pointer has its own hover and click.
      return h.city || h.item ? null : routeAt(h.x, h.y, tol);
    };

    return {
      hover(h) {
        const r = routeFromMap(h, 7);
        routeBars?.setHot(r ? r.key : null);
        setHotRoute(r);
        const row = h.cell >= 0 ? comarcas.rowAtCell(h.cell) : null;
        zTable.setHot(row ? row.key : null, false);
      },
      click(ev) {
        const r = routeFromMap(ev, ev.pointerType === "mouse" ? 7 : 14);
        if (!r) return false;
        selectRoute(r);
        return true;
      },
      escape() {
        if (st.route) { selectRoute(st.route); return true; }
        if (st.zone) { setZone(null); return true; }
        if (st.purpose) { setPurpose(null); return true; }
        return false;
      },
    };
  }

  function infraSections() {
    const v = infra.vintage || {};
    // Ports and airports: positions only (no traffic figures are published; see LICENCIAS.md). A plain list, by name.
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), "es");
    const siteList = (title, kicker, note, sites, labelOf, hoverOf) => {
      const body = section(el, { title, kicker: esc(kicker || ""), note: esc(note || "") });
      const ul = mk("div", "adv-sites");
      for (const s of [...sites].sort(byName)) {
        const b = mk("button", "adv-mini");
        b.type = "button";
        b.textContent = labelOf(s);
        b.addEventListener("mouseenter", () => link.hover(hoverOf(s)));
        b.addEventListener("mouseleave", () => link.hover(null));
        b.addEventListener("click", () => flyTo(s));
        ul.appendChild(b);
      }
      body.appendChild(ul);
    };
    siteList("Puertos", v.ports, infra.rules?.ports, infra.ports || [], (p) => p.name,
      (p) => ({ cells: new Set(p.cell != null ? [p.cell] : []), label: p.name }));
    siteList("Aeropuertos", v.airports, infra.rules?.airports, infra.airports || [], (a) => `${a.id} ${a.city || a.name}`,
      (a) => ({ cells: new Set(a.cell != null ? [a.cell] : []), label: `${a.id} · ${a.city || a.name}` }));

    // Roads and rail: the counts and rules (the map layers draw them; switches live in the Map menu).
    const nBody = section(el, { title: "Carreteras y ferrocarril", open: false });
    const counts = (links) => links.reduce((a, r) => { a[r[2]] = (a[r[2]] || 0) + 1; return a; }, []);
    const nRoad = counts(infra.roads || []), nRail = counts(infra.rail || []);
    const line = (classes, n) => (classes || []).map((c, i) => `<b>${esc(c.name)}</b>: ${int(n[i] || 0)} enlaces entre casillas`).join(" · ");
    nBody.innerHTML = `<p class="adv-note">${line(infra.road_classes, nRoad)}</p><p class="adv-note">${line(infra.rail_tiers, nRail)}</p>
      <p class="adv-note">${esc(v.roads || "")}. ${esc(infra.rules?.roads || "")}</p><p class="adv-note">${esc(infra.rules?.rail || "")}</p>
      <p class="adv-note">Las carreteras, el ferrocarril, los puertos y los aeropuertos se activan o se quitan en el menú <b>Mapa</b>.</p>`;
  }
}

/** Distance from (px, py) to the segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
