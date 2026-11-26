// The Almanac: what every number means and exactly where it comes from.
import { resolveTables } from "../terrain.js";
import { esc } from "../format.js";
import { parseHex, luminance } from "../color.js";
import { icon, glyph } from "./icon.js";

const COVER_ICON = { forest_deciduous: "l-forest", forest_evergreen: "l-forest", forest_mixed: "l-forest", cropland: "l-farmland", pasture: "l-farmland", urban: "l-developed" };
// Glyph colour that reads on a resource medallion (dark on light faces such as nuclear yellow or silver).
const inkOn = (hex) => {
  try { return /^#[0-9a-f]{6}$/i.test(hex || "") && luminance(parseHex(hex)) > 0.4 ? "#1c1710" : "#f8f0d8"; } catch { return "#f8f0d8"; }
};
const CATEGORY = { energy: "Energía", mineral: "Minerales", agri: "Agricultura" };
// Internal page keys stay as they are (other modules call pedia.open("Yields")); only the labels are Spanish.
const PAGE_LABEL = { "About this map": "Sobre este mapa", Yields: "Rendimientos", States: "Comarcas", Terrain: "Terreno", Lenses: "Lentes", Resources: "Recursos", Sources: "Fuentes" };

export function initPedia(data) {
  const modal = document.getElementById("pedia");
  const card = modal.querySelector(".modal-card");
  const nav = document.getElementById("pedia-nav");
  const body = document.getElementById("pedia-body");
  const srcName = (id) => data.sources?.find((s) => s.id === id)?.title || id || "";
  let restoreFocus = null;

  const h2 = (ic, fb, text) => `<h2>${icon(ic, fb, { size: 24 })}<span>${esc(text)}</span></h2>`;

  const pages = {
    "About this map": () => `
      ${h2("pedia", "📖", "Sobre este mapa")}
      <p>Esto es la Galicia real, dibujada como un juego de estrategia. No hay nada inventado: cada casilla, ciudad y
      número sale de datos públicos, que se listan en <i>Fuentes</i>.</p>
      <h4>Cómo está hecho</h4>
      <p>Galicia se proyecta (Albers, equivalente en área) y se corta en ${data.world.grid.cols}×${data.world.grid.rows}
      hexágonos, de ${data.world.grid.radius * 2} km de vértice a vértice. Cada hexágono pertenece a la comarca y al concello que
      queda bajo su centro. El terreno sale de muestras de elevación dentro de cada hexágono.</p>
      <p>Las <b>ciudades</b> se colocan en su núcleo principal. Sus números cubren el concello o el área urbana que indica
      la fuente, no solo el casco urbano.</p>
      <h4>Controles</h4>
      <p>Arrastra o usa las flechas / WASD para desplazarte · rueda, +/– o doble clic para el zoom · clic en una ciudad o una comarca para abrirla ·
      / o ⌘K para buscar · L para cambiar de lente · R para mostrar u ocultar recursos · ? para todos los atajos · Esc para cerrar.</p>
      <p>La barra de direcciones siempre lleva un enlace a lo que estás viendo (lente, selección y vista); usa <i>Compartir</i> para copiarlo
      o para descargar una imagen.</p>`,
    Yields: () => `
      ${h2("y-production", "⚙️", "Rendimientos")}
      <p>Los rendimientos de Civilization llevados a medidas reales. Los rendimientos basados en empleo cuentan los <i>residentes</i>
      ocupados en un sector (donde viven, no donde trabajan). <b>El oro es el PIB</b>: la producción de un año, contada donde se hace el trabajo.</p>
      <table>${data.nation.yields.map((y) => `<tr><td class="ic" style="color:${esc(y.color)}">${glyph(y, 26)}</td><td><b style="color:${esc(y.color)}">${esc(y.label)}${y.key === "gold" ? " (PIB)" : ""}</b><br>${esc(y.description)}</td></tr>`).join("")}</table>
      <h4>Paro, renta y PIB</h4>
      <p>Paro registrado = parados registrados ÷ habitantes. No es una tasa de paro, que se mide sobre la población activa.
      La renta es la renta neta media por persona (INE), una media y no una mediana. No hay datos de vivienda.</p>`,
    States: () => `
      ${h2("terrain", "🗺️", "Comarcas")}
      <p>Pulsa cualquier hexágono de tierra sin ciudad para abrir su comarca. Los números de una comarca son los totales y medianas de la comarca
      según las mismas tablas que las ciudades (${esc(data.nation.vintage)}${data.nation.gdp_vintage ? `; PIB de ${esc(data.nation.gdp_vintage)}` : ""}),
      no la suma de sus ciudades, así que también cuenta el medio rural.</p>
      <p>Los <b>puestos</b> ("n.º 3 de 53") comparan las ${data.states?.length || data.world.states.length} comarcas de Galicia; 1 es la mayor.</p>
      <p>Una ciudad cuyo término toca varias comarcas aparece en cada una de ellas, con sus números completos.</p>
      ${data.states ? "" : `<p class="muted">Esta versión de los datos no tiene states.json, así que los paneles de comarca solo muestran nombres y ciudades.</p>`}`,
    Terrain: () => {
      const t = data.w?.tables || resolveTables(data.world.tables);
      const hasCover = Array.isArray(data.world.cover);
      const row = (x) => `<tr><td class="nm">${x.color ? `<span class="swatch" style="background:${esc(x.color)}"></span>` : ""}${
        COVER_ICON[x.key] ? icon(COVER_ICON[x.key], "", { size: 15 }) + " " : ""}<b>${esc(x.name)}</b></td><td>${esc(x.rule || "")}</td></tr>`;
      return `
      ${h2("terrain", "🗺️", "Terreno")}
      <p>Cada hexágono promedia las muestras de elevación que contiene. El relieve sale de la elevación media y de la rugosidad
      (desviación típica) de esas muestras; el sombreado, de las diferencias de elevación con los hexágonos vecinos, con luz desde el
      noroeste.</p>
      <h4>${icon("l-forest", "🌲", { size: 16 })} Cobertura del suelo</h4>
      ${hasCover
        ? `<p>El color base de cada hexágono es su grupo de cobertura dominante: el mayor grupo entre las muestras de tierra que contiene.
           Los símbolos pequeños muestran la mezcla: los árboles crecen con el peso del bosque, y los campos, juncos, matorrales y
           matas de hierba marcan cultivo, humedal, matorral y pastizal.</p>
           <table>${t.cover.filter((x) => x.id > 0).map(row).join("")}</table>`
        : `<p class="muted">Esta versión de los datos aún no tiene capa de cobertura del suelo; la tierra se colorea por elevación.</p>`}
      <h4>Relieve</h4>
      <table>${t.relief.map(row).join("")}</table>
      <h4>${icon("r-hydro", "💧", { size: 16 })} Agua</h4>
      <table>${t.water.filter((x) => x.id > 0).map(row).join("")}</table>
      <h4>Fuera de Galicia</h4>
      <p class="muted">La tierra de fuera de Galicia (Portugal, Asturias, Castilla y León) se dibuja bajo una niebla ligera:
      se muestra como contexto y no se cartografía al detalle.</p>`;
    },
    Lenses: () => `
      ${h2("layers", "▤", "Lentes")}
      <p>Las lentes recolorean el mapa según una medida, construida con datos de concello (${esc(data.lenses.vintage)}). Cada hexágono se muestrea
      en 7 puntos. Un concello que cubre algunos de ellos se supone que cubre esa parte del hexágono. Los concellos pequeños y densos que ningún
      punto toca se añaden al hexágono que contiene su centro. Los valores de renta y similares se promedian entre los concellos de un hexágono,
      ponderados por población.</p>
      <p>La leyenda muestra cuántos hexágonos caen en cada valor. Pasa el ratón o arrastra sobre ella para ver solo ese rango en el mapa.</p>
      ${(data.lenses.groups || [{ id: null, name: "" }]).map((g) => {
        const ls = data.lenses.lenses.filter((l) => !g.id || l.group === g.id);
        if (!ls.length) return "";
        return `${g.name ? `<h3 class="grp">${icon(`g-${g.id}`, "", { size: 16 })} ${esc(g.name)}</h3>` : ""}${ls.map((l) => `
          <div class="lens-entry"><div class="le-ic">${glyph(l, 26)}</div><div>
          <h4>${esc(l.name)}</h4><p>${esc(l.description)}<br>
          <i class="le-ramp" style="background:linear-gradient(90deg, ${(l.ramp || []).map(esc).join(",")})"></i>
          <span class="muted">Escala: ${esc(l.scale)}, ${l.domain[0].toLocaleString("es-ES")}–${l.domain[1].toLocaleString("es-ES")} ${esc(l.unit)}${
            l.higher_is === "good" ? " · más es mejor" : l.higher_is === "bad" ? " · más es peor" : ""}${l.source ? " · " + esc(srcName(l.source)) : ""}</span></p></div></div>`).join("")}`;
      }).join("")}`,
    Resources: () => {
      const r = data.resources;
      if (!r?.types?.length) return `${h2("resources", "⛏️", "Recursos")}<p class="muted">Esta versión de los datos no tiene capa de recursos.</p>`;
      const count = new Map();
      for (const it of r.items || []) count.set(it.type, (count.get(it.type) || 0) + 1);
      const cats = [...new Set(r.types.map((t) => t.category || "other"))];
      return `
      ${h2("resources", "⛏️", "Recursos")}
      <p>Los recursos marcan en sus casillas los parques eólicos, las canteras activas y las lonjas de Galicia.
      Solo se muestran los sitios relevantes: el umbral de cada tipo está en su descripción. Con el zoom alejado, un hexágono muestra su
      recurso de mayor rango; acércate para ver más. Pulsa <b>R</b> para mostrarlos u ocultarlos.</p>
      ${cats.map((c) => `<h4>${esc(CATEGORY[c] || c)}</h4><table class="res-table">
        <tr><th></th><th>Tipo</th><th>Qué cuenta</th><th>Sitios</th></tr>
        ${r.types.filter((t) => (t.category || "other") === c).map((t) => `<tr>
          <td class="ic"><span class="res-ic" style="background:${esc(t.color || "#24384f")};color:${inkOn(t.color)}">${glyph(t, 20)}</span></td>
          <td class="nm"><b>${esc(t.name)}</b>${t.unit ? `<br><span class="muted">valor en ${esc(t.unit)}</span>` : ""}</td>
          <td>${esc(t.description || "")}<br><span class="muted">Fuente: ${esc(srcName(t.source))}</span></td>
          <td class="num">${count.get(t.id) || 0}</td></tr>`).join("")}</table>`).join("")}`;
    },
    Sources: () => `
      ${h2("pedia", "📖", "Fuentes")}
      ${data.sources.map((s) => `
        <h4>${esc(s.title)}</h4>
        <p>${esc(s.description)}<br>
        <span class="muted">${esc(s.publisher)} · ${esc(s.license)}${s.vintage ? " · " + esc(s.vintage) : ""} ·
        <a href="${esc(s.homepage)}" target="_blank" rel="noopener">web</a></span></p>
        <table>${(s.files || []).map((f) => `<tr><td><code>${esc(f.url)}</code></td><td class="muted" style="white-space:nowrap">${esc((f.retrieved || "").slice(0, 10))}<br>${((f.bytes || 0) / 1e6).toFixed(1).replace(".", ",")} MB</td></tr>`).join("")}</table>`).join("")}`,
  };

  const show = (name) => {
    if (!pages[name]) name = "About this map";
    body.innerHTML = pages[name]();
    body.scrollTop = 0;
    nav.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.page === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
  };
  nav.innerHTML = `<div class="hd">Almanaque</div>` + Object.keys(pages).map((p) => `<button data-page="${esc(p)}">${esc(PAGE_LABEL[p] || p)}</button>`).join("");
  nav.onclick = (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) show(b.dataset.page);
  };
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
    restoreFocus = null;
  };
  modal.onclick = (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) close();
  };
  // Keep Tab inside the dialog.
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...card.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  return {
    open(page = "About this map") {
      if (modal.hidden) restoreFocus = document.activeElement;
      show(page);
      modal.hidden = false;
      (nav.querySelector("button.active") || card.querySelector("[data-close]"))?.focus();
    },
    close,
    get isOpen() {
      return !modal.hidden;
    },
  };
}
