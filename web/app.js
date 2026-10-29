// Globe + GPS satellites with UI. Scene units: 1 unit = 1 Earth radius.
// Three.js is y-up, physics is z-up, so physics (x, y, z) is drawn at (x, z, -y).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { R_E, GM, nominalConstellation, satPosition, periodOf } from "./orbit.js";
import { monteCarlo } from "./dop.js";

const TIME_SCALE = 600; // simulated seconds per real second (one GPS orbit ~ 72 s)
const PLANE_COLORS = [0xff6b6b, 0xffb84d, 0xf7e15a, 0x5ad18a, 0x4dabff, 0xb08cff];
const USER_COLOR = 0xffffff;
const PICK_RADIUS = 14; // px: how close the pointer must be to a satellite to hover it

const $ = (id) => document.getElementById(id);
const toScene = ([x, y, z]) => new THREE.Vector3(x / R_E, z / R_E, -y / R_E);
const colorOf = (sat) => PLANE_COLORS[sat.plane] ?? USER_COLOR;
const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const deg = (r) => (r * 180) / Math.PI;

// ---------- Scene: camera, globe, grid ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(4, 2.5, 8);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 30;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(5, 3, 4);
scene.add(sun);
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 48),
  new THREE.MeshStandardMaterial({ color: 0x1d4e89, roughness: 0.9 })
));
const gridMat = new THREE.LineBasicMaterial({ color: 0x8fb8e8, transparent: true, opacity: 0.45 });
const gridLine = (pts) => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
for (let lat = -60; lat <= 60; lat += 30) { // lat/lon grid every 30 degrees
  const pts = [], r = Math.cos((lat * Math.PI) / 180), y = Math.sin((lat * Math.PI) / 180);
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * 2 * Math.PI;
    pts.push(new THREE.Vector3(1.002 * r * Math.cos(a), 1.002 * y, 1.002 * r * Math.sin(a)));
  }
  gridLine(pts);
}
for (let lon = 0; lon < 180; lon += 30) {
  const pts = [], a = (lon * Math.PI) / 180;
  for (let i = 0; i <= 128; i++) {
    const p = (i / 128) * 2 * Math.PI;
    pts.push(new THREE.Vector3(1.002 * Math.cos(p) * Math.cos(a), 1.002 * Math.sin(p), 1.002 * Math.cos(p) * Math.sin(a)));
  }
  gridLine(pts);
}

// ---------- Satellites (each has a sphere and an orbit line) ----------
const entries = []; // { sat, mesh, line }
let userCount = 0;

function addSatellite(sat) {
  const color = colorOf(sat);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color }));
  const pts = [];
  for (let i = 0; i <= 256; i++) pts.push(toScene(satPosition(sat, (i / 256) * periodOf(sat))));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
  );
  scene.add(mesh, line);
  entries.push({ sat, mesh, line });
}

function removeSatellite(entry) {
  for (const o of [entry.mesh, entry.line]) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  entries.splice(entries.indexOf(entry), 1);
  if (hovered === entry) hideTooltip();
  refreshList();
}

function setConstellation(sats) {
  [...entries].forEach(removeSatellite);
  sats.forEach(addSatellite);
  refreshList();
}

// ---------- Side panel: counter, list, add form, pause ----------
let playing = true, simT = 0;
$("playpause").onclick = () => {
  playing = !playing;
  $("playpause").textContent = playing ? "Pause" : "Play";
};

function refreshList() {
  $("count").textContent = entries.length;
  const ul = $("list");
  ul.replaceChildren();
  for (const entry of entries) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = hex(colorOf(entry.sat));
    label.append(dot, entry.sat.name);
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.title = "Remove " + entry.sat.name;
    btn.onclick = () => removeSatellite(entry);
    li.append(label, btn);
    ul.append(li);
  }
}

$("add-btn").onclick = () => {
  const alt = parseFloat($("add-alt").value), inc = parseFloat($("add-inc").value);
  const raan = parseFloat($("add-raan").value), phase = parseFloat($("add-phase").value);
  const err = $("add-err");
  if (![alt, inc, raan, phase].every(Number.isFinite)) return void (err.textContent = "Enter a number in every field.");
  if (alt < 200) return void (err.textContent = "Altitude must be at least 200 km.");
  if (inc < 0 || inc > 180) return void (err.textContent = "Inclination must be between 0 and 180 degrees.");
  err.textContent = "";
  userCount++;
  addSatellite({
    name: `User-${userCount}`, plane: -1, a: R_E + alt * 1e3,
    inc: (inc * Math.PI) / 180, raan: (raan * Math.PI) / 180, u0: (phase * Math.PI) / 180,
  });
  refreshList();
};
$("reset-btn").onclick = () => { userCount = 0; setConstellation(nominalConstellation()); };
$("clear-btn").onclick = () => setConstellation([]);

// ---------- Monte Carlo DOP ----------
$("mc-run").onclick = () => {
  const maskDeg = parseFloat($("mc-mask").value), n = Math.round(parseFloat($("mc-n").value));
  const out = $("mc-out"), btn = $("mc-run");
  if (!(maskDeg >= 0 && maskDeg <= 89) || !(n >= 100 && n <= 200000)) {
    out.textContent = "Mask must be 0-89 degrees and samples 100-200000.";
    return;
  }
  btn.disabled = true;
  out.textContent = "Running...";
  setTimeout(() => { // let the "Running..." text paint first
    showResults(monteCarlo(entries.map((e) => e.sat), { n, maskDeg }));
    btn.disabled = false;
  }, 20);
};

function showResults(r) {
  const pct = (x) => (100 * x).toFixed(2) + "%";
  const num = (x) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
  const rows = [
    ["Mean visible", `${r.meanVis.toFixed(2)} (${r.minVis}–${r.maxVis})`],
    ["P(≥ 4 visible)", pct(r.pGe4)],
    [`P(PDOP ≤ ${r.pdopLimit})`, pct(r.pGood)],
    ["Median PDOP", num(r.medPdop)],
    ["Median GDOP", num(r.medGdop)],
  ];
  const out = $("mc-out");
  out.replaceChildren();
  const caption = document.createElement("div");
  caption.className = "hist-title";
  caption.textContent = `${r.nSats} satellites, ${r.n} samples, ${r.maskDeg}° mask`;
  const table = document.createElement("table");
  for (const [k, v] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
  const hist = document.createElement("div");
  hist.className = "hist";
  const top = Math.max(...r.hist) || 1;
  r.hist.forEach((f, k) => {
    const col = document.createElement("div"), bar = document.createElement("span");
    bar.style.height = `${(48 * f) / top}px`;
    col.title = `${k} visible: ${pct(f)}`;
    col.append(bar, String(k));
    hist.append(col);
  });
  const histTitle = document.createElement("div");
  histTitle.className = "hist-title";
  histTitle.textContent = "Fraction of samples by number of visible satellites";
  out.append(caption, table, histTitle, hist);
}

// ---------- Hover: orbit info tooltip with a remove button ----------
let hovered = null, hideTimer = null;
const tooltip = $("tooltip");

// True if the straight line camera -> satellite passes through the Earth.
function occluded(p) {
  const c = camera.position, d = p.clone().sub(c);
  const s = Math.min(1, Math.max(0, -c.dot(d) / d.lengthSq()));
  return c.clone().addScaledVector(d, s).length() < 1;
}

// Nearest visible satellite to the pointer, in screen pixels.
function pick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  let best = null, bestD = PICK_RADIUS;
  for (const e of entries) {
    const v = e.mesh.position.clone().project(camera);
    if (v.z > 1 || occluded(e.mesh.position)) continue;
    const d = Math.hypot(ev.clientX - (rect.left + ((v.x + 1) / 2) * rect.width),
                         ev.clientY - (rect.top + ((1 - v.y) / 2) * rect.height));
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

function onPointer(ev) {
  const e = pick(ev);
  renderer.domElement.style.cursor = e ? "pointer" : "";
  if (!e) return scheduleHide();
  clearTimeout(hideTimer);
  hideTimer = null;
  if (e !== hovered) {
    hovered = e;
    tooltip.hidden = false;
    // Anchor next to the pointer, kept on screen. It stays put while the satellite moves on.
    tooltip.style.left = Math.min(ev.clientX + 16, innerWidth - 240) + "px";
    tooltip.style.top = Math.min(ev.clientY + 16, innerHeight - 220) + "px";
    updateTooltip();
  }
}
// Small delay so the pointer can travel from the satellite onto the tooltip's remove button.
function scheduleHide() {
  if (hovered && !hideTimer) hideTimer = setTimeout(hideTooltip, 400);
}
function hideTooltip() {
  clearTimeout(hideTimer);
  hideTimer = null;
  hovered = null;
  tooltip.hidden = true;
}
renderer.domElement.addEventListener("pointermove", onPointer);
renderer.domElement.addEventListener("pointerdown", onPointer); // tap on touch screens
renderer.domElement.addEventListener("pointerleave", scheduleHide);
tooltip.addEventListener("pointerenter", () => { clearTimeout(hideTimer); hideTimer = null; });
tooltip.addEventListener("pointerleave", scheduleHide);
$("tt-remove").onclick = () => hovered && removeSatellite(hovered);

function updateTooltip() {
  const s = hovered.sat, p = satPosition(s, simT);
  const u = ((2 * Math.PI * simT) / periodOf(s) + s.u0) % (2 * Math.PI);
  const rows = [
    ["Altitude", `${((s.a - R_E) / 1e3).toFixed(0)} km`],
    ["Orbit radius", `${(s.a / 1e3).toFixed(0)} km`],
    ["Inclination", `${deg(s.inc).toFixed(1)}°`],
    ["RAAN", `${deg(s.raan).toFixed(1)}°`],
    ["Eccentricity", "0 (circular)"],
    ["Period", `${(periodOf(s) / 3600).toFixed(2)} h`],
    ["Speed", `${(Math.sqrt(GM / s.a) / 1e3).toFixed(2)} km/s`],
    ["Phase now", `${deg(u).toFixed(1)}°`],
    ["Latitude now", `${deg(Math.asin(p[2] / s.a)).toFixed(1)}°`],
  ];
  $("tt-name").textContent = s.name;
  $("tt-body").replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    return [dt, dd];
  }));
}

// ---------- Main loop ----------
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

setConstellation(nominalConstellation());

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (playing) simT += dt * TIME_SCALE;
  for (const e of entries) {
    e.mesh.position.copy(toScene(satPosition(e.sat, simT)));
    e.mesh.scale.setScalar(e === hovered ? 1.8 : 1);
  }
  if (hovered) updateTooltip();
  controls.update();
  renderer.render(scene, camera);
});
