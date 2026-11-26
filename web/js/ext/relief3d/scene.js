// The Three.js scene of the relief view. Units are km; X = east, Z = south, Y = up; the map is centred on the origin.
// One InstancedMesh holds every cell of the active terrain (instance id = cell index): land prisms as tall as elev ×
// exaggeration, sea cells flat at 0 m (depth shows only in the colour). A second mesh drapes the rivers over the tops
// (rivers.js). Built for 100 000 cells: each instance matrix only places and leans its prism, the height is one float per
// cell applied in the vertex shader (so a new exaggeration uploads little), and the pointer is found by walking the ray
// over the hex grid instead of testing every instance. A backdrop disc continues the sea to the horizon. Optional
// curvature bends both into a sphere much smaller than the Earth, so the horizon shows in an oblique view.
// Frames are drawn on demand only.
import * as THREE from "../../../vendor/three/three.module.min.js";
import { createOrbit } from "./orbit.js";
import { SEA, SKY, slopeShade, edgeFactor } from "./colors.js";
import { layoutRivers } from "./rivers.js";

export const DEFAULT_EXAGGERATION = 15;
const SINK = 0.7; // km every prism reaches below the sea surface
const LIFT = 0.04; // km land stands above the sea at 0 m, so a flat coast does not merge with the water
const RIVER_LIFT = 0.09; // km the river ribbons float above the tops
const CURVE_R = 1900; // km, radius of the drawn sphere (the Earth is 6371)
const BACKDROP_R = 2600;
// A dense mesh is limited by the pixels drawn: while the camera or the heights change, draw at most this many, and
// the full resolution again once the picture has been still for SHARPEN_MS.
const DENSE_CELLS = 20000;
const MOVING_PIXELS = 2.2e6;
const SHARPEN_MS = 220;
// Light: a sun in the north-west, 45° up. Ambient + sun add up to exactly 1 on a flat top, so those keep the colour
// given to them (a lens ramp reads as in its legend); walls get from 0.45 (facing away) to 1.
const SUN = [-0.5, Math.SQRT1_2, -0.5];
const AMBIENT = 0.45;

/** Unit hex prism: height 0..1, pointy-top corners in X/Z, no bottom face. Vertex colours darken rims and feet. */
function prismGeometry(corners) {
  const pos = [], nor = [], col = [], index = [];
  const push = (x, y, z, nx, ny, nz, c) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    col.push(c, c, c);
    return pos.length / 3 - 1;
  };
  const RIM = 0.93, HEAD = 0.9, FOOT = 0.5;
  const centre = push(0, 1, 0, 0, 1, 0, 1);
  const rim = corners.map(([x, z]) => push(x, 1, z, 0, 1, 0, RIM));
  for (let k = 0; k < 6; k++) {
    index.push(centre, rim[(k + 1) % 6], rim[k]);
    const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 6];
    const len = Math.hypot(ax + bx, az + bz), nx = (ax + bx) / len, nz = (az + bz) / len;
    const a1 = push(ax, 1, az, nx, 0, nz, HEAD), b1 = push(bx, 1, bz, nx, 0, nz, HEAD);
    const b0 = push(bx, 0, bz, nx, 0, nz, FOOT), a0 = push(ax, 0, az, nx, 0, nz, FOOT);
    index.push(a1, b1, b0, a1, b0, a0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

// sRGB channel (0..255, in quarter steps) -> linear, so painting 100 000 cells needs no powers.
const LINEAR = Float32Array.from({ length: 1021 }, (_, k) => {
  const c = k / 1020;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const linear = (v) => LINEAR[v <= 0 ? 0 : v >= 255 ? 1020 : Math.round(v * 4)];

/** Disc of rings around the origin, finer near the map, wound to face up. */
function discGeometry(segments, step) {
  const radii = [0];
  let r = 0, dr = step;
  while (r < BACKDROP_R) {
    r = Math.min(BACKDROP_R, r + dr);
    radii.push(r);
    if (r > 280) dr *= 1.14;
  }
  const pos = [], index = [];
  for (const radius of radii) {
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      pos.push(radius * Math.cos(a), 0, radius * Math.sin(a));
    }
  }
  for (let j = 0; j < radii.length - 1; j++) {
    for (let k = 0; k < segments; k++) {
      const a = j * segments + k, b = j * segments + ((k + 1) % segments), c = a + segments, d = b + segments;
      index.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/** Lambert material whose instances stand (SINK + aHeight) km tall. */
function prismMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aHeight;")
      .replace("#include <begin_vertex>", `vec3 transformed = vec3(position.x, position.y * (${SINK.toFixed(3)} + aHeight), position.z);`);
  };
  return material;
}

const SKY_VERTEX = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
// The horizon of the paraboloid y = -|p|²/2R seen from the camera: slope -(sqrt(2H/R) + p·h/R) along heading h.
const SKY_FRAGMENT = `
  uniform vec3 haze, low, space;
  uniform vec2 eye;
  uniform float dip, curvature;
  varying vec3 vDir;
  void main() {
    float flatLen = max(length(vDir.xz), 1e-5);
    float horizon = -(dip + dot(eye, vDir.xz / flatLen) * curvature);
    float up = vDir.y / flatLen - horizon;
    vec3 c = mix(haze, low, smoothstep(0.0, 0.045, up));
    c = mix(c, space, smoothstep(0.03, 0.22, up));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export function createReliefScene(canvas, w, { mobile = false, onMove, onTap, onHover, onGesture } = {}) {
  // Map km of the world's centre: the same origin for both meshes, so switching leaves the camera over the same land.
  const cx = w.raw.width / 2, cz = w.raw.height / 2;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: "high-performance" });
  const fullRatio = () => Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 2, 9000);
  const color = new THREE.Color();
  const srgb = (c, target = color) => target.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

  const haze = new THREE.Color(SKY.haze);
  scene.fog = new THREE.Fog(haze, 600, 1600);
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, ((1 - AMBIENT) / SUN[1]) * Math.PI);
  sun.position.set(SUN[0], SUN[1], SUN[2]);
  scene.add(sun);

  const backdropGeometry = discGeometry(mobile ? 72 : 144, mobile ? 14 : 7);
  const backdrop = new THREE.Mesh(backdropGeometry, new THREE.MeshBasicMaterial({ color: srgb(SEA.far).clone() }));
  backdrop.frustumCulled = false;
  scene.add(backdrop);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: {
        haze: { value: haze }, low: { value: new THREE.Color(SKY.low) }, space: { value: new THREE.Color(SKY.space) },
        eye: { value: new THREE.Vector2() }, dip: { value: 0 }, curvature: { value: 0 },
      },
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  let exaggeration = DEFAULT_EXAGGERATION;
  let curved = true;
  let riversOn = true;
  let riversQuiet = false;
  let base = null; // sRGB colour per cell, before slope shading
  let shadeStrength = 1;
  let stale = false; // slope shading waiting for the heights to stop changing
  let queued = false;
  let alive = true;
  let disposed = false;
  const times = []; // ms of CPU time per render() call
  let frames = 0;

  const drop = (x, z) => (curved ? (x * x + z * z) / (2 * CURVE_R) : 0);

  // --- the active terrain ------------------------------------------------------------------------------------------
  let T = null;
  let prisms = null, rivers = null, course = null;
  let heights = null; // km of each cell's top above the sea surface
  let edge = null; // 0..1 per cell, see colors.js edgeFactor
  let lakeElev = null;
  let highest = 0;
  let shades = null;

  // Height of the top of cell i above the sea surface, km. Neighbours also sink toward the grid edge, so the map
  // does not end in a wall of cut-off mountains.
  function rise(i) {
    const lake = T.water[i] ? lakeElev.get(i) : undefined;
    if (T.water[i] && lake === undefined) return 0;
    const taper = T.owner[i] >= 0 ? 1 : edge[i];
    return LIFT + (Math.max(0, lake ?? T.elev[i]) / 1000) * exaggeration * taper;
  }
  const heightOf = (i) => heights[i];

  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const quat = new THREE.Quaternion(), normal = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  // Where each prism starts and how it leans: on a new terrain or curvature. Its height is not in the matrix.
  function frameCells() {
    const { grid } = T;
    const a = prisms.instanceMatrix.array;
    for (let i = 0; i < T.n; i++) {
      const x = grid.cx(i) - cx, z = grid.cy(i) - cz;
      if (curved) normal.set(x / CURVE_R, 1, z / CURVE_R).normalize();
      else normal.copy(UP);
      quat.setFromUnitVectors(UP, normal);
      position.set(x, -drop(x, z), z).addScaledVector(normal, -SINK);
      matrix.compose(position, quat, one).toArray(a, i * 16);
    }
    prisms.instanceMatrix.needsUpdate = true;
    raiseCells();
  }
  // The heights: on every new exaggeration.
  function raiseCells() {
    highest = 0;
    for (let i = 0; i < T.n; i++) {
      const h = (heights[i] = rise(i));
      if (h > highest) highest = h;
    }
    prisms.geometry.attributes.aHeight.needsUpdate = true;
    placeRivers();
  }
  // Each river vertex rides on its cell: the same frame as the prism, just above its top.
  function placeRivers() {
    const a = prisms.instanceMatrix.array;
    const out = rivers.geometry.attributes.position;
    for (let k = 0; k < course.count; k++) {
      const i = course.cell[k], o = i * 16;
      const dx = course.offset[k * 2], dz = course.offset[k * 2 + 1];
      const up = SINK + heights[i] + RIVER_LIFT;
      out.setXYZ(k,
        a[o + 12] + a[o] * dx + a[o + 4] * up + a[o + 8] * dz,
        a[o + 13] + a[o + 1] * dx + a[o + 5] * up + a[o + 9] * dz,
        a[o + 14] + a[o + 2] * dx + a[o + 6] * up + a[o + 10] * dz);
    }
    out.needsUpdate = true;
  }

  function layoutBackdrop() {
    const p = backdropGeometry.attributes.position;
    for (let k = 0; k < p.count; k++) p.setY(k, -drop(p.getX(k), p.getZ(k)) - 0.03);
    p.needsUpdate = true;
  }

  function paintCell(i) {
    const c = base[i];
    // Multiplies, so lit slopes keep their hue.
    const k = 1 + shades[i] * shadeStrength * (T.owner[i] >= 0 ? 1 : edge[i]);
    const a = prisms.instanceColor.array;
    a[i * 3] = linear(c[0] * k);
    a[i * 3 + 1] = linear(c[1] * k);
    a[i * 3 + 2] = linear(c[2] * k);
  }
  function paint() {
    if (!base || base.length !== T.n) return;
    stale = false;
    shades = slopeShade(T, exaggeration, SUN);
    for (let i = 0; i < T.n; i++) paintCell(i);
    prisms.instanceColor.needsUpdate = true;
  }

  function styleRivers() {
    rivers.visible = riversOn;
    Object.assign(rivers.material, {
      transparent: riversQuiet, opacity: riversQuiet ? 0.6 : 1, depthWrite: !riversQuiet,
    });
    rivers.material.needsUpdate = true;
  }

  function dropTerrain() {
    for (const o of [prisms, rivers]) {
      if (!o) continue;
      scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
    prisms?.dispose();
    prisms = rivers = null;
  }

  /** Draw another terrain (terrain.js). Its colours come next, through setColors(). */
  function setTerrain(terrain) {
    dropTerrain();
    T = terrain;
    base = shades = null;
    stale = false;
    heights = new Float32Array(T.n);
    edge = Float32Array.from({ length: T.n }, (_, i) => edgeFactor(T.grid, i));
    // A lake without a height in the data (elev 0 or below) sits at its lowest shore, not in a pit at sea level.
    lakeElev = new Map();
    for (let i = 0; i < T.n; i++) {
      if (T.water[i] !== 3) continue;
      if (T.elev[i] > 0) {
        lakeElev.set(i, T.elev[i]);
        continue;
      }
      const shore = [0, 1, 2, 3, 4, 5].map((d) => T.grid.neighbour(i, d)).filter((j) => j >= 0 && !T.water[j]);
      if (shore.length) lakeElev.set(i, Math.min(...shore.map((j) => T.elev[j])));
    }

    const prism = prismGeometry(T.grid.corners);
    const aHeight = new THREE.InstancedBufferAttribute(heights, 1);
    aHeight.setUsage(THREE.DynamicDrawUsage);
    prism.setAttribute("aHeight", aHeight);
    prisms = new THREE.InstancedMesh(prism, prismMaterial(), T.n);
    prisms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(T.n * 3), 3);
    prisms.frustumCulled = false;
    scene.add(prisms);

    course = layoutRivers(T, rise, mobile ? 1.35 : 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(course.count * 3), 3));
    const colors = new Float32Array(course.count * 3);
    course.colors.forEach((c, k) => srgb(c).toArray(colors, k * 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(course.index);
    // Seen from both sides, in one pass (a see-through two-sided material would otherwise be drawn twice).
    rivers = new THREE.Mesh(geometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, forceSinglePass: true }));
    rivers.frustumCulled = false;
    scene.add(rivers);
    styleRivers();
    frameCells();
    requestRender();
  }

  // Height of the ground under (x, z), for keeping the camera above the prisms.
  const floorAt = (x, z) => {
    let top = 0;
    if (T) {
      for (const dx of [-2.5, 0, 2.5]) {
        for (const dz of [-2.5, 0, 2.5]) {
          const i = T.grid.cellAt(x + cx + dx, z + cz + dz);
          if (i >= 0) top = Math.max(top, heights[i]);
        }
      }
    }
    return top - drop(x, z) + 3;
  };
  const orbit = createOrbit(canvas, camera, {
    onChange: () => {
      motion();
      requestRender();
      onMove?.();
    },
    onTap, onHover, onGesture,
    bounds: { x: cx, z: cz }, minDist: () => Math.max(35, 3.2 * exaggeration), floor: floorAt,
  });

  const movingRatio = () => (T && T.n > DENSE_CELLS
    ? Math.min(fullRatio(), Math.max(0.75, Math.sqrt(MOVING_PIXELS / (size.w * size.h))))
    : fullRatio());
  let moving = false;
  let sharpen = 0;
  function motion() {
    if (movingRatio() >= fullRatio()) return;
    moving = true;
    clearTimeout(sharpen);
    sharpen = setTimeout(() => {
      moving = false;
      if (stale) paint();
      requestRender();
    }, SHARPEN_MS);
  }

  function frame() {
    queued = false;
    if (!alive) return;
    const ratio = moving ? movingRatio() : fullRatio();
    if (Math.abs(renderer.getPixelRatio() - ratio) > 1e-3) renderer.setPixelRatio(ratio); // resizes the drawing buffer
    const dist = orbit.state.dist;
    scene.fog.near = dist * 1.15 + 90;
    scene.fog.far = dist * 2 + 900;
    sky.position.copy(camera.position);
    const u = sky.material.uniforms;
    const h = Math.max(1, camera.position.y + drop(camera.position.x, camera.position.z));
    u.eye.value.set(camera.position.x, camera.position.z);
    u.curvature.value = curved ? 1 / CURVE_R : 0;
    u.dip.value = curved ? Math.sqrt((2 * h) / CURVE_R) : h / BACKDROP_R;
    const t0 = performance.now();
    renderer.render(scene, camera);
    times.push(performance.now() - t0);
    if (times.length > 90) times.shift();
    frames++;
  }
  function requestRender() {
    if (queued || !alive) return;
    queued = true;
    requestAnimationFrame(frame);
  }

  // The camera's principal point sits in the middle of the area left free by the controls.
  const size = { w: 1, h: 1, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  const shift = { x: 0, y: 0 };
  function applyOffset() {
    const { w: W, h: H, insets: m } = size;
    const dx = (m.left - m.right) / 2 + shift.x, dy = (m.top - m.bottom) / 2 + shift.y;
    camera.setViewOffset(W, H, -dx, -dy, W, H);
    camera.updateProjectionMatrix();
  }
  function setSize(width, height, insets = size.insets) {
    size.w = Math.max(1, Math.round(width));
    size.h = Math.max(1, Math.round(height));
    size.insets = insets;
    renderer.setPixelRatio(fullRatio());
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    applyOffset();
    requestRender();
  }

  // The home view: from the south-west, all of Galicia inside the free area. Framed on the game grid, so both meshes
  // give the same view.
  const probe = new THREE.Vector3();
  function gamePoint(j) {
    const x = w.grid.cx(j) - cx, z = w.grid.cy(j) - cz;
    return probe.set(x, (Math.max(0, w.raw.elev[j]) / 1000) * exaggeration - drop(x, z), z);
  }
  function fit() {
    const own = [];
    let sx = 0, sz = 0;
    for (let j = 0; j < w.grid.size; j++) {
      if (w.raw.owner[j] < 0) continue;
      own.push(j);
      sx += w.grid.cx(j) - cx;
      sz += w.grid.cy(j) - cz;
    }
    const every = Math.max(1, Math.floor(own.length / 2500));
    const sample = own.filter((_, k) => k % every === 0);
    const portrait = size.h > size.w * 1.1;
    const s = orbit.state;
    Object.assign(s, { az: portrait ? -0.25 : -0.55, el: portrait ? 0.57 : 0.47, tx: sx / own.length, tz: sz / own.length });
    const m = size.insets;
    const freeW = Math.max(120, size.w - m.left - m.right), freeH = Math.max(120, size.h - m.top - m.bottom);
    shift.x = shift.y = 0;
    applyOffset();
    const box = () => {
      orbit.apply();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const j of sample) {
        gamePoint(j).project(camera);
        const px = ((probe.x + 1) / 2) * size.w, py = ((1 - probe.y) / 2) * size.h;
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
      return { x0, y0, x1, y1 };
    };
    let lo = 80, hi = 900;
    for (let it = 0; it < 18; it++) {
      s.dist = (lo + hi) / 2;
      const b = box();
      if (b.x1 - b.x0 > freeW * (portrait ? 1.04 : 0.96) || b.y1 - b.y0 > freeH * 0.8) lo = s.dist;
      else hi = s.dist;
    }
    s.dist = hi;
    const b = box();
    // Centre the picture in the free area, a little low: the room above is for the horizon.
    shift.x = m.left + freeW / 2 - (b.x0 + b.x1) / 2;
    shift.y = m.top + freeH * 0.575 - (b.y0 + b.y1) / 2;
    applyOffset();
    orbit.apply();
    requestRender();
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /**
   * Cell under the client point, or -1: walks the ray until it goes below the top of the cell under it. A prism leans
   * with the curvature, so a point at height h over the sphere belongs to the column at x / (1 + h / R).
   */
  function pick(clientX, clientY) {
    if (!T) return -1;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const { origin: o, direction: d } = raycaster.ray;
    const { grid } = T;
    const above = (t) => {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      return o.y + d.y * t + drop(x, z);
    };
    const cellUnder = (t) => {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      const k = curved ? 1 / (1 + Math.max(0, above(t)) / CURVE_R) : 1;
      return grid.cellAt(x * k + cx, z * k + cz);
    };
    const hits = (t) => {
      const i = cellUnder(t);
      return i >= 0 && above(t) <= heights[i] ? i : -1;
    };
    const step = grid.R * 0.3;
    let t = 0;
    while (t < 2500) {
      const eta = above(t);
      if (eta < -SINK) return -1;
      if (eta > highest + 0.5) {
        t += Math.max(step, (eta - highest) * 0.6);
        continue;
      }
      if (hits(t) >= 0) {
        let lo = Math.max(0, t - step), hi = t; // narrow down where the ray enters the prism
        for (let it = 0; it < 8; it++) {
          const mid = (lo + hi) / 2;
          if (hits(mid) >= 0) hi = mid;
          else lo = mid;
        }
        return hits(hi);
      }
      t += step;
    }
    return -1;
  }

  /** Client position of a point of cell i's top: (dx, dz) km from its centre. */
  function topPoint(i, dx, dz, r) {
    const a = prisms.instanceMatrix.array, o = i * 16, up = SINK + heights[i];
    probe.set(
      a[o + 12] + a[o] * dx + a[o + 4] * up + a[o + 8] * dz,
      a[o + 13] + a[o + 1] * dx + a[o + 5] * up + a[o + 9] * dz,
      a[o + 14] + a[o + 2] * dx + a[o + 6] * up + a[o + 10] * dz,
    ).project(camera);
    return [r.left + ((probe.x + 1) / 2) * r.width, r.top + ((1 - probe.y) / 2) * r.height];
  }
  /** The six corners of cell i's top on screen, for the hover mark (drawn over the canvas: no new frame needed). */
  function outline(i) {
    const r = canvas.getBoundingClientRect();
    return T.grid.corners.map(([dx, dz]) => topPoint(i, dx, dz, r));
  }

  layoutBackdrop();

  const lost = (e) => e.preventDefault();
  const restored = () => requestRender();
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);

  return {
    orbit,
    setSize,
    fit,
    pick,
    outline,
    setTerrain,
    requestRender,
    get terrain() { return T; },
    get exaggeration() { return exaggeration; },
    get curved() { return curved; },
    setExaggeration(v) {
      exaggeration = Math.min(30, Math.max(1, Number(v) || 1));
      if (T) {
        raiseCells();
        // On a dense mesh the slope shading waits until the slider rests (it repaints every cell).
        if (T.n > DENSE_CELLS) {
          stale = true;
          motion();
          if (!moving) paint(); // the screen can take full resolution at once, so nothing will come later
        } else paint();
      }
      orbit.apply();
      requestRender();
    },
    setRivers(on) {
      riversOn = !!on;
      if (rivers) styleRivers();
      requestRender();
    },
    /** Quiet rivers: see-through, so they orient without hiding the colour of a lens. */
    setRiversQuiet(quiet) {
      riversQuiet = !!quiet;
      if (rivers) styleRivers();
      requestRender();
    },
    /** Names of the rivers crossing cell i. */
    riversAt: (i) => course?.names.get(i) || [],
    get meshes() { return { prisms, rivers, course }; }, // for tests
    setCurved(on) {
      curved = !!on;
      layoutBackdrop();
      if (T) frameCells();
      orbit.apply();
      requestRender();
    },
    setColors(rgb, strength = 1) {
      base = rgb;
      shadeStrength = strength;
      paint();
      requestRender();
    },
    /** Client position of the top of cell i (for tests). */
    project: (i) => topPoint(i, 0, 0, canvas.getBoundingClientRect()),
    heightOf,
    pause() {
      alive = false;
      queued = false;
      moving = false;
      clearTimeout(sharpen);
    },
    resume() {
      if (disposed) return;
      alive = true;
      if (stale) paint(); // closed while the slider was still moving
      requestRender();
    },
    stats() {
      const info = renderer.info.render;
      const gl = renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        instances: prisms?.count ?? 0, drawCalls: info.calls, triangles: info.triangles, frames,
        renderMsAvg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
        pixelRatio: renderer.getPixelRatio(), antialias: !mobile,
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      };
    },
    /** Draw n frames in a row, waiting for the GPU after each: ms per frame (for tests). */
    benchmark(count = 30) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let k = 0; k < count; k++) {
        renderer.render(scene, camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / count;
    },
    dispose() {
      alive = false;
      disposed = true;
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      dropTerrain();
      for (const o of [backdrop, sky]) {
        o.geometry.dispose();
        o.material.dispose();
      }
      renderer.dispose();
    },
  };
}
