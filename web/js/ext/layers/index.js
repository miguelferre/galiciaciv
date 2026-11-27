// Map-art extension: tile improvements (autovías and main roads, railway, ports, airports), wonders and protected
// land, and the largest daily mobility flows ("trade routes"), each as a static layer drawn into the cached map
// (nothing animates; an idle map draws no frames), with a switch in the "Mapa" menu.
//
// Data: infrastructure.json, wonders.json and trade.json (loaded eagerly by main.js right after the first frame;
// app.loadData returns the same promise). A missing file (null) leaves its layers off and their switches harmless.
// galiciaciv has no military.json (no open data, D-002): there is no switch for it and its layers stay empty.
// Defaults: roads, rail, ports & airports and wonders on (see each layer's minRpx), trade routes and Camino de Santiago off.
import { createModel } from "./model.js";
import { makeLayers } from "./layers.js";
import { tips } from "./tips.js";

const TOGGLES = [
  { id: "roads", label: "Carreteras", icon: "t-road", def: true, title: "Autopistas, autovías y vías rápidas (OpenStreetMap, como dibujo del mapa)", layers: ["roads"] },
  { id: "rail", label: "Ferrocarril", icon: "t-rail", def: true, title: "Líneas de tren, incluida la alta velocidad (OpenStreetMap, como dibujo del mapa)", layers: ["rail"] },
  { id: "hubs", label: "Puertos y aeropuertos", icon: "d-harbor", def: true, title: "Puertos de interés general y aeropuertos de Galicia (sin cifras de tráfico)", layers: ["hubs"] },
  { id: "wonders", label: "Maravillas", icon: "w-landmark", def: true, title: "Patrimonio Mundial, monumentos BIC y parque nacional", layers: ["wonders", "protected", "plates"] },
  { id: "trade", label: "Comercio y movilidad", icon: "t-trade", def: false, title: "Los mayores flujos diarios de viajes entre comarcas (MITMA)", layers: ["trade"] },
  { id: "camino", label: "Camino de Santiago", icon: "t-road", def: false, title: "Trazado de los Caminos de Santiago en Galicia (IGN-CNIG, datos de la FEAACS), como ayuda a la marcha", layers: ["camino"] },
  { id: "fp", label: "Centros de FP", icon: "FP", def: false, title: "Centros con oferta de Formación Profesional 2026-27 (Xunta de Galicia) y proyectos industriales estratégicos (PIE)", layers: ["fp"] },
];

export function install(app) {
  const model = createModel(app.w);
  const on = Object.fromEntries(TOGGLES.map((t) => [t.id, t.def]));
  const layers = makeLayers(model, on, { tips, app });
  for (const l of layers) app.registerStaticLayer(l);

  const apply = (name, data) => {
    model.setData(name, data);
    app.requestDraw();
  };
  const load = (name) => {
    if (app.data[name] !== undefined) apply(name, app.data[name]);
    else app.loadData(name).then((d) => apply(name, d), (err) => console.warn(`map layers: ${name} failed to load`, err));
  };
  for (const t of TOGGLES) {
    app.ui.addMapToggle({
      id: t.id, label: t.label, icon: t.icon, title: t.title, default: t.def,
      get: () => on[t.id],
      set: (v) => {
        on[t.id] = !!v;
        if (t.id === "camino" && on.camino && !model.camino) load("camino");
        if (t.id === "fp" && on.fp && !model.fp) load("fp");
        app.requestDraw();
      },
    });
  }

  for (const name of ["infrastructure", "wonders", "trade"]) load(name);
  // camino.json is fetched only when the Camino de Santiago switch is first turned on (or an advisor already loaded it).

  if (app.data.camino) apply("camino", app.data.camino);
  // fp.json: fetched when the switch is first turned on (or an advisor already loaded it). A shared link with layers=fp turns it on after this.
  if (app.data.fp) apply("fp", app.data.fp);
  app.on?.("data", ({ name, data }) => { if (name === "fp" && data && !model.fp) apply("fp", data); });

  // For debugging and the gallery: the model and switches.
  app.mapArt = { model, on, layers };
}
