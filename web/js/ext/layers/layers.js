// Static map layers for the map art, as factories over a model (model.js) and a switch state, so the app
// (index.js) and the art gallery (web/dev/gallery.js) draw exactly the same thing.
//
//   makeLayers(model, on, {tips}) → [layer, …]   on = {roads, rail, hubs, military, wonders, trade, camino} (booleans, read live)
//
// z slots (render/map.js Z): roads 55 and rail 56 (above rivers and borders, under city tiles), protected land 57 and
// restricted ground 58 (hatching on hexes), ports & airports 65, forts 66, wonders 67 (above city tiles, under the fog),
// name plates 68 (forts and wonders laid out together, clear of city banners and City View district plaques), trade
// routes 85 (above resources, under state names), Caminos de Santiago 84 (just under the trade routes). Everything is drawn into the cached static map; nothing animates.
import { drawRoads, drawRail, drawPort, drawAirport, drawTradeRoutes, hitRoute, ROAD_MIN_RPX } from "../../render/art/improvements.js";
import { drawFort, drawRestricted, drawProtected, drawWonder, drawPlaque } from "../../render/art/sites.js";
import { visibleSites, siteSize, hitSites } from "./model.js";
import { POP_SCALE } from "../../render/art/city.js";
import { REF_KM } from "../../render/art/lod.js";
import { esc } from "../../format.js";

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const inVp = (it, vp, padKm) => it.x > vp.x0 - padKm && it.x < vp.x1 + padKm && it.y > vp.y0 - padKm && it.y < vp.y1 + padKm;

/** Draw a list of sites with their painter (world transform, sizes from css px). */
function drawSites(ctx, vp, o, list, paint) {
  const s = vp.s;
  const pad = 90 / s;
  for (const it of list) {
    if (!inVp(it, vp, pad)) continue;
    const size = siteSize(it, o.Rpx) / s;
    if (it.dim) ctx.globalAlpha = 0.5;
    paint(it, size);
    ctx.globalAlpha = 1;
  }
}

export function makeLayers(model, on, { tips = {}, app = null } = {}) {
  const m = model;
  // A site moved off its city tile says so under its tooltip (the numbers are always the true site's).
  const moved = (it, html) => {
    if (!html || !it.nudged || typeof html !== "string") return html;
    const city = m.w.cityByCell.get(it.cell);
    const where = city ? `la casilla de la ciudad de ${esc(city.name)}` : "la casilla de una ciudad";
    return `${html}<br><span class="muted">Dibujado en una casilla vecina para que se vea; su posición real cae en ${where}.</span>`;
  };
  const ver = () => `v${m.version}`;
  const grid = () => m.w.grid;
  // Zoom floors below are Gpx (css px per REF_KM of map, see render/art/lod.js); layers compare them with Rpx.
  const geo = m.w.grid.R / REF_KM;
  // While a lens colours the map, roads and rail fade so the data stays readable.
  const lensAlpha = (o) => (o.lens ? 0.55 : 1);

  const roads = {
    id: "roads", z: 55, minRpx: ROAD_MIN_RPX * geo,
    visible: () => !!on.roads && !!m.net,
    sig: ver,
    draw(ctx, vp, w, o) {
      ctx.globalAlpha = lensAlpha(o);
      drawRoads(ctx, m.net, vp, o);
    },
  };
  const rail = {
    id: "rail", z: 56, minRpx: ROAD_MIN_RPX * geo,
    visible: () => !!on.rail && !!m.net,
    sig: ver,
    draw(ctx, vp, w, o) {
      ctx.globalAlpha = lensAlpha(o);
      drawRail(ctx, m.net, vp, o);
    },
  };
  const protectedLand = {
    id: "protected", z: 57, minRpx: 3 * geo,
    visible: () => !!on.wonders && m.parks.length > 0,
    sig: ver,
    draw(ctx, vp, w, o) {
      if (o.lens) return; // a lens owns the hex colours
      drawProtected(ctx, m.parks, vp, o);
    },
  };
  const restricted = {
    id: "restricted", z: 58, minRpx: 3 * geo,
    visible: () => !!on.military && m.ranges.length > 0,
    sig: ver,
    draw(ctx, vp, w, o) {
      drawRestricted(ctx, m.ranges, vp, o);
    },
    hit(x, y, Rpx) {
      const cell = grid().cellAt(x, y);
      if (cell < 0) return null;
      // forts on top get their own hit first (higher z); here, the range whose hexes hold the pointer
      for (const r of m.ranges) if (r.cells.has(cell)) return { kind: "range", data: r.range };
      return null;
    },
    tooltip: (it) => tips.range?.(it.data, m) ?? null,
  };
  const hubs = {
    id: "hubs", z: 65, minRpx: 3 * geo,
    visible: () => !!on.hubs && (m.ports.length > 0 || m.airports.length > 0),
    sig: ver,
    list: (Rpx) => visibleSites(m, "hubs", [...m.ports, ...m.airports], Rpx),
    draw(ctx, vp, w, o) {
      drawSites(ctx, vp, o, hubs.list(o.Rpx), (it, size) => {
        if (it.kind === "port") drawPort(ctx, it.x, it.y, size, { tier: it.tier, type: it.data.type });
        else drawAirport(ctx, it.x, it.y, size, { tier: it.tier });
      });
    },
    warm(ctx, vp, w, o) { hubs.draw(ctx, vp, w, o); },
    hit: (x, y, Rpx) => hitSites(hubs.list(Rpx), x, y, Rpx, grid()),
    tooltip: (it) => moved(it, (it.kind === "port" ? tips.port?.(it.data, m) : tips.airport?.(it.data, m)) ?? null),
  };
  const forts = {
    id: "forts", z: 66, minRpx: 8 * geo,
    visible: () => !!on.military && m.installations.length > 0,
    sig: ver,
    list: (Rpx) => visibleSites(m, "forts", m.installations, Rpx),
    draw(ctx, vp, w, o) {
      drawSites(ctx, vp, o, forts.list(o.Rpx), (it, size) => {
        drawFort(ctx, it.fort, it.x, it.y, size, { tier: it.tier, joint: !!it.data.joint, muted: !!it.muted, coastal: it.coastal, airfield: !!it.airfield });
      });
    },
    warm(ctx, vp, w, o) { forts.draw(ctx, vp, w, o); },
    hit: (x, y, Rpx) => hitSites(forts.list(Rpx), x, y, Rpx, grid()),
    tooltip: (it) => moved(it, tips.fort?.(it.data, m) ?? null),
  };
  const wonders = {
    id: "wonders", z: 67, minRpx: 2.4 * geo,
    visible: () => !!on.wonders && m.wonders.length > 0,
    sig: ver,
    list: (Rpx) => visibleSites(m, "wonders", m.wonders, Rpx),
    draw(ctx, vp, w, o) {
      drawSites(ctx, vp, o, wonders.list(o.Rpx), (it, size) => {
        drawWonder(ctx, it.wkind, it.x, it.y, size, { variant: it.variant, motif: it.motif, rank: it.data.rank });
      });
    },
    warm(ctx, vp, w, o) { wonders.draw(ctx, vp, w, o); },
    hit: (x, y, Rpx) => hitSites(wonders.list(Rpx), x, y, Rpx, grid()),
    tooltip: (it) => moved(it, tips.wonder?.(it.data, m) ?? null),
  };
  const trade = {
    id: "trade", z: 85, minRpx: 2 * geo,
    visible: () => !!on.trade && m.routes.length > 0,
    sig: ver,
    draw(ctx, vp, w, o) {
      drawTradeRoutes(ctx, m.routes, vp, o);
    },
    hit: (x, y, Rpx) => {
      const rt = hitRoute(m.routes, x, y, Rpx / geo, Rpx / grid().R);
      return rt ? { kind: "route", data: rt } : null;
    },
    tooltip: (it) => tips.route?.(it.data, m) ?? null,
  };

  // Caminos de Santiago: one polyline per stretch (a stretch shared by several Caminos is drawn once, in the colour of the
  // first), dark halo under a bright core so it reads over green and brown hexes. Widths in css px.
  const camino = {
    id: "camino", z: 84, minRpx: 1 * geo,
    visible: () => !!on.camino && !!m.camino && m.camino.lines.length > 0,
    sig: ver,
    draw(ctx, vp, w, o) {
      const s = vp.s, pad = 20 / s;
      const wpx = Math.max(1.6, Math.min(4.5, o.Rpx * 0.22));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = o.lens ? 0.85 : 1;
      const shown = m.camino.lines.filter((l) => !(l.bbox[2] < vp.x0 - pad || l.bbox[0] > vp.x1 + pad || l.bbox[3] < vp.y0 - pad || l.bbox[1] > vp.y1 + pad));
      ctx.strokeStyle = "rgba(20,14,8,.65)";
      ctx.lineWidth = (wpx + 2.2) / s;
      for (const l of shown) ctx.stroke(l.path);
      for (const l of shown) {
        ctx.strokeStyle = l.color;
        ctx.lineWidth = wpx / s;
        ctx.stroke(l.path);
      }
      ctx.globalAlpha = 1;
    },
    hit: (x, y, Rpx) => {
      const s = Rpx / grid().R, tol = Math.max(5, Math.min(4.5, Rpx * 0.22) / 2 + 3) / s;
      let best = null, bestD = Infinity;
      for (const l of m.camino?.lines || []) {
        const b = l.bbox;
        if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
        const p = l.pts;
        for (let k = 2; k < p.length; k += 2) {
          const d = segDist(x, y, p[k - 2], p[k - 1], p[k], p[k + 1]);
          if (d < tol && d < bestD) { bestD = d; best = l; }
        }
      }
      return best ? { kind: "camino", data: best, x, y } : null;
    },
    tooltip: (it) => tips.camino?.(it.data, m, it.x, it.y) ?? null,
  };

  // Name plates under the forts (major ones, close in) and wonders, laid out together in one pass (wonders first, by
  // rank), so no two overlap; each keeps clear of where city banners stand and, in the City View, of the hexes that
  // hold a district plaque.
  const cvKey = () => {
    const cv = app?.cityView;
    const city = cv?.city;
    if (!city) return "";
    const mm = cv.model;
    return `${city.id}:${(mm?.placed || []).length}:${(mm?.inCity || []).length}`;
  };
  const plates = {
    id: "plates", z: 68, minRpx: 30 * geo,
    visible: () => (!!on.wonders && m.wonders.length > 0) || (!!on.military && m.installations.length > 0),
    sig: () => `v${m.version}|${on.wonders ? 1 : 0}${on.military ? 1 : 0}|${cvKey()}`,
    draw(ctx, vp, w, o) {
      const list = [];
      if (on.wonders) list.push(...wonders.list(o.Rpx));
      if (on.military && o.Gpx >= 60) list.push(...forts.list(o.Rpx).filter((it) => it.tier === "major"));
      if (list.length) plaques(ctx, vp, o, list);
    },
  };

  // Screen rects (css px) where banner plates stand: a box above each sizeable city tile. Banners are drawn over the
  // static map every frame and depend on hover, so this is a conservative stand-in rather than their exact boxes.
  function bannerRects(o, vp) {
    const out = [];
    const floor = o.Gpx < 40 ? 1e5 * POP_SCALE : o.Gpx < 70 ? 4e4 * POP_SCALE : 0;
    const pad = 2 * m.w.grid.R;
    for (const [cell, city] of m.w.cityByCell) {
      if (!(city.population >= floor)) continue;
      const x = m.w.grid.cx(cell), y = m.w.grid.cy(cell);
      if (x < vp.x0 - pad || x > vp.x1 + pad || y < vp.y0 - pad || y > vp.y1 + pad) continue;
      const [sx, sy] = o.toScreen(x, y);
      const half = Math.min(110, 40 + String(city.name || "").length * 4);
      out.push([sx - half, sy - o.Rpx * 0.75 - (o.Gpx > 24 ? 52 : 30), sx + half, sy - o.Rpx * 0.35]);
    }
    return out;
  }

  function districtCells() {
    const mm = app?.cityView?.city ? app.cityView.model : null;
    const out = new Set();
    if (!mm) return out;
    for (const d of mm.placed || []) if (d && d.cell != null) out.add(d.cell);
    if ((mm.inCity || []).length && mm.city?.cell != null) out.add(mm.city.cell);
    return out;
  }

  // Name plates under the sites (screen space), skipping any that would overlap one already placed or a banner.
  function plaques(ctx, vp, o, list) {
    o.screen();
    const busy = districtCells();
    const placed = bannerRects(o, vp);
    // In the City View, the open metro's hexes carry district plaques, yield chips and site labels (drawn over the
    // map each frame), so no fort or wonder plate may stand on them: the dock lists those sites instead.
    const mm = app?.cityView?.city ? app.cityView.model : null;
    for (const t of mm?.tiles || []) {
      if (t?.x == null || t?.y == null) continue;
      const [hx, hy] = o.toScreen(t.x, t.y);
      placed.push([hx - o.Rpx * 0.95, hy - o.Rpx, hx + o.Rpx * 0.95, hy + o.Rpx * 1.05]);
    }
    const scale = Math.min(1.2, 0.85 + o.Rpx / 200);
    const g = m.w.grid;
    for (const it of list) {
      if (!inVp(it, vp, 0)) continue;
      if (busy.size && (busy.has(it.drawCell) || busy.has(g.cellAt(it.x, it.y)))) continue;
      const [sx, sy] = o.toScreen(it.x, it.y);
      const size = siteSize(it, o.Rpx);
      const text = it.data.short || it.data.name || "";
      if (!text) continue;
      const kind = it.kind === "fort" ? "fort" : it.wkind;
      const y = sy + size * 0.42;
      const box = drawPlaque(ctx, text, sx, y, { kind, scale, measureOnly: true });
      if (placed.some((p) => box[0] < p[2] && p[0] < box[2] && box[1] < p[3] && p[1] < box[3])) continue;
      placed.push(box);
      drawPlaque(ctx, text, sx, y, { kind, scale });
    }
    o.world();
  }

  return [roads, rail, protectedLand, restricted, hubs, forts, wonders, plates, camino, trade];
}
