// Relieve 3D (D-003): a full-screen WebGL view where every hex is a prism as tall as its elevation times an
// exaggeration factor. This file only adds the top-bar button and the "relief3d" mode; view.js, scene.js and the
// vendored Three.js are imported the first time the view opens, so the map pays nothing until then.
//
// Needs from `app`: w (prepared world), data.lenses; optional: data.states, data.sources, ui.addTopButton, ui.toast,
// registerMode / setMode / mode (Esc then leaves the view through main.js). Exposes app.relief3d for tests.
import { t } from "../../i18n.js";

const MODE = "relief3d";
const TITLE = t("Ver el relieve en 3D, con la altura exagerada");
// A hex prism: top face and the two visible walls.
const GLYPH = '<svg class="r3d-glyph" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.5 14 4.5 8 7.5 2 4.5Z"/>' +
  '<path d="M2 4.5v7L8 14.5l6-3v-7M8 7.5v7"/></svg>';

function loadStyles() {
  const href = new URL("./relief3d.css", import.meta.url).href;
  return new Promise((resolve) => {
    if (document.querySelector(`link[data-ext="${MODE}"]`)) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.ext = MODE;
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

export function install(app) {
  if (!app?.w?.grid || !app.data) throw new Error("relief3d: faltan app.w o app.data");
  const styles = loadStyles();
  let view = null;
  let loading = null;
  let wanted = false;
  const hasModes = typeof app.registerMode === "function" && typeof app.setMode === "function";

  const ensureView = () => {
    loading ??= Promise.all([import("./view.js"), styles])
      .then(([m]) => (view = m.createView(app, { onClose: close })))
      .catch((err) => {
        loading = null;
        throw err;
      });
    return loading;
  };

  // Resolves once the view is on screen (or false if it was closed meanwhile, or could not open).
  let shown = Promise.resolve(false);
  function enter() {
    wanted = true;
    shown = ensureView().then(
      (v) => {
        if (!wanted) return false;
        v.show();
        return true;
      },
      (err) => {
        console.error("relief3d: no se pudo abrir", err);
        app.ui?.toast?.(t("No se pudo abrir el relieve 3D"));
        close();
        return false;
      },
    );
    return shown;
  }
  function exit() {
    wanted = false;
    view?.hide();
  }
  function open() {
    if (hasModes) {
      if (app.mode !== MODE) app.setMode(MODE);
    } else enter();
    return shown;
  }
  function close() {
    if (hasModes) {
      if (app.mode === MODE) app.setMode(null);
    } else exit();
  }

  if (hasModes) app.registerMode(MODE, { enter, exit });

  const inner = `${GLYPH}<span class="lbl">${t("Relieve 3D")}</span><span class="r3d-short" aria-hidden="true">3D</span>`;
  let button = app.ui?.addTopButton?.({ id: "btn-relief3d", label: t("Relieve 3D"), title: TITLE, onClick: open });
  if (!button) {
    // No top bar in this host: a floating button in the corner.
    button = document.createElement("button");
    button.id = "btn-relief3d";
    button.type = "button";
    button.className = "r3d-float";
    button.title = TITLE;
    button.addEventListener("click", open);
    document.body.appendChild(button);
  }
  button.innerHTML = inner;
  button.setAttribute("aria-label", t("Relieve 3D"));

  app.relief3d = {
    open,
    close,
    get isOpen() { return wanted; },
    get view() { return view; },
  };
}
