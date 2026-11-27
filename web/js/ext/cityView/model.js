// City View data model: everything the city screen and its map layer show, derived from cities.json,
// nation.json, lenses.json, world.json and resources.json. Pure functions over app.data / app.w (no DOM).
// A city here is one concello, so its footprint is every hex of that concello.
import { stateIndex } from "../../world.js";
import { t } from "../../i18n.js";

// The four sectors of `jobs` (IGE affiliations) → label, medallion colour and icon id (icons.js).
export const SECTOR = {
  agricultura: { label: t("Agricultura y pesca"), color: "#4f7a2a", icon: "i-agriculture" },
  industria: { label: t("Industria"), color: "#9a5a22", icon: "i-manufacturing" },
  construccion: { label: t("Construcción"), color: "#8a5426", icon: "i-construction" },
  servicios: { label: t("Servicios"), color: "#2b4f8a", icon: "i-other" },
};

// Land-use groups shown as a hex's "tile yield" (world.json pct keys → group). Cover ids give the map colour.
export const LAND = [
  { key: "built", label: t("Urbanizado"), icon: "l-developed", cover: 9, keys: ["developed"] },
  { key: "farm", label: t("Cultivo y pasto"), icon: "l-farmland", cover: 7, keys: ["crop", "pasture"] },
  { key: "forest", label: t("Bosque"), icon: "l-forest", cover: 3, keys: ["forest"] },
  { key: "open", label: t("Terreno abierto"), icon: null, cover: 4, keys: ["grass", "shrub", "wetland"] },
];

const sum = (o) => Object.values(o || {}).reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
const HEX_AREA = (R) => (3 * Math.sqrt(3) / 2) * R * R; // km² of one hex

/** Sectors by affiliated residents (IGE) with location quotients vs Galicia. */
export function jobSectors(city, nation) {
  const n = nation.nation;
  const total = city.employed || sum(city.jobs) || 1;
  const nTotal = n.employed || sum(n.jobs) || 1;
  return Object.entries(city.jobs || {})
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([key, jobs]) => {
      const share = jobs / total;
      const natShare = (n.jobs?.[key] || 0) / nTotal;
      return {
        key, jobs, share, natShare, lq: natShare > 0 ? share / natShare : null,
        label: SECTOR[key]?.label || nation.industries?.[key] || key,
        color: SECTOR[key]?.color || "#3a4a5e", icon: SECTOR[key]?.icon || "i-other",
      };
    })
    .sort((a, b) => b.jobs - a.jobs);
}

function landOf(w, cell) {
  if (!w.pct) return null;
  let best = null, tot = 0;
  for (const g of LAND) {
    const v = g.keys.reduce((a, k) => a + (w.pct[k]?.[cell] || 0), 0);
    tot += v;
    if (!best || v > best.share) best = { ...g, share: v };
  }
  if (!best || tot <= 0) return null;
  return { ...best, share: best.share / 100 };
}

/**
 * Everything the City View shows for one city.
 * Per footprint hex: estimated residents (lens "density" value × hex area: the concello's population shared out by
 * land area, not a count) and the dominant land-use group with its share of the hex's land.
 */
export function buildModel(app, city) {
  const { w } = app;
  const { nation, cities, resources, lenses } = app.data;
  const grid = w.grid;
  const N = cities.length;
  const owner = w.raw.owner;
  const stateIdx = city.cell != null ? owner[city.cell] : -1;
  const stateRGB = w.stateColor[stateIdx] || [201, 164, 92];

  const footprint = (Array.isArray(city.footprint) && city.footprint.length ? city.footprint : [city.cell])
    .filter((c) => c != null && c >= 0);
  const mask = new Set(footprint);

  // Resource sites of the city (resources.json items tagged with this concello code), biggest first per type.
  const items = resources?.items || [];
  const typeById = new Map((resources?.types || []).map((ty) => [ty.id, ty]));
  const sites = [];
  items.forEach((it, index) => {
    if (it.cbsa === city.id) sites.push({ item: it, index, type: typeById.get(it.type) || null });
  });
  const catRank = { energy: 0, mineral: 1, agri: 2 };
  sites.sort((a, b) => (catRank[a.type?.category] ?? 3) - (catRank[b.type?.category] ?? 3)
    || (b.item.value ?? 0) - (a.item.value ?? 0));
  const siteCells = new Map(); // cell -> [site]
  for (const s of sites) {
    if (s.item.cell == null) continue;
    if (!siteCells.has(s.item.cell)) siteCells.set(s.item.cell, []);
    siteCells.get(s.item.cell).push(s);
  }

  // Per-hex tile yields.
  const density = lenses?.lenses?.find((l) => l.id === "density");
  const area = HEX_AREA(grid.R);
  const tiles = footprint.map((cell) => {
    const d = density?.values?.[cell];
    return {
      cell, x: grid.cx(cell), y: grid.cy(cell),
      residents: Number.isFinite(d) ? d * area : null,
      built: w.pct?.developed?.[cell] || 0,
      land: landOf(w, cell),
      isCity: cell === city.cell,
    };
  });

  // Sectors (IGE affiliations). The map's districts are the real ones from districts.json (IGE local business units),
  // placed by placeDistricts() once that file arrives; until then there are none.
  const inds = jobSectors(city, nation);
  // District plaques go on footprint hexes near the centre that have no resource site and no other city; the rest
  // sit in a row inside the city's own hex.
  const cx = grid.cx(city.cell), cy = grid.cy(city.cell);
  // The city's banner stands over the hexes just north of it, so those come after the other near hexes.
  const R = grid.R;
  const cost = (c) => {
    const dx = grid.cx(c) - cx, dy = grid.cy(c) - cy;
    return Math.hypot(dx, dy) + (dy < -0.5 * R && dy > -4.5 * R && Math.abs(dx) < 4 * R ? 4 * R : 0);
  };
  const free = footprint
    .filter((c) => c !== city.cell && !siteCells.has(c) && !w.cityByCell.has(c))
    .sort((a, b) => cost(a) - cost(b) || a - b);

  // Bounding box of the footprint (km).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of footprint) {
    const x = grid.cx(c), y = grid.cy(c);
    x0 = Math.min(x0, x - grid.R); x1 = Math.max(x1, x + grid.R);
    y0 = Math.min(y0, y - grid.R); y1 = Math.max(y1, y + grid.R);
  }

  const peers = (city.peers || []).map((id) => app.cityById.get(id)).filter(Boolean);
  // city.states holds comarca fips codes.
  const states = (city.states || []).map((ref) => {
    const i = stateIndex(w, ref);
    return { ref, index: i, name: i >= 0 ? w.raw.states[i].name : String(ref) };
  });
  const comarcaOf = (c) => (c.states || []).map((ref) => w.raw.states[stateIndex(w, ref)]?.name).filter(Boolean).join(", ");
  const residentsSum = tiles.reduce((a, tl) => a + (tl.residents || 0), 0);

  return {
    city, N, nation, stateIdx, hexArea: area, stateRGB, states, comarcaOf, footprint, mask, tiles, residentsSum,
    sites, siteCells, inds, free, districts: [], placed: [], inCity: [],
    bbox: Number.isFinite(x0) ? { x0, y0, x1, y1 } : null,
    peers,
  };
}

// District plaques stand at least this many hexes apart (centre to centre), from each other and from the city's hex.
const PLAQUE_GAP_HEXES = 3;

/**
 * Put the city's districts on the map (schematic positions): each on the free footprint hex nearest the city that is
 * a few hexes away from the city and from the other plaques; those with no such hex go in a row inside the city's own
 * hex. list = [{id, short, mapLq, color, icon, …}] (districts.js cityDistricts). Sets m.districts, m.placed and
 * m.inCity; the map layer reads them on its next frame. grid = the world's hex grid.
 */
export function placeDistricts(m, list, grid) {
  const ds = (list || []).map((d) => ({ ...d, lq: d.mapLq ?? null }));
  const gap = PLAQUE_GAP_HEXES * Math.sqrt(3) * grid.R - 0.01;
  const far = (a, b) => Math.hypot(grid.cx(a) - grid.cx(b), grid.cy(a) - grid.cy(b)) >= gap;
  const taken = [m.city.cell];
  m.districts = ds;
  m.placed = [];
  m.inCity = [];
  for (const d of ds) {
    const cell = m.free.find((c) => taken.every((k) => far(c, k)));
    if (cell == null) m.inCity.push(d);
    else {
      taken.push(cell);
      m.placed.push({ ...d, cell });
    }
  }
}

/** How many cities have a non-null rank for this key (the "of N"). */
export function rankCount(cities, key) {
  let n = 0;
  for (const c of cities) if (c.ranks?.[key] != null) n++;
  return n;
}

/** A resource value with its unit, short ("37 aerogeneradores", "15 explotaciones", "83,4 M €"). */
export function resourceValue(item, type, compact) {
  const v = item.value;
  if (!Number.isFinite(v)) return "";
  const u = type?.unit || "";
  // The unit text comes translated from resources.json, so the singular is chosen by the type, not by the text.
  const one = v === 1 && type ? (type.id === "eolico" ? t("aerogenerador") : type.category === "mineral" ? t("explotación") : null) : null;
  return `${compact(v)} ${one || u}`.trim();
}
