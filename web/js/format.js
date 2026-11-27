// Spanish (Spain) number style: decimal comma, "." or a space as thousands separator, "€" after the number, scales
// "mil" (10^3), "M" (10^6), "mil M" (10^9, miles de millones) and "B" (10^12, billón).
// Galego (gl-ES) writes numbers the same way; the locale follows the page language (i18n.js), es-ES as fallback.
import { locale } from "./i18n.js";
const LOCALE = () => locale();
const dec = (x, d) => x.toFixed(d).replace(".", ",");
const grouped = (n) => {
  try { return n.toLocaleString(LOCALE(), { useGrouping: "always" }); } catch { return n.toLocaleString("es-ES"); }
};

// [scale divisor, suffix, decimals under 100 units, decimals from 100 units]
function scaled(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return [n / 1e12, "B", a >= 1e13 ? 1 : 2];
  if (a >= 1e9) return [n / 1e9, "mil M", a >= 1e11 ? 0 : 1];
  if (a >= 1e6) return [n / 1e6, "M", a >= 1e8 ? 0 : 1];
  if (a >= 1e3) return [n / 1e3, "mil", a >= 1e5 ? 0 : 1];
  return null;
}

export function compact(n) {
  if (n == null || Number.isNaN(n)) return "–";
  const sc = scaled(n);
  if (!sc) return String(Math.round(n));
  return dec(sc[0], sc[2]).replace(/,0$/, "") + " " + sc[1];
}

// Money is always euros: "450 mil €", "12,5 M €", "3,2 mil M €".
export const money = (n) => (n == null ? "–" : compact(n) + " €");
export const dollars = (n) => (n == null ? "–" : grouped(Math.round(n)) + " €"); // legacy name: full euro amount
export const euros = dollars;
export const int = (n) => (n == null ? "–" : grouped(Math.round(n)));
export const pct = (x, d = 1) => (x == null ? "–" : dec(x * 100, d) + " %");

// nation.json yield units: "usd" (legacy) or "eur" both mean money.
export const isMoneyUnit = (u) => u === "usd" || u === "eur";

export function yieldValue(y, v) {
  return isMoneyUnit(y.unit) ? money(v) : compact(v);
}

export function popShort(n) {
  if (n >= 1e6) return dec(n / 1e6, 1).replace(/,0$/, "") + " M";
  if (n >= 1e4) return Math.round(n / 1e3) + " mil";
  if (n >= 1e3) return dec(n / 1e3, 1).replace(/,0$/, "") + " mil";
  return String(Math.round(n));
}

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
