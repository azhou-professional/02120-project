// Glue: load Python (Pyodide), then on every change ask Python for the state of the sky
// and hand the result to the globe, the sky plot and the readout.
import { createGlobe } from "./globe.js";
import { drawSkyplot, PLANE_COLORS } from "./skyplot.js";
import { loadSim } from "./pyloader.js";
import { initMonteCarlo } from "./mc.js";

const $ = (id) => document.getElementById(id);
const DAY = 86400;

async function loadPython() {
  const pyodide = await loadSim(loadPyodide);   // loadPyodide comes from the <script> tag in index.html
  return pyodide.pyimport("sim.api");
}

const fmt = (x, d = 2) => (x === null ? "–" : x.toFixed(d));

function hms(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

const nf = (x, d) => x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const hmsText = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h} h ${m} min ${sec} s`;
};
const latText = (x) => `${nf(Math.abs(x), 1)}° ${x >= 0 ? "N" : "S"}`;
const lonText = (x) => `${nf(Math.abs(x), 1)}° ${x >= 0 ? "E" : "W"}`;

/** HTML for the satellite hover tooltip; every number comes from Python's snapshot. */
function satelliteInfoHtml(s, i) {
  const [a, inc, raan] = s.elements[i];
  const plane = s.planes[i];
  const rows = [
    ["Orbit radius", `${nf(a, 1)} km (altitude ${nf(a - s.r_earth_km, 1)} km)`],
    ["Inclination", `${nf(inc, 1)}°`],
    ["RAAN (plane)", `${nf(raan, 1)}°`],
    ["Angle along orbit now", `${nf(s.u_deg[i], 1)}° from ascending node`],
    ["Period", hmsText(s.period_s[i])],
    ["Speed", `${nf(s.speed_kms[i], 2)} km/s`],
    ["Point below it", `${latText(s.sat_lat[i])}, ${lonText(s.sat_lon[i])}`],
    ["From the receiver", `elevation ${nf(s.el[i], 1)}°, azimuth ${nf(s.az[i], 1)}°<br>` +
                          (s.visible[i] ? "above the mask: used" : "not used (below the mask)")],
  ];
  return `<div class="name"><span class="dot" style="background:${PLANE_COLORS[plane]}"></span>` +
         `${s.names[i]} <span style="color:var(--muted);font-weight:400">plane ${s.names[i][0]}</span></div>` +
         `<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>`;
}

function setupTabs(onShow) {
  const show = (which) => {
    for (const [name, btn] of [["live", "tab-btn-live"], ["mc", "tab-btn-mc"]]) {
      $(`tab-${name}`).hidden = name !== which;
      $(btn).classList.toggle("active", name === which);
      $(btn).setAttribute("aria-selected", name === which);
    }
    onShow(which);
  };
  $("tab-btn-live").addEventListener("click", () => show("live"));
  $("tab-btn-mc").addEventListener("click", () => show("mc"));
}

async function main() {
  const api = await loadPython();
  $("status").textContent = "Ready.";

  let t = 0, playing = false, dirty = true, last = performance.now();
  let lastSnap = null;
  const hover = { i: -1, x: 0, y: 0 };            // satellite under the mouse (-1 = none)

  function renderTip() {
    const tip = $("sat-tip");
    if (hover.i < 0 || !lastSnap) { tip.hidden = true; return; }
    tip.innerHTML = satelliteInfoHtml(lastSnap, hover.i);   // refreshed every frame, so it follows the playing simulation
    tip.hidden = false;
    const box = $("globe");
    tip.style.left = `${Math.max(4, Math.min(hover.x + 16, box.clientWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(4, Math.min(hover.y + 16, box.clientHeight - tip.offsetHeight - 8))}px`;
  }

  const globe = createGlobe(
    $("globe"),
    (lat, lon) => {
      $("lat").value = lat.toFixed(2);
      $("lon").value = lon.toFixed(2);
      dirty = true;
    },
    (i, x, y) => { Object.assign(hover, { i, x, y }); renderTip(); });
  globe.addRings(JSON.parse(api.orbit_rings()));

  const mc = initMonteCarlo(globe);
  setupTabs((which) => {
    if (which === "mc") { mc.ensureWorker(); mc.redraw(); }
    else dirty = true;                     // the sky plot was skipped while hidden; redraw it
  });

  function refresh() {
    const lat = Math.max(-90, Math.min(90, parseFloat($("lat").value)));
    const lon = parseFloat($("lon").value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const snap = JSON.parse(api.snapshot(lat, lon, t));
    lastSnap = snap;
    globe.update(snap);
    renderTip();
    drawSkyplot($("sky"), snap);

    $("tlabel").textContent = `t = ${hms(t)} after start`;
    $("mask").textContent = snap.mask_deg;
    $("n").textContent = snap.n_visible;
    for (const k of ["gdop", "pdop", "hdop", "vdop", "tdop"]) $(k).textContent = fmt(snap.dop[k]);

    const rows = snap.names
      .map((name, i) => ({ name, az: snap.az[i], el: snap.el[i], vis: snap.visible[i], plane: snap.planes[i] }))
      .filter((s) => s.vis)
      .sort((a, b) => b.el - a.el);
    $("sats").tBodies[0].innerHTML = rows.map((s) =>
      `<tr><td><span class="dot" style="background:${PLANE_COLORS[s.plane]}"></span>${s.name}</td>` +
      `<td>${s.az.toFixed(1)}</td><td>${s.el.toFixed(1)}</td></tr>`).join("");
  }

  for (const id of ["lat", "lon"]) $(id).addEventListener("input", () => { dirty = true; });
  $("time").addEventListener("input", () => { t = parseFloat($("time").value) * 60; dirty = true; });
  $("play").addEventListener("click", () => {
    playing = !playing;
    $("play").textContent = playing ? "Pause" : "Play";
  });
  window.addEventListener("resize", () => { dirty = true; });

  function frame(now) {
    requestAnimationFrame(frame);          // re-arm first, so one error can never stop the loop
    const dt = (now - last) / 1000;
    last = now;
    if (playing) {
      t = (t + dt * parseFloat($("speed").value)) % DAY;
      $("time").value = Math.floor(t / 60);
      dirty = true;
    }
    if (dirty) { dirty = false; refresh(); }
  }
  requestAnimationFrame(frame);
}

main().catch((e) => { $("status").textContent = `Error: ${e.message}`; console.error(e); });
