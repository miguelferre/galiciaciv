// Small HTML bars for the city screen (no libraries). All return HTML strings.
/**
 * A comparison meter: the city's value as a bar on a 0..max scale, with a tick at the Galicia value.
 * better: "high" | "low" | null decides the bar colour against the Galicia value.
 */
export function meter(v, ref, max, better = null) {
  if (v == null || !(max > 0)) return `<div class="cv-meter"><i style="width:0"></i></div>`;
  const f = Math.max(0, Math.min(1, v / max));
  const u = ref != null ? Math.max(0, Math.min(1, ref / max)) : null;
  let cls = "";
  if (better && ref != null && Math.abs(v / ref - 1) >= 0.03) cls = (better === "high" ? v > ref : v < ref) ? "good" : "bad";
  return `<div class="cv-meter ${cls}"><i style="width:${(f * 100).toFixed(1)}%"></i>${
    u != null ? `<b class="ref" style="left:${(u * 100).toFixed(1)}%" title="Galicia"></b>` : ""}</div>`;
}

/** A thin horizontal bar (0..1) in a colour; optional tick (0..1) for a reference such as the Galicia share. */
export function bar(frac, color, tick = null) {
  const f = Math.max(0, Math.min(1, frac || 0));
  return `<div class="cv-bar"><i style="width:${(f * 100).toFixed(1)}%;background:${color}"></i>${
    tick != null ? `<b style="left:${(Math.max(0, Math.min(1, tick)) * 100).toFixed(1)}%" title="Parte en Galicia"></b>` : ""}</div>`;
}
