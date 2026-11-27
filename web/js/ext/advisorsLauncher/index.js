// Advisors launcher: the list of advisors on the map itself, with one real figure, so a new visitor sees what is
// inside without finding the top-bar button first.
//
//   desktop: a panel at the top left, one row per advisor and the latest year of burned area under it
//   phones (≤700 px): a card above the lens dock with the same figure and a row of medallions that opens the council
//   hidden while any mode is open (advisors, city view, 3D relief)
//
// Needs the "advisors" extension (app.advisors.list / open): install it after that one. The list comes from
// app.advisors.list, so a new advisor appears here on its own.
import { emblem } from "../advisors/core/emblems.js";
import { int } from "../advisors/core/fmt.js";
import { esc, el } from "../advisors/core/util.js";

// Reading order; an advisor missing from this list goes just before the Explorer.
const ORDER = ["economy", "prosperity", "commerce", "energy", "people", "knowledge", "fp", "culture", "land"];
const FACES = ["economy", "culture", "land", "people", "commerce"]; // the medallions on the phone card
const WORDS = { 9: "Nueve", 10: "Diez", 11: "Once", 12: "Doce" };
const PHONE = "(max-width: 700px)";

function injectCss() {
  if (document.getElementById("launcher-css")) return;
  const l = document.createElement("link");
  l.id = "launcher-css";
  l.rel = "stylesheet";
  l.href = new URL("../../../css/launcher.css", import.meta.url).href;
  return new Promise((resolve) => {
    l.onload = l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

const rank = (a) => (a.id === "explorer" ? ORDER.length + 1 : ORDER.includes(a.id) ? ORDER.indexOf(a.id) : ORDER.length);

export async function install(app) {
  if (!app.advisors?.list?.length) throw new Error("advisorsLauncher: falta la extensión advisors");
  await injectCss();
  const list = [...app.advisors.list].sort((a, b) => rank(a) - rank(b));
  const byId = new Map(list.map((a) => [a.id, a]));
  const land = byId.get("land");
  const faces = FACES.map((id) => byId.get(id)).filter(Boolean);

  const nav = el("nav", "panel");
  nav.id = "adv-launcher";
  nav.setAttribute("aria-label", "Asesores");
  nav.innerHTML = `
    <div class="al-head"><h2>Asesores</h2><p>${WORDS[list.length] || list.length} formas de leer Galicia</p></div>
    <ul class="al-list">${list.map((a) => `<li><button type="button" data-adv="${a.id}" title="${esc(a.blurb)}">${emblem(a, 30)}<span>${esc(a.name)}</span></button></li>`).join("")}</ul>
    <div class="al-find" hidden></div>
    <button type="button" class="al-all" data-adv="council" aria-label="Ver los ${list.length} asesores">
      <span class="al-faces">${faces.map((a) => emblem(a, 28)).join("")}</span><b>${list.length} asesores</b><span class="al-go" aria-hidden="true">›</span></button>`;
  const find = nav.querySelector(".al-find");

  // --- the figure: burned area in the latest year of the series --------------------------------------------------
  let year = null;
  function drawFinding(fires) {
    if (!land || !fires?.years?.length || !fires.by_year?.length) return;
    const ha = fires.by_year.map((y) => y.ha);
    const last = fires.years.length - 1;
    const top = ha.indexOf(Math.max(...ha));
    const first = fires.years[0];
    year = fires.years[last];
    const long = top === last
      ? `quemadas en ${year}, el máximo de la serie ${first}-${year}.`
      : `quemadas en ${year}. El máximo de ${first}-${year}: ${int(ha[top])} ha en ${fires.years[top]}.`;
    const short = top === last ? `quemadas en ${year}, máximo desde ${first}` : `quemadas en ${year}`;
    find.innerHTML = `
      <span class="al-mark">${emblem(land, 40)}</span>
      <p class="al-fig">${int(ha[last])} ha</p>
      <p class="al-txt"><span class="al-long">${long}</span><span class="al-short">${short}</span></p>
      <p class="al-src">Fuente: EFFIS, desde unas 30 ha</p>
      <button type="button" class="al-cta" data-fires><span class="al-long">Ver los incendios</span><span class="al-short" aria-hidden="true">Ver</span></button>`;
    find.querySelector("[data-fires]").setAttribute("aria-label", `Ver los incendios de ${year} en Territorio`);
    find.hidden = false;
    fit();
  }

  /** Open Territory, pick that year with the section's own slider (so the view restores the map's lens when it
   *  closes) and bring the section into view. The panel is built after its data arrives and the charts above can
   *  still grow for a moment: wait for the slider, then correct the position until it holds. A wheel, touch or key
   *  from the visitor ends it. */
  let timer = 0, stop = () => {};
  function showFires() {
    if (!year) return;
    stop();
    app.advisors.open("land");
    let tries = 0, steady = 0, picked = false;
    const EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];
    stop = () => {
      clearInterval(timer);
      for (const n of EVENTS) removeEventListener(n, stop, true);
    };
    setTimeout(() => { for (const n of EVENTS) addEventListener(n, stop, true); }, 0);
    timer = setInterval(() => {
      if (++tries > 60 || app.advisors.current !== "land") return stop();
      const dock = document.querySelector(".adv-dock");
      const box = dock?.querySelector(".adv-fireyears");
      const range = box?.querySelector("input[type=range]");
      if (!range) return;
      if (!picked) {
        picked = true;
        range.value = String(year);
        range.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const title = box.previousElementSibling?.previousElementSibling || box; // the h4 above the note above the box
      const head = dock.querySelector(".adv-head")?.offsetHeight || 0;
      const delta = title.getBoundingClientRect().top - dock.getBoundingClientRect().top - head - 10;
      if (Math.abs(delta) > 2) { steady = 0; dock.scrollTop += delta; }
      else if (++steady >= 5) stop();
    }, 150);
  }

  nav.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-fires")) return showFires();
    const id = b.dataset.adv;
    if (id) app.advisors.open(id === "council" ? null : id);
  });

  // --- placement ------------------------------------------------------------------------------------------------
  const phone = matchMedia(PHONE);
  // Short screens: tighter rows and no figure, so the list ends above the minimap (it scrolls if even that is too
  // tall). Phones: the card must clear the round minimap button.
  function fit() {
    nav.classList.remove("al-compact");
    nav.style.removeProperty("--al-max"); // measure the natural height, not the last limit
    nav.style.marginBottom = "";
    if (nav.hidden) return;
    if (phone.matches) {
      const r = nav.getBoundingClientRect(), t = document.getElementById("btn-minimap")?.getBoundingClientRect();
      if (r.height && t?.height && r.bottom > t.top - 6 && r.top < t.bottom) nav.style.marginBottom = `${Math.ceil(r.bottom - t.top + 6)}px`;
      return;
    }
    const mini = document.getElementById("minimap-wrap")?.getBoundingClientRect();
    const limit = mini?.height ? mini.top - 8 : innerHeight - 12;
    if (nav.getBoundingClientRect().bottom > limit) nav.classList.add("al-compact");
    nav.style.setProperty("--al-max", `${Math.max(160, Math.floor(limit - nav.getBoundingClientRect().top))}px`);
  }
  // On phones the card is part of the bottom stack (legend, credits, lens dock), so it never covers any of them.
  function place() {
    const host = phone.matches ? document.getElementById("lens-area") : document.body;
    if (nav.parentElement !== host) host.appendChild(nav);
    fit();
  }
  function sync() {
    nav.hidden = !!app.mode;
    fit();
  }
  nav.hidden = !!app.mode;
  place();
  phone.addEventListener("change", place);
  app.on("mode", sync);
  // The minimap, the legend and the credits get their size after this runs and change later: follow them.
  let raf = 0;
  const refit = () => { raf ||= requestAnimationFrame(() => { raf = 0; fit(); }); };
  addEventListener("resize", refit);
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(refit);
    for (const id of ["minimap-wrap", "legend", "credits"]) { const n = document.getElementById(id); if (n) ro.observe(n); }
  }

  app.loadData("fires").then(drawFinding).catch((err) => console.info(`advisorsLauncher: sin la cifra de incendios (${err.message || err})`));
}
