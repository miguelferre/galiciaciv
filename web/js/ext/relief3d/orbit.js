// Camera orbit for the relief view: one finger or left drag turns, right / middle / Shift drag or two fingers move,
// wheel or pinch zooms toward the pointer. Own code (no OrbitControls: it needs an import map for "three").
//   az   radians around the vertical; 0 = camera due south looking north, negative = toward the west
//   el   radians above the horizontal
//   dist km from the target, which lies on the sea-level plane at (tx, tz)
export const LIMITS = { elMin: 0.14, elMax: 1.54, distMax: 900 };
const TAP_PX = 6;

export function createOrbit(element, camera, { onChange, onTap, onHover, onGesture, bounds, minDist = () => 30, floor = () => 0 }) {
  const s = { az: -0.61, el: 0.6, dist: 380, tx: 0, tz: 0 };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const tanHalf = () => Math.tan((camera.fov * Math.PI) / 360);

  function apply() {
    s.el = clamp(s.el, LIMITS.elMin, LIMITS.elMax);
    s.dist = clamp(s.dist, minDist(), LIMITS.distMax);
    s.tx = clamp(s.tx, -bounds.x, bounds.x);
    s.tz = clamp(s.tz, -bounds.z, bounds.z);
    const flat = Math.cos(s.el) * s.dist;
    const x = s.tx + flat * Math.sin(s.az), z = s.tz + flat * Math.cos(s.az);
    const y = Math.max(Math.sin(s.el) * s.dist, floor(x, z)); // never inside a prism
    camera.position.set(x, y, z);
    camera.lookAt(s.tx, 0, s.tz);
    camera.updateMatrixWorld();
  }
  const changed = () => {
    apply();
    onChange?.();
  };

  function rotate(dAz, dEl) {
    s.az += dAz;
    s.el += dEl;
    changed();
  }
  // Move the ground by (dx, dy) screen px.
  function pan(dx, dy) {
    const k = (2 * s.dist * tanHalf()) / Math.max(1, element.clientHeight);
    const fwd = (dy * k) / Math.max(0.4, Math.sin(s.el));
    s.tx += -Math.cos(s.az) * dx * k - Math.sin(s.az) * fwd;
    s.tz += Math.sin(s.az) * dx * k - Math.cos(s.az) * fwd;
    changed();
  }
  // factor < 1 comes closer. (px, py): client coordinates that should stay put.
  function zoom(factor, px, py) {
    const before = s.dist;
    s.dist = clamp(s.dist * factor, minDist(), LIMITS.distMax);
    const f = s.dist / before;
    if (px != null && f !== 1) {
      const p = groundAt(px, py);
      if (p && Math.hypot(p[0] - s.tx, p[1] - s.tz) < before * 1.5) {
        s.tx = p[0] + (s.tx - p[0]) * f;
        s.tz = p[1] + (s.tz - p[1]) * f;
      }
    }
    changed();
  }
  function groundAt(px, py) {
    const r = element.getBoundingClientRect();
    const v = camera.position.clone().set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1, 0.5)
      .unproject(camera).sub(camera.position);
    if (v.y >= -1e-6) return null;
    const t = -camera.position.y / v.y;
    return [camera.position.x + v.x * t, camera.position.z + v.z * t];
  }

  const pointers = new Map();
  let drag = null; // {moved, pan}
  let pinch = null; // {dist, x, y}
  const mid = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const down = (e) => {
    element.focus?.({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { element.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (pointers.size === 1) drag = { moved: 0, pan: e.button === 1 || e.button === 2 || e.shiftKey };
    else if (pointers.size === 2) {
      drag = { moved: 99, pan: false };
      pinch = mid();
      onGesture?.();
    }
    e.preventDefault();
  };
  const move = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") onHover?.(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch && pointers.size >= 2) {
      const now = mid();
      pan(now.x - pinch.x, now.y - pinch.y);
      if (now.dist > 0 && pinch.dist > 0) zoom(pinch.dist / now.dist, now.x, now.y);
      pinch = now;
      return;
    }
    if (!drag) return;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved <= TAP_PX) return;
    onGesture?.();
    if (drag.pan) pan(dx, dy);
    else rotate(-dx * 0.0055, dy * 0.0045);
  };
  const up = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (pointers.size) return;
    const tap = e.type === "pointerup" && drag && drag.moved <= TAP_PX;
    drag = null;
    if (tap) onTap?.(e.clientX, e.clientY, e.pointerType);
  };
  const wheel = (e) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    onGesture?.();
    zoom(Math.exp(clamp(delta, -300, 300) * 0.0016), e.clientX, e.clientY);
  };
  // Mouse only: a finger "leaves" right after every tap, which would close the tooltip the tap just opened.
  const leave = (e) => {
    if (e.pointerType === "mouse" && !pointers.size) onGesture?.();
  };
  const menu = (e) => e.preventDefault();

  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  element.addEventListener("pointerleave", leave);
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("contextmenu", menu);

  return {
    state: s,
    apply,
    rotate,
    pan,
    zoom,
    set(values) {
      Object.assign(s, values);
      changed();
    },
    reset() {
      pointers.clear();
      drag = pinch = null;
    },
  };
}
