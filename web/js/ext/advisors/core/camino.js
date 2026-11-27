// Map colouring for the Camino de Santiago: kilometres of Camino inside each concello (counties.json column
// camino_km, shared stretches counted once). An ordinary lens object built with countyLens; the Culture advisor
// offers it in its map picker. Concellos with no Camino stay at 0 (darkest step).
import { countyLens } from "./lenses.js";
import { fin, quantile } from "./util.js";

const CAMINO_RAMP = ["#1c1608", "#4a3810", "#8a6a18", "#c99a2a", "#f2c14e", "#fff1c4"];

/** Km of Camino de Santiago per concello, as a lens. Null when counties.json has no camino_km column. */
export function caminoLens(data) {
  const lv = data.levels.counties;
  if (!lv?.field("camino_km")) return null;
  const pos = lv.rows.map((r) => r.v.camino_km).filter((v) => fin(v) && v > 0).sort((a, b) => a - b);
  const top = pos.length ? Math.max(quantile(pos, 0.95), 5) : 10;
  return countyLens(data, "camino_km", {
    group: "land", name: "Km de Camino de Santiago", unit: "km dentro del concello", format: "float", emoji: "◆", icon: "layers",
    ramp: CAMINO_RAMP, domain: [0, top], source: "ign_camino",
    description: "Kilómetros de Caminos de Santiago dentro de cada concello (IGN-CNIG, datos de la FEAACS), con los tramos que comparten varios Caminos contados una vez. Los concellos sin Camino valen 0. Es ayuda a la marcha, no el trazado legal.",
  });
}
