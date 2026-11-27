// The map-art model: turns the optional map-layer files (infrastructure, military, wonders, trade) into what the layers
// draw, once per data arrival, and decides where each site stands inside its hex so sites never sit on a city tile
// or on each other.
//
//   createModel(w) → model; model.setData(name, data) (re-runs the placement); model.version (bumps on change)
//   model fields: net, ports, airports, installations, ranges (cell sets), parks (cell sets), wonders, routes, data
//   each site item: {kind, data, cell, x, y (km, where it is drawn), size(Rpx) → css px, minRpx, prio}
//   visibleSites(model, layerId, Rpx) → items drawn at this zoom (decluttered, cached per zoom bucket)
//   wonderMotif(wonder) → the sprite motif for a wonders.json row (WONDER_MOTIF_BY_ID, else a generic one by kind)
//
// Sites whose true hex is a city tile (or a big metro's spill tile, or the hexes its banner covers) are drawn on the
// nearest free hex one ring out, leaning toward their true point; item.cell stays the true hex and item.drawCell is
// where the glyph stands (item.nudged = true). Tooltips always describe the true site.
import { prepareNetwork, prepareRoutes, portTier, airportTier } from "../../render/art/improvements.js";
import { prepareCellSet, fortKind, isAirfieldName } from "../../render/art/sites.js";
import { metroSpill, POP_SCALE } from "../../render/art/city.js";
import { REF_KM } from "../../render/art/lod.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * What each wonder looks like: wonders.json names a motif per wonder (the builder derives it from the kind of
 * monument in its name), a sprite in render/art/sites.js WONDER_MOTIFS; without one drawWonder picks a generic
 * sprite for the kind.
 */
export const WONDER_MOTIF_BY_ID = {};
const UNI_MOTIFS = ["hall", "redhall", "spire"];

export function wonderMotif(x) {
  const m = x?.motif || WONDER_MOTIF_BY_ID[x?.id];
  if (m) return m;
  if (x?.kind === "university") return UNI_MOTIFS[hashStr(x.id) % 3];
  return null; // drawWonder falls back to a generic motif by kind and variant
}

// Slots inside a hex, in hex radii from the centre: the centre (only when the hex has no city and no resource), then
// a ring, preferring the lower half (city banners stand above the city tile).
// In a city hex the ring sits further out (0.64 R) so sites flank the city tile rather than cover it.
const ring = (r) => [90, 30, 150, 330, 210, 270].map((deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), deg]);
const RING = ring(0.52), CITY_RING = ring(0.64);

// Zoom rules (minRpx here is Gpx: css px per REF_KM of map; each item stores it converted to the grid's Rpx) and sizes
// (css px, from the hex radius), per site kind. Exported for the gallery and the docs.
export const SITE_RULES = {
  port: {
    // few ports and airports in Galicia: the biggest show from the whole-map view, even on a phone
    minRpx: () => 3,
    size: (tier, Rpx) => clamp(Rpx * [1.0, 0.86, 0.72][tier], 13, [66, 58, 50][tier]),
  },
  airport: {
    minRpx: (tier) => [3, 3, 7, 36, 36][tier],
    size: (tier, Rpx) => clamp(Rpx * [1.0, 0.86, 0.72, 0.62, 0.62][tier], 12, [62, 54, 46, 40, 40][tier]),
  },
  fort: {
    minRpx: (f) => (f.tier === "major" ? 8 : f.tier === "base" ? 22 : 40),
    size: (tier, Rpx) => clamp(Rpx * (tier === "major" ? 1.0 : tier === "base" ? 0.8 : 0.62), 12, tier === "major" ? 66 : 52),
  },
  wonder: {
    minRpx: () => 2.4,
    size: (rank, Rpx) => clamp(Rpx * 1.3, rank <= 5 ? 15 : 13, 88),
  },
};

export function createModel(w) {
  const geo = () => w.grid.R / REF_KM;
  const m = {
    w, version: 0, data: {},
    net: null, ports: [], airports: [], installations: [], ranges: [], parks: [], wonders: [], routes: [], camino: null, fp: null,
    rangeById: new Map(),
    _vis: new Map(),
  };
  m.setData = (name, data) => {
    m.data[name] = data || null;
    if (name === "infrastructure") {
      m.net = data ? prepareNetwork(w, data) : null;
      m.ports = (data?.ports || []).filter(okCell(w)).map((p) => ({
        kind: "port", data: p, cell: p.cell, tier: portTier(p), prio: 300 + (p.rank || 99),
        minRpx: SITE_RULES.port.minRpx(p) * geo(), pref: waterAngle(w, p),
      }));
      m.airports = (data?.airports || []).filter(okCell(w)).map((a, k) => {
        const tier = airportTier(a);
        return { kind: "airport", data: a, cell: a.cell, tier, prio: 400 + tier * 1000 + k, minRpx: SITE_RULES.airport.minRpx(tier) * geo(), pref: towards(w, a, 30) };
      });
    } else if (name === "military") {
      m.installations = (data?.installations || []).filter(okCell(w)).map((f, k) => ({
        kind: "fort", data: f, cell: f.cell, tier: f.tier, fort: fortKind(f.component), prio: 200 + k,
        minRpx: SITE_RULES.fort.minRpx(f) * geo(), pref: 150, muted: f.status && f.status !== "act", coastal: nearWater(w, f.cell), airfield: isAirfieldName(f.name),
      }));
      m.ranges = (data?.ranges || []).filter((r) => Array.isArray(r.cells) && r.cells.length).map((r) => ({ range: r, ...prepareCellSet(w, r.cells) }));
      m.rangeById = new Map(m.ranges.map((r) => [r.range.id, r]));
    } else if (name === "wonders") {
      m.wonders = (data?.wonders || []).filter(okCell(w)).map((x, k) => ({
        kind: "wonder", data: x, cell: x.cell, wkind: x.kind, prio: (x.rank || 99) * 4 + k * 0.01, minRpx: SITE_RULES.wonder.minRpx() * geo(),
        pref: 90, variant: hashStr(x.id) % 3, motif: wonderMotif(x),
      }));
      m.parks = (data?.wonders || []).filter((x) => x.kind === "natural" && Array.isArray(x.cells) && x.cells.length > 1)
        .map((x) => ({ wonder: x, ...prepareCellSet(w, x.cells) }));
    } else if (name === "trade") {
      m.routes = data ? prepareRoutes(w, data) : [];
    } else if (name === "camino") {
      m.camino = data ? prepareCamino(data) : null;
    } else if (name === "fp") {
      m.fp = data ? prepareFp(data) : null;
    }
    place(m);
    m._vis.clear();
    m.version++;
  };
  return m;
}

/** fp.json → {centres, pie, families: Map(id → name)}: points in map km, the ones to draw last (CIFP) at the end. */
function prepareFp(d) {
  const families = new Map((d.families || []).map((f) => [f.id, f.name]));
  const ok = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);
  const rank = (c) => (c.type === "CIFP" ? 2 : 1);
  const centres = (d.centres || []).filter(ok).map((c) => ({ kind: "fp-centre", data: c, x: c.x, y: c.y })).sort((a, b) => rank(a.data) - rank(b.data));
  const pie = (d.pie || []).filter(ok).map((p) => ({ kind: "fp-pie", data: p, x: p.x, y: p.y }));
  return { centres, pie, families };
}

/** camino.json → {routes: Map(id → route), lines: [{routes, pts, color, path, bbox}], byConcello}. Each line takes the colour of its first route. */
function prepareCamino(data) {
  const routes = new Map((data.routes || []).map((r) => [r.id, r]));
  const lines = [];
  for (const l of data.lines || []) {
    const p = l.pts || [];
    if (p.length < 4) continue;
    const path = new Path2D();
    path.moveTo(p[0], p[1]);
    let x0 = p[0], x1 = p[0], y0 = p[1], y1 = p[1];
    for (let k = 2; k < p.length; k += 2) {
      path.lineTo(p[k], p[k + 1]);
      if (p[k] < x0) x0 = p[k]; else if (p[k] > x1) x1 = p[k];
      if (p[k + 1] < y0) y0 = p[k + 1]; else if (p[k + 1] > y1) y1 = p[k + 1];
    }
    lines.push({ routes: l.routes, pts: p, path, bbox: [x0, y0, x1, y1], color: routes.get(l.routes[0])?.color || "#ffffff" });
  }
  return { routes, lines, byConcello: data.by_concello || {} };
}

const okCell = (w) => (x) => x && Number.isInteger(x.cell) && x.cell >= 0 && x.cell < w.grid.size;

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Preferred direction (deg, y down) toward the site's true position, or `def` when it sits at the centre.
function towards(w, it, def) {
  const { grid } = w;
  if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) return def;
  const dx = it.x - grid.cx(it.cell), dy = it.y - grid.cy(it.cell);
  if (Math.hypot(dx, dy) < 0.2 * grid.R) return def;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// A port leans toward open water: its true point if it is off the centre, else the first water neighbour.
function waterAngle(w, p) {
  const a = towards(w, p, null);
  if (a != null) return a;
  for (let d = 0; d < 6; d++) {
    const j = w.grid.neighbour(p.cell, d);
    if (j >= 0 && w.water?.[j]) return d * 60;
  }
  return 90;
}

function nearWater(w, cell) {
  if (w.water?.[cell]) return true;
  for (let d = 0; d < 6; d++) {
    const j = w.grid.neighbour(cell, d);
    if (j >= 0 && w.water?.[j]) return true;
  }
  return false;
}

const angDist = (a, b) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

// Hexes a site should not stand on: city tiles, big metros' spill tiles, and the ground above a sizeable city where
// its banner plate sits (banners are drawn over the map every frame, so a site there would be hidden).
// Only the seven biggest cities: Galician cities sit close, and blocking every town's banner pushes sites far away.
const BANNER_POP = 5e5 * POP_SCALE;
function blockedCells(w) {
  const out = new Set(w.cityByCell.keys());
  try { for (const c of metroSpill(w).keys()) out.add(c); } catch { /* no spill art: city tiles only */ }
  for (const [cell, city] of w.cityByCell) {
    if (!(city.population >= BANNER_POP)) continue;
    // the plate has a size on screen, so the ground it hides is measured in km (REF_KM), not in hexes
    const { grid } = w, x = grid.cx(cell), y = grid.cy(cell);
    for (let j = 0; j < grid.size; j++) {
      const dy = grid.cy(j) - y;
      if (dy <= -0.8 * REF_KM && dy >= -2.2 * REF_KM && Math.abs(grid.cx(j) - x) <= 1.75 * REF_KM) out.add(j);
    }
  }
  return out;
}

// City banners are much wider than a hex, and a banner takes the pointer over a site under it. True when (x, y) km
// falls in the box above a sizeable city where its banner stands at the zoom sites are read (Gpx ~45).
function underBanner(m, x, y) {
  const { grid } = m.w;
  const R = REF_KM;
  for (const [cell, city] of m.w.cityByCell) {
    if (!(city.population >= 1e5 * POP_SCALE)) continue;
    const dx = x - grid.cx(cell), dy = y - grid.cy(cell);
    if (Math.abs(dx) < 3.2 * R && dy < -0.5 * R && dy > -2.4 * R) return true;
  }
  return false;
}

/**
 * The hex to draw a site on: its own, or for a blocked hex the best free one: its own footprint nearby or one ring out,
 * and only when that ring is all taken (a dense metro on a coast) two rings out. A ring is about REF_KM wide, as many
 * hex steps as that takes. Null-safe for sites without x/y.
 */
const WATER_OK = new Set(["coast", "bridge", "dam"]);
function chooseCell(m, it, blocked, load) {
  const { grid } = m.w;
  const hub = it.kind === "port" || it.kind === "airport";
  const hidden = (c) => it.kind !== "fort" && underBanner(m, grid.cx(c), grid.cy(c));
  if (!blocked.has(it.cell) && !hidden(it.cell)) return it.cell;
  const tx = Number.isFinite(it.data.x) ? it.data.x : grid.cx(it.cell);
  const ty = Number.isFinite(it.data.y) ? it.data.y : grid.cy(it.cell);
  const own = new Set(Array.isArray(it.data.cells) ? it.data.cells : []);
  const waterOk = it.kind === "port" || WATER_OK.has(it.motif); // a harbour, a bridge or a lighthouse may stand on water
  const steps = Math.max(1, Math.round(REF_KM / grid.R));
  const grow = (cells) => {
    const out = new Set(cells);
    for (let k = 0; k < steps; k++) {
      for (const c of [...out]) if (c >= 0) for (let d = 0; d < 6; d++) out.add(grid.neighbour(c, d));
    }
    return out;
  };
  const ring1 = grow([it.cell]);
  // a fort or park that spans several hexes may stand anywhere on its own ground nearby
  for (const c of own) if (Math.hypot(grid.cx(c) - tx, grid.cy(c) - ty) < 2.6 * REF_KM) ring1.add(c);
  const pick = (cand, extra) => {
    let best = -1, bestS = Infinity;
    for (const c of cand) {
      if (!(c >= 0) || c === it.cell || blocked.has(c)) continue;
      if (m.w.water?.[c] && !waterOk) continue;
      const sc = Math.hypot(grid.cx(c) - tx, grid.cy(c) - ty) / REF_KM + extra + (load.get(c) || 0) * 0.7 - (own.has(c) ? 0.4 : 0) +
        (m.w.resources?.byCell?.get(c)?.length ? 0.3 : 0) + (underBanner(m, grid.cx(c), grid.cy(c)) ? 2 : 0);
      if (sc < bestS) { bestS = sc; best = c; }
    }
    return best;
  };
  let best = pick(ring1, 0);
  // A port or an airport never goes past the first ring (about 5 km): it stays in its own hex and flanks the city tile.
  if (best < 0 && it.kind !== "port" && it.kind !== "airport") best = pick(grow(ring1), 0.5);
  // A site whose only free hexes are under a banner stays in its own hex, beside the city or its suburbs.
  if (best >= 0 && hidden(best) && !hidden(it.cell)) return it.cell;
  return best >= 0 ? best : it.cell;
}

/** Assign each site a hex (off city tiles) and a slot in it (highest priority first). */
function place(m) {
  const { grid } = m.w;
  const R = grid.R;
  const all = [...m.wonders, ...m.installations, ...m.ports, ...m.airports].sort((a, b) => a.prio - b.prio);
  const res = m.w.resources?.byCell;
  const blocked = blockedCells(m.w);
  const load = new Map(); // drawCell → sites so far
  for (const it of all) {
    it.drawCell = chooseCell(m, it, blocked, load);
    it.nudged = it.drawCell !== it.cell;
    load.set(it.drawCell, (load.get(it.drawCell) || 0) + 1);
  }
  const taken = new Map(); // drawCell → Set(slot index; -1 = centre)
  for (const it of all) {
    const cell = it.drawCell;
    // sites sharing a hex are drawn smaller so each keeps its own slot
    const n = load.get(cell);
    const isCity = m.w.cityByCell.has(cell);
    it.k = Math.min(isCity ? 0.72 : 1, n >= 3 ? 0.6 : n === 2 ? 0.74 : 1);
    let t = taken.get(cell);
    if (!t) taken.set(cell, (t = new Set()));
    const centreFree = !isCity && !(res && res.get(cell)?.length) && !t.has(-1);
    let slot = -1;
    if (!centreFree) {
      // lean toward the true point (for a moved site: toward the city it belongs to)
      let pref = it.nudged ? (Math.atan2(grid.cy(it.cell) - grid.cy(cell), grid.cx(it.cell) - grid.cx(cell)) * 180) / Math.PI : it.pref ?? 90;
      // a port or airport in a city hex stands below the tile (the banner is above), on the side of its true point
      if (isCity && (it.kind === "port" || it.kind === "airport")) pref = it.data.x < grid.cx(cell) ? 150 : 30;
      let best = -1, bestD = Infinity;
      RING.forEach(([, , deg], k) => {
        if (t.has(k)) return;
        const d = angDist(deg, pref) + k * 0.01;
        if (d < bestD) { bestD = d; best = k; }
      });
      slot = best >= 0 ? best : t.size % 6;
    }
    t.add(slot);
    const [ox, oy] = slot < 0 ? [0, 0] : (isCity ? CITY_RING : RING)[slot];
    it.x = grid.cx(cell) + ox * R;
    it.y = grid.cy(cell) + oy * R;
    it.slot = slot;
  }
}

/** Glyph size (css px) of a site at a zoom. */
export function siteSize(it, Rpx) {
  const k = Rpx >= 16 ? it.k ?? 1 : 1; // zoomed out only one site per hex shows anyway
  if (it.kind === "port") return k * SITE_RULES.port.size(it.tier, Rpx);
  if (it.kind === "airport") return k * SITE_RULES.airport.size(it.tier, Rpx);
  if (it.kind === "fort") return k * SITE_RULES.fort.size(it.tier, Rpx);
  return k * SITE_RULES.wonder.size(it.data.rank || 99, Rpx);
}

/**
 * The items of a layer drawn at this zoom: passing their zoom rule, then decluttered greedily by priority (a site is
 * skipped when it would cover more than ~40% of one already kept). Depends only on the zoom (not the viewport), so
 * hit tests agree with what was drawn; cached per 0.25 px bucket.
 */
export function visibleSites(m, layerId, items, Rpx) {
  const b = Math.round(Rpx * 4) / 4;
  const key = `${layerId}|${b}`;
  let out = m._vis.get(key);
  if (out) return out;
  const s = b / m.w.grid.R; // css px per km
  const cand = items.filter((it) => b >= it.minRpx).sort((p, q) => p.prio - q.prio);
  out = [];
  const kept = [];
  for (const it of cand) {
    const r = siteSize(it, b) / 2;
    const x = it.x * s, y = it.y * s;
    let ok = true;
    for (const [kx, ky, kr] of kept) {
      if ((kx - x) ** 2 + (ky - y) ** 2 < ((kr + r) * 0.62) ** 2) { ok = false; break; }
    }
    if (!ok) continue;
    kept.push([x, y, r]);
    out.push(it);
  }
  if (m._vis.size > 400) m._vis.clear();
  m._vis.set(key, out);
  return out;
}

/** The topmost item of `list` under (x, y) km at this zoom, or null. */
export function hitSites(list, x, y, Rpx, grid) {
  const s = Rpx / grid.R;
  for (let k = list.length - 1; k >= 0; k--) {
    const it = list[k];
    const r = (siteSize(it, Rpx) / 2) * 0.85 / s;
    if ((it.x - x) ** 2 + (it.y - y) ** 2 <= r * r) return it;
  }
  return null;
}
