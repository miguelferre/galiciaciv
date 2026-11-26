// The two meshes the view can draw, in one shape:
//   normal  the game grid of world.json (whatever its radius)
//   alto    the fine mesh of web/data/relief3d_detalle.bin (tools/prep_relief3d.py), only for this view
// A terrain is {id, grid, n, elev, elevMax, water, owner, game, cover, pct, relief, rivers}:
//   elev   m (land altitude, sea depth <= 0, lake surface)      water  0 land, 1/2 sea, 3 lake
//   owner  >= 0 Galician (comarca), -1 water, -2 foreign land   game   game cell that gives lens values and concello
import { makeGrid } from "../../hex.js";

export const DETAIL_URL = new URL("../../../data/relief3d_detalle.bin", import.meta.url);
const NONE = 65535;
const WATER = -1;
const FOREIGN = -2;
const SEA_COVER = 80;
const LAKE_COVER = 81;
const SEARCH_KM = 10; // how far a shore or island cell looks for the game cell that owns it (illa de Sálvora: 6 km)

export function normalTerrain(w) {
  const n = w.grid.size;
  return {
    id: "normal", grid: w.grid, n, elev: w.raw.elev, elevMax: w.raw.elev_max, water: w.water, owner: w.raw.owner,
    game: Int32Array.from({ length: n }, (_, i) => i), cover: w.cover, pct: w.pct, relief: w.relief,
    rivers: w.raw.rivers || [],
  };
}

/** The header and arrays of a relief3d_detalle.bin. */
export function parseDetail(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "R3D1") throw new Error("el fichero de detalle no tiene el formato esperado");
  const length = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
  const n = header.count;
  let at = 8 + length;
  if (buffer.byteLength !== at + n * 5) throw new Error("el fichero de detalle está incompleto");
  const elev = new Int16Array(buffer, at, n);
  at += n * 2;
  const parent = new Uint16Array(buffer, at, n);
  at += n * 2;
  const cover = new Uint8Array(buffer, at, n);
  return { header, elev, parent, cover };
}

const sameNumbers = (a, b) => Object.keys(a).every((k) => Math.abs(a[k] - b[k]) < 1e-6);

export function detailTerrain(w, buffer) {
  const { header, elev, parent, cover } = parseDetail(buffer);
  const made = header.game;
  // The fine mesh lives in the map km of the world it was made for: another projection or map size moves everything.
  if (!sameNumbers(made.projection, w.raw.projection) || made.width !== w.raw.width || made.height !== w.raw.height) {
    throw new Error("el detalle se generó para otro mapa; hay que repetir tools/prep_relief3d.py");
  }
  const grid = makeGrid(header.grid);
  const n = grid.size;
  // Another game grid (D-004: 2.5 km to 1 km) only changes which game cell holds each fine cell: work it out here.
  const current = sameNumbers(made.grid, w.raw.grid);
  const game = new Int32Array(n);
  const water = new Uint8Array(n);
  const owner = new Int16Array(n);
  const coarse = w.grid, own = w.raw.owner;
  const land = (j) => own[j] !== WATER;
  // Nearest game land cell around cell p (the game coastline is coarse: rías and islands fall in its water cells),
  // within SEARCH_KM whatever the size of the game cells.
  const reach = Math.ceil(SEARCH_KM / coarse.W); // rings of game cells that cover that distance
  const nearest = (p, x, y) => {
    let ring = [p];
    const seen = new Set(ring);
    let best = -1, bestD = SEARCH_KM, first = -1;
    for (let r = 0; r < reach; r++) {
      const next = [];
      for (const c of ring) {
        for (let d = 0; d < 6; d++) {
          const j = coarse.neighbour(c, d);
          if (j < 0 || seen.has(j)) continue;
          seen.add(j);
          next.push(j);
          if (!land(j)) continue;
          const dist = Math.hypot(coarse.cx(j) - x, coarse.cy(j) - y);
          if (dist < bestD) {
            best = j;
            bestD = dist;
          }
        }
      }
      if (best >= 0 && first < 0) first = r;
      if (first >= 0 && r > first) break; // one ring more than the first hit, for a truly nearest centre
      ring = next;
    }
    return best;
  };
  for (let i = 0; i < n; i++) {
    const x = grid.cx(i), y = grid.cy(i);
    let p = current ? (parent[i] === NONE ? -1 : parent[i]) : coarse.cellAt(x, y);
    water[i] = cover[i] === SEA_COVER ? 2 : cover[i] === LAKE_COVER ? 3 : 0;
    if (water[i]) {
      owner[i] = WATER;
      game[i] = p;
      continue;
    }
    if (p < 0 || !land(p)) {
      const j = p < 0 ? -1 : nearest(p, x, y);
      if (j >= 0) p = j;
    }
    game[i] = p;
    owner[i] = p >= 0 && own[p] >= 0 ? own[p] : FOREIGN;
  }
  const rivers = header.rivers?.length ? header.rivers : w.raw.rivers || [];
  return {
    id: "alto", grid, n, elev, elevMax: null, water, owner, game, cover, pct: null, relief: null, rivers,
    header,
  };
}

export async function loadDetail(w, url = DETAIL_URL) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`falta data/relief3d_detalle.bin (HTTP ${r.status})`);
  return detailTerrain(w, await r.arrayBuffer());
}
