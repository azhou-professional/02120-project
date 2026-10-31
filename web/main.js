// Glue: load Python (Pyodide), then on every change ask Python for the state of the sky
// and hand the result to the globe, the sky plot and the readout.
import { createGlobe } from "./globe.js";
import { drawSkyplot } from "./skyplot.js";
import { loadSim } from "./pyloader.js";
import { initMonteCarlo } from "./mc.js";
import { initConstellation } from "./constellation.js";
import { loadLandMask } from "./earth.js";

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
  const [a, ecc, inc, raan, argp] = s.elements[i];
  const circular = ecc === 0;
  const rows = [
    circular
      ? ["Orbit radius", `${nf(a, 1)} km (altitude ${nf(a - s.r_earth_km, 1)} km)`]
      : ["Semi-major axis", `${nf(a, 1)} km, eccentricity ${nf(ecc, 3)}`],
    ...(circular ? [] : [
      ["Perigee / apogee", `${nf(s.perigee_alt_km[i], 0)} km / ${nf(s.apogee_alt_km[i], 0)} km altitude`],
      ["Arg. of perigee", `${nf(argp, 1)}°`],
      ["Altitude now", `${nf(s.radius_km[i] - s.r_earth_km, 0)} km`]]),
    ["Inclination", `${nf(inc, 1)}°`],
    ["RAAN (plane)", `${nf(raan, 1)}°`],
    ["Angle along orbit now", `${nf(s.u_deg[i], 1)}° from ascending node`],
    ["Period", hmsText(s.period_s[i])],
    ["Speed", `${nf(s.speed_kms[i], 2)} km/s`],
    ["Point below it", `${latText(s.sat_lat[i])}, ${lonText(s.sat_lon[i])}`],
    ["From the receiver", `elevation ${nf(s.el[i], 1)}°, azimuth ${nf(s.az[i], 1)}°<br>` +
                          (!s.enabled[i] ? "switched off: ignored" : s.visible[i] ? "above the mask: used" : "not used (below the mask)")],
  ];
  return `<div class="name"><span class="dot" style="background:${s.colors[i]}"></span>` +
         `${s.labels[i]} <span style="color:var(--muted);font-weight:400">${s.groupLabels[i]}</span></div>` +
         `<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>` +
         `<div style="color:var(--muted);margin-top:4px">Click to switch ${s.enabled[i] ? "off" : "on"}</div>`;
}

const TABS = ["live", "mc", "cs"];

function setupTabs(onShow) {
  const show = (which) => {
    for (const name of TABS) {
      $(`tab-${name}`).hidden = name !== which;
      $(`tab-btn-${name}`).classList.toggle("active", name === which);
      $(`tab-btn-${name}`).setAttribute("aria-selected", name === which);
    }
    onShow(which);
  };
  for (const name of TABS) $(`tab-btn-${name}`).addEventListener("click", () => show(name));
}

async function main() {
  const api = await loadPython();
  const land = await loadLandMask("data/land_mask.json").catch((e) => { console.warn("no land grid:", e); return null; });
  $("status").textContent = "Ready.";

  let t = 0, playing = false, dirty = true, last = performance.now();
  let lastSnap = null;
  const hover = { i: -1, x: 0, y: 0 };            // satellite under the mouse (-1 = none)
  let cons, mc;                                   // the constellation and the Monte Carlo (set up once the globe exists)
  let featured = null;                            // during a Monte Carlo run: the trial {lat, lon, t} the live view shows

  // While a Monte Carlo run is going, the live view belongs to the run: the time, the receiver and the
  // constellation cannot be changed, and about once a second the view jumps to one of the run's trials.
  function setRunLocked(on) {
    featured = null;
    if (on) { playing = false; $("play").textContent = "Play"; }
    for (const id of ["lat", "lon", "time", "play", "speed"]) $(id).disabled = on;
    $("live-lock-note").hidden = !on;
    $("live-lock-note").textContent = "Monte Carlo run in progress: the time and receiver follow its trials.";
    cons.setLocked(on);
    dirty = true;
  }

  function showFeatured(trial) {
    featured = trial;
    t = trial.t;
    $("time").value = Math.floor((t % DAY) / 60);
    $("live-lock-note").textContent = `Monte Carlo trial ${trial.index.toLocaleString()}: ` +
      `latitude ${trial.lat.toFixed(1)}°, longitude ${trial.lon.toFixed(1)}°, day ${Math.floor(t / DAY)}.`;
    dirty = true;
  }

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
    (i, x, y) => { Object.assign(hover, { i, x, y }); renderTip(); },
    land,
    (i) => cons.toggleSat(i));

  cons = initConstellation(api, { globe, onChange: () => { dirty = true; if (mc) mc.refreshWindow(); } });
  cons.addPreset("gps");
  window.app = { api, globe, cons };       // for poking around in the browser console, and for browser tests

  mc = initMonteCarlo(globe, {
    getElements: () => cons.activeElements(), api, onRunState: setRunLocked, onFeatured: showFeatured,
  });
  mc.refreshWindow();
  setupTabs((which) => {
    if (which === "mc") { mc.ensureWorker(); mc.redraw(); }
    if (which === "live") dirty = true;    // the sky plot was skipped while hidden; redraw it
  });

  function refresh() {
    const lat = featured ? featured.lat : Math.max(-90, Math.min(90, parseFloat($("lat").value)));
    const lon = featured ? featured.lon : parseFloat($("lon").value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const snap = cons.decorate(JSON.parse(api.snapshot(lat, lon, t)));   // add labels and colours
    lastSnap = snap;
    globe.update(snap);
    renderTip();
    drawSkyplot($("sky"), snap);

    $("tlabel").textContent = `Day ${Math.floor(t / DAY)}  ${hms(t % DAY)}`;
    $("mask").textContent = snap.mask_deg;
    $("n").textContent = snap.n_visible;
    for (const k of ["gdop", "pdop", "hdop", "vdop", "tdop"]) $(k).textContent = fmt(snap.dop[k]);

    const rows = snap.labels
      .map((name, i) => ({ name, az: snap.az[i], el: snap.el[i], vis: snap.visible[i], color: snap.colors[i] }))
      .filter((s) => s.vis)
      .sort((a, b) => b.el - a.el);
    $("sats").tBodies[0].innerHTML = rows.map((s) =>
      `<tr><td><span class="dot" style="background:${s.color}"></span>${s.name}</td>` +
      `<td>${s.az.toFixed(1)}</td><td>${s.el.toFixed(1)}</td></tr>`).join("");
  }

  for (const id of ["lat", "lon"]) $(id).addEventListener("input", () => { dirty = true; });
  // The slider sets the time of day within the current day; Play runs on past midnight (the Earth
  // does not rotate 360 degrees in exactly 24 h, so wrapping would make it jump).
  $("time").addEventListener("input", () => { t = Math.floor(t / DAY) * DAY + parseFloat($("time").value) * 60; dirty = true; });
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
      t += dt * parseFloat($("speed").value);
      $("time").value = Math.floor((t % DAY) / 60);
      dirty = true;
    }
    if (dirty) { dirty = false; refresh(); }
  }
  requestAnimationFrame(frame);
}

main().catch((e) => { $("status").textContent = `Error: ${e.message}`; console.error(e); });
