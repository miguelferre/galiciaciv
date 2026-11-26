// Number formatting for the advisor kit, built on web/js/format.js (es-ES, euros).
// Formats follow lenses.json / counties.json: int | eur | pct (0..1 fraction) | float | years | km2 | text,
// plus a few of our own: money (compact €), signed (signed %), lq (×1,23), count, ratio (×4,2).
import { compact, dollars, euros, int, money, pct } from "../../../format.js";
import { fin } from "./util.js";

export { compact, dollars, euros, int, money, pct };

const NB = " ";

/** A number with d decimals and a decimal comma. */
export const dec = (v, d = 1) => (fin(v) ? v.toFixed(d).replace(".", ",") : "–");
// The same, without trailing zeros (axis ticks).
const trim = (v, d) => String(+v.toFixed(d)).replace(".", ",");

export const signedPct = (g, d = 1) => (fin(g) ? `${g >= 0 ? "+" : "−"}${dec(Math.abs(g * 100), d)}${NB}%` : "–");

// Counts to three significant figures (1,12 M vs 1,11 M rather than 1,1 M twice).
export function count3(n) {
  if (!fin(n)) return "–";
  const a = Math.abs(n);
  const sig = (d, unit) => `${dec(n / d, a / d >= 100 ? 0 : a / d >= 10 ? 1 : 2)}${NB}${unit}`;
  if (a >= 1e12) return sig(1e12, "B");
  if (a >= 1e9) return sig(1e9, `mil${NB}M`);
  if (a >= 1e6) return sig(1e6, "M");
  if (a >= 1e4) return sig(1e3, "mil");
  return int(n);
}

/** Full-ish text for a value in a given format (tables, tooltips). */
export function fmtValue(format, v, unit) {
  if (format === "text") return v == null || v === "" ? "–" : String(v);
  if (!fin(v)) return "–";
  switch (format) {
    case "int": case "count": return Math.abs(v) >= 1e6 ? count3(v) : int(v);
    case "eur": case "usd": return Math.abs(v) >= 1e6 ? money(v) : euros(v);
    case "money": return money(v);
    case "pct": return pct(v);
    case "signed": return signedPct(v);
    case "lq": return `×${dec(v, 2)}`;
    case "ratio": return `×${dec(v, 1)}`;
    case "years": return `${dec(v, 1)}${NB}años`;
    case "km2": return `${Math.abs(v) < 100 ? dec(v, 1) : int(v)}${NB}km²`;
    case "float": return Math.abs(v) >= 100 ? int(v) : Math.abs(v) >= 10 ? dec(v, 1) : dec(v, 2);
    default:
      return Math.abs(v) >= 1e4 ? count3(v) : Math.abs(v) >= 100 ? int(v) : dec(v, 2);
  }
}

/** Compact text for a table cell, so numbers fit narrow columns: 121 mil €, 9,40 M, +2,1 %, 12,3 %, 4210 km². */
export function fmtCell(format, v, unit) {
  if (format === "text") return v == null || v === "" ? "–" : String(v);
  if (!fin(v)) return "–";
  const a = Math.abs(v);
  switch (format) {
    case "int": case "count": return a >= 1e4 ? count3(v) : int(v);
    case "eur": case "usd": return a >= 1e4 ? `${count3(v)}${NB}€` : euros(v);
    case "money": return money(v);
    case "km2": return a >= 1e5 ? `${count3(v)}${NB}km²` : fmtValue(format, v, unit);
    case "float": return a >= 1e4 ? count3(v) : fmtValue(format, v, unit);
    default: return fmtValue(format, v, unit);
  }
}

/** Short text for axis ticks and chips. */
export function fmtShort(format, v) {
  if (!fin(v)) return "–";
  switch (format) {
    case "eur": case "usd": case "money": return money(v);
    case "pct": return `${trim(v * 100, Math.abs(v) < 0.1 && v !== 0 ? 1 : 0)}${NB}%`;
    case "signed": return `${v > 0 ? "+" : v < 0 ? "−" : ""}${trim(Math.abs(v * 100), 1)}${NB}%`;
    case "lq": case "ratio": return `×${trim(v, 1)}`;
    case "years": return trim(v, 0);
    default: return Math.abs(v) >= 1000 ? compact(v) : String(+v.toPrecision(3)).replace(".", ",");
  }
}

/** Parse "1,5 M", "250 mil", "12 %", "80.000 €", "-3%" into a number in the field's units (pct → fraction). */
export function parseNum(text, format) {
  if (text == null) return null;
  let s = String(text).toLowerCase().replace(/[€\s]/g, "").replace(/^−/, "-");
  if (!s) return null;
  let isPct = false;
  if (s.endsWith("%")) { isPct = true; s = s.slice(0, -1); }
  // "mil" = 10^3, "m" = 10^6, "mil m" (or "mm") = 10^9, "b" = billón, 10^12
  const m = /^(-?[\d.,]+)(milm|mil|mm|k|m|b)?$/.exec(s);
  if (!m) return null;
  let num = m[1];
  // A comma is the decimal mark (dots then group thousands); without one, "80.000" groups and "1.5" is a decimal.
  if (num.includes(",")) num = num.replace(/\./g, "").replace(",", ".");
  else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, "");
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(num)) return null;
  let v = parseFloat(num) * ({ "": 1, k: 1e3, mil: 1e3, m: 1e6, milm: 1e9, mm: 1e9, b: 1e12 })[m[2] || ""];
  if ((format === "pct" || format === "signed") && (isPct || Math.abs(v) > 1)) v /= 100;
  return v;
}
