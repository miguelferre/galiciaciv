// Number formatting for the City View: format.js's es-ES / euro helpers with a roll-over fix, so a value that rounds
// up to the next unit reads "1 M" rather than "1000 mil". format.js is shared with the rest of the app; this wrapper
// keeps the same output for every other value. Also used by render/banners.js (compact, popShort).
import { compact as baseCompact, popShort as basePopShort, isMoneyUnit } from "../../format.js";

const NEXT = { mil: 1e6, M: 1e9, "mil M": 1e12 };

/** Rounds n up to the next unit when its compact form would print 1000 of the current one. */
function rollover(n, fmt) {
  if (n == null || Number.isNaN(n)) return fmt(n);
  const s = fmt(n);
  const m = /^-?1000 (mil M|mil|M)$/.exec(s);
  return m ? fmt(Math.sign(n) * NEXT[m[1]]) : s;
}

export const compact = (n) => rollover(n, baseCompact);
export const money = (n) => (n == null ? "–" : compact(n) + " €");
export const yieldValue = (y, v) => (isMoneyUnit(y.unit) ? money(v) : compact(v));
export const popShort = (n) => rollover(n, basePopShort);
/** A decimal with a comma: num(47.18) → "47,2". */
export const num = (x, d = 1) => (x == null || Number.isNaN(x) ? "–" : x.toFixed(d).replace(".", ","));
