// Cell colours for the 3D view, in sRGB [r, g, b] (0..255). Pure functions: no DOM, no Three.js. They take a terrain
// (terrain.js), either mesh.
// "Altitud", the default, is a hypsometric ramp over each cell's own altitude, with the sea apart.
// "Suelo" imitates a satellite picture. Normal mesh: the land-cover fractions of world.json (pct), which have no
// bare-rock class, so rock is a drawing convention from altitude and relief (said in the legend). Fine mesh: the
// WorldCover class of each cell, where bare ground is data.
import { parseHex, mix, shade, desaturate, rampColor } from "../../color.js";
import { lensScale } from "../../world.js";

// Colour tokens of the scene.
export const SOIL = {
  forest: parseHex("#2f4a27"),
  crop: parseHex("#a2915a"),
  pasture: parseHex("#6a833d"),
  grass: parseHex("#848a4b"),
  shrub: parseHex("#7a6840"),
  wetland: parseHex("#456252"),
  developed: parseHex("#b3aaa0"),
  mountain: parseHex("#8c774b"), // upland grass and heath, replaces the lowland greens with altitude
  rock: parseHex("#938a80"),
  lake: parseHex("#2a6688"),
  unknown: parseHex("#6f7248"),
  snow: parseHex("#e3e8ea"),
};
// WorldCover land classes of the fine mesh -> soil token.
export const CLASS_SOIL = {
  10: "forest", 20: "shrub", 30: "pasture", 40: "crop", 50: "developed", 60: "rock", 70: "snow", 90: "wetland",
  95: "wetland", 100: "grass",
};
export const SEA = {
  stops: [[0, parseHex("#2c6a80")], [60, parseHex("#1e5271")], [200, parseHex("#153d5d")], [1200, parseHex("#0f2c49")],
    [3000, parseHex("#0b2139")]],
  far: parseHex("#0b2139"), // the backdrop beyond the grid
};
export const SKY = { haze: "#86a6c6", low: "#4d78ab", space: "#081120" };
export const NO_DATA = parseHex("#77726a");
// Hypsometric tints, [metres, colour]: valley green, ochre, grey summit. The highest Galician cell is about 2 000 m.
export const ALTITUDE_STOPS = [
  [0, "#2f6b45"], [200, "#4f8a4a"], [400, "#85a650"], [600, "#bdb65c"], [850, "#cf9c4c"], [1150, "#a9713f"],
  [1450, "#8a786b"], [1700, "#a7a29d"], [2000, "#dedbd7"],
];
export const ALTITUDE_TOP = ALTITUDE_STOPS[ALTITUDE_STOPS.length - 1][0];
const ALTITUDE_RGB = ALTITUDE_STOPS.map(([m, c]) => [m, parseHex(c)]);
const FOREIGN_STOPS = [[0, parseHex("#586a49")], [500, parseHex("#6b6b46")], [1000, parseHex("#7b6b4d")],
  [1600, parseHex("#8b8173")], [2300, parseHex("#b5afa5")]];
const FOREIGN_TINT = parseHex("#27384c");
const FOREIGN = -2;
const EDGE_FADE_KM = 28; // non-Galician cells sink into the backdrop over this band along the grid edge
const PCT_KEYS = ["forest", "crop", "pasture", "grass", "shrub", "wetland", "developed"];
const COVER_KEY = { 1: "forest", 2: "forest", 3: "forest", 4: "shrub", 5: "grass", 6: "pasture", 7: "crop", 8: "wetland", 9: "developed" };

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function interpolate(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    const [v1, c1] = stops[k];
    if (v <= v1) {
      const [v0, c0] = stops[k - 1];
      return mix(c0, c1, (v - v0) / (v1 - v0));
    }
  }
  return stops[stops.length - 1][1];
}

// Deterministic per-cell grain, so wide stretches of one cover do not read as flat paint.
const grain = (i) => {
  let h = Math.imul(i ^ 0x5bd1e995, 1274126177);
  h = Math.imul(h ^ (h >>> 15), 668265263);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 - 0.5;
};

/** 0 at the grid edge, 1 from EDGE_FADE_KM inwards. */
export function edgeFactor(grid, i) {
  const x = grid.cx(i), y = grid.cy(i);
  const d = Math.min(x, grid.W * (grid.cols - 0.5) - x, y, grid.H * (grid.rows - 1) - y);
  return smooth(0, EDGE_FADE_KM, d);
}

function seaColor(T, i) {
  if (T.water[i] === 3) return SOIL.lake;
  return interpolate(SEA.stops, Math.max(0, -T.elev[i]));
}

const UPLAND = new Set(["pasture", "grass", "shrub"]);
/** A soil token at an altitude: upland grass and heath turn brown. */
const tone = (key, high) => (UPLAND.has(key) ? mix(SOIL[key], SOIL.mountain, high) : SOIL[key] || SOIL.unknown);

function mixedSoil(T, i) {
  const elev = T.elev[i];
  const high = smooth(550, 1350, elev);
  let r = 0, g = 0, b = 0, total = 0;
  for (const key of PCT_KEYS) {
    // Built-up land is a small share of any large hex: weigh it up so towns can be seen.
    const share = (T.pct?.[key]?.[i] || 0) * (key === "developed" ? 2.4 : 1);
    if (!share) continue;
    const c = tone(key, high);
    r += c[0] * share; g += c[1] * share; b += c[2] * share; total += share;
  }
  let c = total > 0 ? [r / total, g / total, b / total] : tone(COVER_KEY[T.cover[i]] || "unknown", high);
  const forest = (T.pct?.forest?.[i] || 0) / 100;
  const rocky = smooth(1100, 1850, elev) * (T.relief?.[i] >= 3 ? 0.75 : 0.45) * (1 - 0.6 * forest);
  if (rocky > 0) c = mix(c, SOIL.rock, rocky);
  return shade(c, grain(i) * 0.1);
}

function classSoil(T, i) {
  const c = tone(CLASS_SOIL[T.cover[i]] || "unknown", smooth(550, 1350, T.elev[i]));
  return shade(c, grain(i) * 0.14);
}

function foreignColor(T, i) {
  const c = interpolate(FOREIGN_STOPS, T.elev[i]);
  return mix(shade(desaturate(c, 0.3), -0.2 + grain(i) * 0.08), FOREIGN_TINT, 0.18);
}

export const altitudeColor = (metres) => interpolate(ALTITUDE_RGB, metres);

/** Colour of every cell by its altitude. No grain, so a flat top reads exactly as in the legend. */
export function altitudeColors(T) {
  const out = new Array(T.n);
  for (let i = 0; i < out.length; i++) {
    let c;
    if (T.water[i]) c = seaColor(T, i);
    else {
      c = altitudeColor(T.elev[i]);
      if (!(T.owner[i] >= 0)) c = mix(shade(desaturate(c, 0.6), -0.3), FOREIGN_TINT, 0.2);
    }
    if (!(T.owner[i] >= 0)) c = mix(SEA.far, c, edgeFactor(T.grid, i));
    out[i] = c;
  }
  return out;
}

/** Satellite-like colour of every cell. */
export function soilColors(T) {
  const soil = T.pct ? mixedSoil : classSoil;
  const out = new Array(T.n);
  for (let i = 0; i < out.length; i++) {
    let c;
    if (T.water[i]) c = seaColor(T, i);
    else if (T.owner[i] >= 0) c = soil(T, i);
    else c = foreignColor(T, i);
    if (!(T.owner[i] >= 0)) c = mix(SEA.far, c, edgeFactor(T.grid, i));
    out[i] = c;
  }
  return out;
}

/**
 * Lens colour of the Galician cells (each takes the value of its game cell); sea and neighbours stay as context, a
 * step further back than in "Suelo".
 */
export function lensColors(T, lens, soil = soilColors(T)) {
  const stops = lens.ramp.map(parseHex);
  const t = lensScale(lens);
  return soil.map((base, i) => {
    if (!(T.owner[i] >= 0)) {
      return T.owner[i] === FOREIGN && !T.water[i] ? mix(desaturate(base, 0.75), SEA.far, 0.18) : base;
    }
    const v = lens.values[T.game[i]];
    if (v == null) return NO_DATA;
    const tv = t(v);
    return Number.isFinite(tv) ? rampColor(stops, tv) : NO_DATA;
  });
}

export const isLandOfGalicia = (T, i) => T.owner[i] >= 0 && !T.water[i];

/**
 * Shading of the flat top faces from the slope to the neighbouring cells (a flat prism top gets the same light
 * whatever the hillside does). Returns k per cell for color.js shade(): negative on slopes away from a north-west sun.
 * The slope uses the on-screen exaggeration, limited so that ×1 still reads and ×30 does not go black.
 */
export function slopeShade(T, exaggeration, sun) {
  const { grid, water, elev } = T;
  // Real slopes are far steeper from one 0.5 km cell to the next than across the large ones: ease them on fine meshes.
  const e = Math.min(14, Math.max(4, exaggeration)) * Math.min(1, 0.25 + grid.R * 0.3);
  const out = new Float32Array(grid.size);
  // The sea counts as 0 m; a lake has no height in the data, so it counts as level with the cell looking at it.
  const z = (j, fallback) => (j < 0 || water[j] === 3 ? fallback : water[j] ? 0 : Math.max(0, elev[j]));
  for (let i = 0; i < grid.size; i++) {
    if (water[i]) continue;
    const h = Math.max(0, elev[i]);
    const east = z(grid.neighbour(i, 0), h), west = z(grid.neighbour(i, 3), h);
    const north = (z(grid.neighbour(i, 4), h) + z(grid.neighbour(i, 5), h)) / 2;
    const south = (z(grid.neighbour(i, 1), h) + z(grid.neighbour(i, 2), h)) / 2;
    const dx = ((east - west) / (2 * grid.W)) * (e / 1000); // rise per run, eastwards
    const dz = ((south - north) / (3 * grid.R)) * (e / 1000); // southwards
    const light = (-dx * sun[0] + sun[1] - dz * sun[2]) / Math.hypot(dx, 1, dz);
    out[i] = Math.max(-0.45, Math.min(0.28, (light - sun[1]) * 0.8));
  }
  return out;
}
