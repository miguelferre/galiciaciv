// Map colouring for the Formación profesional advisor: places of FP per 1 000 young people (15 to 24), per comarca
// (fp.json by_comarca). An ordinary lens built with stateLens; the view offers it in its map picker and a #lens= link
// restores it (lensFromId waits for fp.json).
import { stateLens } from "./lenses.js";
import { fin, quantile } from "./util.js";

const FP_RAMP = ["#0b1626", "#16385f", "#2a6aa6", "#47a1d6", "#92d0ee", "#e8f7ff"];

/** Places per 1 000 young people per comarca, as a lens. Comarcas without centres stay at 0 (darkest step). */
export function fpPlacesLens(data, fp) {
  if (!fp?.by_comarca) return null;
  const vals = Object.values(fp.by_comarca).map((c) => c.places_per_1000).filter(fin).sort((a, b) => a - b);
  const top = vals.length ? Math.max(quantile(vals, 0.95), 50) : 200;
  return stateLens(data, "fp-places", (fips) => fp.by_comarca[fips]?.places_per_1000 ?? null, {
    group: "people", name: "Plazas de FP por 1 000 jóvenes", unit: "plazas por 1 000 jóvenes de 15 a 24 años", format: "float",
    emoji: "🎓", icon: "layers", ramp: FP_RAMP, domain: [0, top], source: "xunta_oferta_fp",
    description: "Plazas de primer curso de Formación Profesional (curso completo ordinario 2026-27, Xunta de Galicia) por cada 1 000 personas de 15 a 24 años de la comarca (padrón, IGE). Los centros cuentan donde están, no donde vive el alumnado: la oferta de una ciudad sirve a su entorno. No incluye modular, dual, acelerada ni semipresencial.",
  });
}
