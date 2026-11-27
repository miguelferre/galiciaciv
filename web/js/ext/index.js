// Extension loader. Each entry is a folder under web/js/ext/ whose index.js exports install(app) (sync or async).
// `app` is the API object built in main.js (also window.__app). A missing folder is fine: it is reported with
// console.info and skipped, so an extension can be left out without breaking the app. A failing install() is logged
// as an error and does not stop the others. Modules are fetched in parallel and installed in list order.
// layers/: static map layers (roads, rail, ports, forts, wonders, trade routes) and their toggles.
const ALL = {
  cityView: "./cityView/index.js", // City view (districts, citizens, figures): districts, citizens and counties JSON
  advisors: "./advisors/index.js", // the advisor dashboards: counties, districts, citizens and trade JSON
  layers: "./layers/index.js", // roads, rail, ports, wonders, trade routes: infrastructure, wonders and trade JSON
  relief3d: "./relief3d/index.js", // full-screen 3D relief (D-003): world.json, lenses.json and relief3d_detalle.bin
  advisorsLauncher: "./advisorsLauncher/index.js", // the advisors' entry on the map itself; needs advisors and fires.json
};
// galiciaciv (D-002, D-003): every extension has its data since tanda 3. There is no military data, so no military
// layer or advisor. Order matters: each one adds its top-bar button as it installs.
export const ENABLED = ["layers", "cityView", "advisors", "advisorsLauncher", "relief3d"];
export const isEnabled = (name) => ENABLED.includes(name);
const MODULES = ENABLED.map((name) => ALL[name]).filter(Boolean);

export async function installExtensions(app, list = MODULES) {
  const loads = list.map((spec) => import(spec).then((m) => ({ m }), (err) => ({ err })));
  const installed = [];
  for (let k = 0; k < list.length; k++) {
    const spec = list[k];
    const { m, err } = await loads[k];
    if (err) {
      console.info(`extension ${spec} not loaded (${err.message || err})`);
      continue;
    }
    if (typeof m.install !== "function") {
      console.info(`extension ${spec} has no install(app); skipped`);
      continue;
    }
    try {
      await m.install(app);
      installed.push(spec);
    } catch (e) {
      console.error(`extension ${spec} failed to install`, e);
    }
  }
  app.extensions = installed;
  app.emit?.("extensions", installed);
  return installed;
}
