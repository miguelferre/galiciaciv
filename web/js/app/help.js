// Keyboard & mouse cheat-sheet.
import { icon } from "../ui/icon.js";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = isMac ? "⌘" : "Ctrl";

const ROWS = [
  ["Moverse", [
    [["Arrastrar", "←↑→↓", "WASD"], "Desplazar el mapa"],
    [["Rueda", "+", "–"], "Acercar y alejar"],
    [["Doble clic"], "Acercar a un punto"],
    [["Dos dedos"], "Pellizcar para el zoom, arrastrar para desplazar (táctil)"],
    [["Minimapa"], "Pulsa o arrastra para ir a un punto"],
  ]],
  ["Explorar", [
    [["Clic en ciudad"], "Abrir la ficha de la ciudad"],
    [["Clic en tierra"], "Abrir esa comarca"],
    [["/", `${MOD} K`], "Buscar ciudades y comarcas"],
    [["L", "Shift L"], "Lente siguiente / anterior"],
    [["Leyenda"], "Pasa el ratón o arrastra por la escala para ver solo ese rango"],
    [["R"], "Mostrar u ocultar recursos"],
  ]],
  ["Paneles", [
    [["?"], "Esta ayuda"],
    [["Esc"], "Cierra la ayuda, la búsqueda, el Almanaque y luego el panel"],
  ]],
];

export function initHelp() {
  const modal = document.getElementById("help");
  if (!modal) return { open() {}, close() {}, get isOpen() { return false; } };
  const card = modal.querySelector(".help-card");
  let restore = null;
  card.innerHTML = `
    <button class="icon-btn help-close" data-close aria-label="Cerrar la ayuda">${icon("close", "✕", { size: 13 })}</button>
    <h2 id="help-title">${icon("help", "?", { size: 22 })}<span>Controles</span></h2>
    <div class="help-cols">${ROWS.map(([title, rows]) => `
      <section><h3>${title}</h3>${rows.map(([keys, what]) => `
        <div class="help-row"><span class="keys">${keys.map((k) => `<kbd>${k}</kbd>`).join("")}</span><span>${what}</span></div>`).join("")}
      </section>`).join("")}</div>
    <p class="help-foot">Cada número sale de datos públicos: abre el <b>Almanaque</b> para ver las fuentes.
      El enlace de la barra de direcciones reabre esta misma vista.
      Basado en usaciv de Andrej Karpathy (licencia MIT).</p>`;

  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    if (restore && document.contains(restore)) restore.focus();
    restore = null;
  };
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) close();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault(); // the only focusable control is the close button
    card.querySelector("[data-close]").focus();
  });

  return {
    open() {
      if (!modal.hidden) return;
      restore = document.activeElement;
      modal.hidden = false;
      card.querySelector("[data-close]").focus();
    },
    close,
    toggle() { modal.hidden ? this.open() : close(); },
    get isOpen() { return !modal.hidden; },
  };
}
