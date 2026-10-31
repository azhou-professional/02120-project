// Glue: load Python (Pyodide), then on every change ask Python for the state of the sky
// and hand the result to the globe, the sky plot and the readout.
import { createGlobe } from "./globe.js";
import { drawSkyplot } from "./skyplot.js";
import { loadSim } from "./pyloader.js";
import { initMonteCarlo } from "./mc.js";
import { initConstellation } from "./constellation.js";
import { initCompare } from "./compare.js";
import { loadLandMask } from "./earth.js";

const $ = (id) => document.getElementById(id);
const DAY = 86400;

async function loadPython() {
  const pyodide = await loadSim(loadPyodide);   // loadPyodide comes from the <script> tag in index.html
  return pyodide.pyimport("sim.api");
}

const fmt = (x, d = 2) => (x === null ? "–" : x.toFixed(d));

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

const TABS = ["live", "mc", "cs", "tr", "cmp"];

// Side view of the cone-shaped valley: the receiver at the bottom, walls at the blocking angle, the
// hidden part of the sky shaded. Purely a picture; the numbers come from Python.
function drawValley(svg, on, angle) {
  const W = 300, H = 140, cx = W / 2, base = 118, R = 105;
  const a = (on ? angle : 0) * Math.PI / 180;
  const wall = (side) => `${cx},${base} ${cx + side * R * Math.cos(a)},${base - R * Math.sin(a)} ${cx + side * R},${base}`;
  svg.innerHTML =
    `<path d="M ${cx - R} ${base} A ${R} ${R} 0 0 1 ${cx + R} ${base}" fill="none" stroke="#2a3441"/>` +
    (on ? `<polygon points="${wall(-1)}" fill="#ff8a80" fill-opacity="0.18"/><polygon points="${wall(1)}" fill="#ff8a80" fill-opacity="0.18"/>` +
          `<line x1="${cx}" y1="${base}" x2="${cx + R * Math.cos(a)}" y2="${base - R * Math.sin(a)}" stroke="#ff8a80"/>` +
          `<line x1="${cx}" y1="${base}" x2="${cx - R * Math.cos(a)}" y2="${base - R * Math.sin(a)}" stroke="#ff8a80"/>` +
          `<text x="${cx + 36}" y="${base - 6}" fill="#ff8a80" font-size="11">${angle}°</text>` : "") +
    `<line x1="10" y1="${base}" x2="${W - 10}" y2="${base}" stroke="#8b98a8"/>` +
    `<circle cx="${cx}" cy="${base}" r="4" fill="#ff3b30"/>` +
    `<text x="${cx}" y="${H - 4}" fill="#8b98a8" font-size="11" text-anchor="middle">receiver</text>` +
    `<text x="${cx}" y="10" fill="#8b98a8" font-size="11" text-anchor="middle">${on ? "open sky above the walls" : "open sky down to the horizon"}</text>`;
}

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

  // ---- time -------------------------------------------------------------------------------------------
  // t is seconds after the epoch, 2026-01-01 00:00:00 UTC (from Python). The Earth's angle at any t is the
  // Greenwich sidereal time of that date, so the date picker and slider set a real date and time (UTC).
  const epochMs = Date.parse(JSON.parse(api.epoch_info()).epoch_utc);
  const SLIDER_MAX = 1439;                                    // the slider counts minutes: 0 .. 23:59
  const HOLD_START_RATE = 3600, HOLD_MAX_RATE = 30 * DAY;     // holding the slider at an end: 1 h/s, doubling every second, up to 30 days/s
  const timeOfDay = (s) => ((s % DAY) + DAY) % DAY;           // seconds since UTC midnight (also right for t < 0)
  const utc = (s) => new Date(epochMs + s * 1000);
  const dateText = (s) => utc(s).toISOString().slice(0, 10);
  const timeText = (s) => `${dateText(s)} ${utc(s).toISOString().slice(11, 19)} UTC`;
  let pressingSlider = false, hold = 0, holdStart = 0;       // hold = +1 / -1 while the slider is held at its right / left end

  function showTime() {
    $("tlabel").textContent = timeText(t);
    if (hold === 0) $("time").value = Math.floor(timeOfDay(t) / 60);    // while held at an end, the thumb stays there
    if (document.activeElement !== $("date")) $("date").value = dateText(t);
  }

  // While a Monte Carlo run is going, the live view belongs to the run: the time, the receiver and the
  // constellation cannot be changed, and about once a second the view jumps to one of the run's trials.
  function setRunLocked(on) {
    featured = null;
    if (on) { playing = false; $("play").textContent = "Play"; }
    for (const id of ["lat", "lon", "date", "time", "play", "speed", "tr-on"]) $(id).disabled = on;
    $("tr-angle").disabled = $("tr-angle-num").disabled = on || !$("tr-on").checked;
    $("live-lock-note").hidden = !on;
    $("live-lock-note").textContent = "Monte Carlo run in progress: the time and receiver follow its trials.";
    cons.setLocked(on);
    dirty = true;
  }

  function showFeatured(trial) {
    featured = trial;
    t = trial.t;
    $("live-lock-note").textContent = `Monte Carlo trial ${trial.index.toLocaleString()}: ` +
      `latitude ${trial.lat.toFixed(1)}°, longitude ${trial.lon.toFixed(1)}°, ${timeText(t)}.`;
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

  cons = initConstellation(api, { globe, getTime: () => t, onChange: () => { dirty = true; if (mc) mc.refreshWindow(); } });
  cons.addPreset("gps");
  window.app = { api, globe, cons };       // for poking around in the browser console, and for browser tests

  // ---- terrain (Stage 4) ---------------------------------------------------------------------------
  // A cone-shaped valley: one blocking angle in every direction. Python applies it to the live view;
  // the Monte Carlo gets the same angle as its elevation mask.
  const terrainAngle = () => {
    const v = parseFloat($("tr-angle-num").value);
    return $("tr-on").checked && Number.isFinite(v) ? Math.min(80, Math.max(0, v)) : 0;
  };
  function applyTerrain() {
    const on = $("tr-on").checked;
    $("tr-angle").disabled = $("tr-angle-num").disabled = !on;
    const angle = terrainAngle();
    api.set_terrain(on ? JSON.stringify({ type: "cone", angle_deg: angle }) : "null");
    drawValley($("tr-diagram"), on, angle);
    $("tr-msg").textContent = on ? `Satellites below ${angle}° elevation are hidden in every direction.` : "Open sky: every satellite above the horizon can be used.";
    dirty = true;
  }
  $("tr-on").addEventListener("change", applyTerrain);
  $("tr-angle").addEventListener("input", () => { $("tr-angle-num").value = $("tr-angle").value; applyTerrain(); });
  $("tr-angle-num").addEventListener("input", () => { $("tr-angle").value = $("tr-angle-num").value; applyTerrain(); });
  applyTerrain();

  mc = initMonteCarlo(globe, {
    getElements: () => cons.activeElements(), getMaskDeg: terrainAngle, api, onRunState: setRunLocked, onFeatured: showFeatured,
  });
  mc.refreshWindow();
  const compare = await initCompare({ api, globe, mc });
  setupTabs((which) => {
    if (which === "mc") { mc.ensureWorker(); mc.redraw(); }
    if (which === "cmp") compare.redraw();
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

    showTime();
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
  // The slider sets the time of day (UTC) within the current date; Play runs on past midnight. Holding
  // the slider at either end keeps the time going into the next (or previous) days, faster the longer
  // it is held (see frame()). The date picker changes the date and keeps the time of day.
  $("time").addEventListener("pointerdown", () => { pressingSlider = true; });
  const releaseSlider = () => { if (pressingSlider) { pressingSlider = false; hold = 0; dirty = true; } };
  window.addEventListener("pointerup", releaseSlider);
  window.addEventListener("pointercancel", releaseSlider);
  $("time").addEventListener("input", () => {
    const v = parseInt($("time").value, 10);
    if (hold !== 0 && (v >= SLIDER_MAX || v <= 0)) return;     // already running on at an end: ignore small wiggles there
    t = t - timeOfDay(t) + v * 60;
    hold = 0;
    dirty = true;
  });
  $("date").addEventListener("change", () => {
    const ms = Date.parse(`${$("date").value}T00:00:00Z`);
    if (!Number.isFinite(ms)) return;
    t = (ms - epochMs) / 1000 + timeOfDay(t);
    dirty = true;
  });
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
      dirty = true;
    }
    if (pressingSlider && hold === 0) {                    // the slider is being held at one of its ends
      const v = parseInt($("time").value, 10);
      if (v >= SLIDER_MAX || v <= 0) { hold = v >= SLIDER_MAX ? 1 : -1; holdStart = now; }
    }
    if (hold !== 0) {
      const held = (now - holdStart) / 1000;
      const rate = Math.min(HOLD_START_RATE * 2 ** held, HOLD_MAX_RATE);    // simulated seconds per real second
      t += hold * rate * dt;
      dirty = true;
    }
    if (dirty) { dirty = false; refresh(); }
  }
  requestAnimationFrame(frame);
}

main().catch((e) => { $("status").textContent = `Error: ${e.message}`; console.error(e); });
