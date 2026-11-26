// Rivers of the terrain (OpenStreetMap) draped over the prisms: a flat ribbon on the top of every cell the course
// crosses, joined from one cell to the next by a short ribbon down the wall between them. This file only works out the
// layout (which cell each vertex belongs to, and its offset from that cell's centre); scene.js places the vertices, so
// they follow the exaggeration and the curvature. No DOM, no Three.js.
import { parseHex, mix, shade } from "../../color.js";
import { SEA, edgeFactor } from "./colors.js";

export const RIVER = { galicia: parseHex("#6fd0fa"), outside: parseHex("#46819f") };
// By rank (1 = biggest). The Miño and the Sil (ranks 2 and 3) are wide and bright; the small ones step back.
const WIDTH_KM = { 1: 1.4, 2: 1.35, 3: 1.15, 4: 0.62, 5: 0.42, 6: 0.34 };
const RECEDE = { 4: 0.22, 5: 0.42, 6: 0.42 };
const DEEP = parseHex("#245b7c");
const SAMPLE_KM = 0.2; // how finely the course is walked to find where it changes cell
const OUTSET_KM = 0.07; // a wall ribbon stands this far out of the wall, on the lower side

/**
 * {count, cell: Int32Array, offset: Float32Array [dx, dz]…, colors: number[][] (sRGB), index: number[],
 *  names: Map<cell, string[]>}. `heightOf(i)` is only used to tell which of two cells is the lower one.
 * `widen` scales every width (phones). On a fine mesh all widths shrink so the biggest river spans 0.6 of a cell.
 */
export function layoutRivers(T, heightOf, widen = 1) {
  const { grid, water, owner, rivers = [] } = T;
  const fit = Math.min(1, (0.6 * grid.W) / WIDTH_KM[2]);
  const sample = Math.min(SAMPLE_KM, grid.R * 0.3);
  const cells = [], offsets = [], colors = [], index = [], names = new Map();
  let recede = 0; // of the river being laid out
  const colour = (i) => (owner[i] >= 0 ? mix(RIVER.galicia, DEEP, recede)
    : mix(SEA.far, mix(RIVER.outside, DEEP, recede), edgeFactor(grid, i)));
  const vertex = (i, x, z, dark = 0) => {
    cells.push(i);
    offsets.push(x - grid.cx(i), z - grid.cy(i));
    colors.push(dark ? shade(colour(i), -dark) : colour(i));
    return cells.length - 1;
  };
  const quad = (a, b, c, d) => index.push(a, b, c, a, c, d);
  const land = (i) => i >= 0 && !water[i];

  // The part of a course inside one cell: a mitred strip along its points.
  function strip(i, pts, hw, name) {
    if (!land(i) || pts.length < 2) return;
    let known = names.get(i);
    if (!known) names.set(i, (known = []));
    if (name && !known.includes(name)) known.push(name);
    const dir = (k) => {
      const dx = pts[k + 1][0] - pts[k][0], dz = pts[k + 1][1] - pts[k][1], len = Math.hypot(dx, dz) || 1;
      return [dx / len, dz / len];
    };
    let prev = null;
    for (let k = 0; k < pts.length; k++) {
      const out = dir(Math.min(k, pts.length - 2)), into = dir(Math.max(0, k - 1));
      let tx = into[0] + out[0], tz = into[1] + out[1];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const m = hw / Math.max(0.6, tx * out[0] + tz * out[1]);
      const left = vertex(i, pts[k][0] - tz * m, pts[k][1] + tx * m);
      const right = vertex(i, pts[k][0] + tz * m, pts[k][1] - tx * m);
      if (prev) quad(prev[0], prev[1], right, left);
      prev = [left, right];
    }
  }

  // Where the course passes from cell a to cell b at point p: a ribbon from one top to the other, in the wall's plane.
  function wall(a, b, p, hw) {
    if (a < 0 || b < 0 || (!land(a) && !land(b))) return;
    let mx = grid.cx(b) - grid.cx(a), mz = grid.cy(b) - grid.cy(a);
    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;
    const side = heightOf(b) < heightOf(a) ? OUTSET_KM : -OUTSET_KM;
    const x = p[0] + mx * side, z = p[1] + mz * side;
    const ex = -mz * hw, ez = mx * hw; // along the shared edge
    const colourOf = land(a) ? a : b; // a mouth keeps the river's colour down to the sea
    const make = (i, sx, sz) => {
      const v = vertex(i, sx, sz, 0.22);
      if (i !== colourOf) colors[v] = shade(colour(colourOf), -0.22);
      return v;
    };
    quad(make(a, x + ex, z + ez), make(a, x - ex, z - ez), make(b, x - ex, z - ez), make(b, x + ex, z + ez));
  }

  for (const river of rivers) {
    const p = river.pts;
    if (!p || p.length < 4) continue;
    const hw = (Math.max(0.15, (WIDTH_KM[river.rank] ?? 0.34) * fit) * widen) / 2;
    recede = RECEDE[river.rank] ?? 0;
    let cell = grid.cellAt(p[0], p[1]);
    let run = [[p[0], p[1]]];
    let last = run[0];
    for (let k = 2; k < p.length; k += 2) {
      const from = [p[k - 2], p[k - 1]], to = [p[k], p[k + 1]];
      const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / sample));
      for (let s = 1; s <= steps; s++) {
        const q = s === steps ? to : [from[0] + ((to[0] - from[0]) * s) / steps, from[1] + ((to[1] - from[1]) * s) / steps];
        const next = grid.cellAt(q[0], q[1]);
        if (next !== cell) {
          // Narrow down the crossing point between the last sample and this one.
          let lo = last, hi = q;
          for (let it = 0; it < 10; it++) {
            const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
            if (grid.cellAt(mid[0], mid[1]) === cell) lo = mid;
            else hi = mid;
          }
          const edge = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
          run.push(edge);
          strip(cell, run, hw, river.name);
          wall(cell, next, edge, hw);
          cell = next;
          run = [edge];
        }
        last = q;
      }
      run.push(to); // keep the course's own corners
    }
    strip(cell, run, hw, river.name);
  }

  return {
    count: cells.length, cell: Int32Array.from(cells), offset: Float32Array.from(offsets), colors, index, names,
  };
}
