// Globe + GPS satellites with UI. Scene units: 1 unit = 1 Earth radius.
// Three.js is y-up, physics is z-up, so physics (x, y, z) is drawn at (x, z, -y).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { R_E, GM, nominalConstellation, satPosition, periodOf } from "./orbit.js";
import { monteCarlo, dopFromUnits } from "./dop.js";
import { isLand, isDesert } from "./earth.js";

const TIME_SCALE = 600; // simulated seconds per real second (one GPS orbit ~ 72 s)
const PLANE_COLORS = [0xff6b6b, 0xffb84d, 0xf7e15a, 0x5ad18a, 0x4dabff, 0xb08cff];
const USER_COLOR = 0xffffff;
const PICK_RADIUS = 14; // px: how close the pointer must be to a satellite to hover it
const RECEIVER = { name: "Pittsburgh", lat: 40.44, lon: -79.94 }; // fixed point on the (non-rotating) Earth

const $ = (id) => document.getElementById(id);
const toScene = ([x, y, z]) => new THREE.Vector3(x / R_E, z / R_E, -y / R_E);
const toSceneDir = ([x, y, z]) => new THREE.Vector3(x, z, -y);
const colorOf = (sat) => PLANE_COLORS[sat.plane] ?? USER_COLOR;
const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// ---------- Scene: camera, lights, stars ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);
camera.position.set(5, 3.2, 10.5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 30;

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(5, 3, 4);
scene.add(sun);

const starPts = [];
for (let i = 0; i < 500; i++) {
  const v = new THREE.Vector3().randomDirection().multiplyScalar(150);
  starPts.push(v.x, v.y, v.z);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaab8d0, size: 0.5, sizeAttenuation: false })));

// ---------- Low-poly Earth: icosphere, each triangle coloured by the land map in earth.js ----------
function faceColor(latDeg, lonDeg, i, out) {
  const jitter = 0.9 + 0.2 * Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1); // pseudo-random brightness per face
  const a = Math.abs(latDeg);
  let c;
  if (isLand(latDeg, lonDeg)) {
    if (a > 68) c = 0xeef3f7;           // snow and ice
    else if (isDesert(latDeg, lonDeg)) c = 0xd2b26a;
    else if (a > 52) c = 0x5d8a52;      // northern forest
    else c = 0x45985a;
  } else {
    c = a > 78 ? 0xdfeaf2 : 0x2a6db5;   // polar ice / ocean
  }
  out.set(c).multiplyScalar(jitter);
}

function buildEarth() {
  const geo = new THREE.IcosahedronGeometry(1, 9); // not indexed: 3 own vertices per triangle -> flat faces
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), col = new THREE.Color();
  const c = new THREE.Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(pos, f + k));
    c.normalize();
    // Scene (x, y, z) = (cos lat cos lon, sin lat, -cos lat sin lon)
    faceColor(deg(Math.asin(c.y)), deg(Math.atan2(-c.z, c.x)), f / 3, col);
    for (let k = 0; k < 3; k++) col.toArray(colors, (f + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
}
scene.add(buildEarth());
scene.add(new THREE.Mesh( // faint atmosphere
  new THREE.SphereGeometry(1.03, 48, 32),
  new THREE.MeshBasicMaterial({ color: 0x3f7fd0, transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
));

// ---------- Receiver, and the cone of sky above the elevation mask ----------
const recvUpPhys = [Math.cos(rad(RECEIVER.lat)) * Math.cos(rad(RECEIVER.lon)),
                    Math.cos(rad(RECEIVER.lat)) * Math.sin(rad(RECEIVER.lon)),
                    Math.sin(rad(RECEIVER.lat))];
const recvUp = toSceneDir(recvUpPhys);        // unit vector = local "up" = Earth-centre -> receiver
const recvPos = recvUp.clone();               // on the surface (radius 1)
const recvMarker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
recvMarker.position.copy(recvPos);
scene.add(recvMarker);

let maskDeg = 5;
const SLANT = 5; // length of the cone's side, in Earth radii (reaches past the GPS orbit)
const coneFill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
  color: 0x5ad18a, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
const coneWire = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
  color: 0x5ad18a, transparent: true, opacity: 0.2, wireframe: true, depthWrite: false }));
scene.add(coneFill, coneWire);

function updateCone() {
  // Visible sky = elevation above the mask = angle from vertical below (90 - mask).
  const theta = rad(90 - maskDeg), h = SLANT * Math.cos(theta);
  const r = SLANT * Math.sin(theta);
  const geos = [new THREE.ConeGeometry(r, h, 64, 1, true), new THREE.ConeGeometry(r, h, 12, 1, true)]; // smooth fill, sparse edges
  [coneFill, coneWire].forEach((m, i) => {
    m.geometry.dispose();
    m.geometry = geos[i];
    // ConeGeometry has its apex on +y: turn it so the apex points down at the receiver, base up in the sky.
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), recvUp.clone().negate());
    m.position.copy(recvPos).addScaledVector(recvUp, h / 2);
  });
}

// ---------- Elevation mask widget: side view of the sky, drag the handle up and down ----------
const maskCanvas = $("mask-canvas"), mctx = maskCanvas.getContext("2d");

function maskGeometry() {
  const w = maskCanvas.clientWidth, h = maskCanvas.clientHeight;
  const ox = 22, oy = h - 18;
  return { w, h, ox, oy, R: Math.min(w - ox - 70, oy - 12) };
}

function drawMask() {
  const { w, h, ox, oy, R } = maskGeometry(), dpr = devicePixelRatio || 1;
  if (maskCanvas.width !== Math.round(w * dpr)) { maskCanvas.width = Math.round(w * dpr); maskCanvas.height = Math.round(h * dpr); }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, w, h);
  const m = rad(maskDeg);
  const wedge = (a0, a1, fill) => { // sector from elevation a0 to a1
    mctx.beginPath(); mctx.moveTo(ox, oy); mctx.arc(ox, oy, R, -a0, -a1, true); mctx.closePath();
    mctx.fillStyle = fill; mctx.fill();
  };
  wedge(0, m, "rgba(255,90,90,0.40)");
  wedge(m, Math.PI / 2, "rgba(90,209,138,0.28)");
  mctx.fillStyle = "#3b3226"; mctx.fillRect(0, oy, w, h - oy);       // ground
  mctx.fillStyle = "#ff3b3b"; mctx.beginPath(); mctx.arc(ox, oy, 4, 0, 2 * Math.PI); mctx.fill(); // receiver
  mctx.strokeStyle = "#5c6f8c"; mctx.fillStyle = "#9fb0c8"; mctx.font = "10px system-ui"; mctx.lineWidth = 1;
  for (const tick of [0, 30, 60, 90]) { // scale on the arc
    const a = rad(tick);
    mctx.beginPath(); mctx.moveTo(ox + (R - 5) * Math.cos(a), oy - (R - 5) * Math.sin(a));
    mctx.lineTo(ox + (R + 3) * Math.cos(a), oy - (R + 3) * Math.sin(a)); mctx.stroke();
    mctx.fillText(`${tick}°`, ox + (R + 7) * Math.cos(a), oy - (R + 7) * Math.sin(a) + 3);
  }
  mctx.beginPath(); mctx.arc(ox, oy, R, 0, -Math.PI / 2, true); mctx.stroke();
  const hx = ox + R * Math.cos(m), hy = oy - R * Math.sin(m);        // mask line and handle
  mctx.strokeStyle = "#ffd24d"; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(ox, oy); mctx.lineTo(hx, hy); mctx.stroke();
  mctx.fillStyle = "#ffd24d"; mctx.beginPath(); mctx.arc(hx, hy, 8, 0, 2 * Math.PI); mctx.fill();
  mctx.fillStyle = "#e8f0fb"; mctx.font = "bold 22px system-ui";
  mctx.fillText(`${maskDeg}°`, w - 56, h / 2 + 4);
  mctx.font = "11px system-ui"; mctx.fillStyle = "#9fb0c8";
  mctx.fillText("mask", w - 56, h / 2 + 20);
}

function setMask(d) {
  maskDeg = Math.min(89, Math.max(0, Math.round(d)));
  $("mask-input").value = maskDeg;
  drawMask();
  updateCone();
}
function dragMask(ev) {
  const r = maskCanvas.getBoundingClientRect(), { ox, oy } = maskGeometry();
  setMask(deg(Math.atan2(oy - (ev.clientY - r.top), ev.clientX - r.left - ox)));
}
let draggingMask = false;
maskCanvas.addEventListener("pointerdown", (ev) => { draggingMask = true; maskCanvas.setPointerCapture(ev.pointerId); dragMask(ev); });
maskCanvas.addEventListener("pointermove", (ev) => { if (draggingMask) dragMask(ev); });
maskCanvas.addEventListener("pointerup", () => { draggingMask = false; });
maskCanvas.addEventListener("pointercancel", () => { draggingMask = false; });
$("mask-input").addEventListener("input", (ev) => { const v = parseFloat(ev.target.value); if (Number.isFinite(v)) setMask(v); });
addEventListener("resize", drawMask);

// ---------- Axes and planes (toggle) ----------
const axesGroup = new THREE.Group();
axesGroup.visible = false;
scene.add(axesGroup);
const planesGroup = new THREE.Group(); // one translucent disc per distinct orbital plane (rebuilt when satellites change)
axesGroup.add(planesGroup);

function makeLabel(text, color) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const g = cv.getContext("2d");
  g.font = "bold 30px system-ui"; g.fillStyle = hex(color); g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}
// Physics x -> scene x, physics y -> scene -z, physics z (north) -> scene y.
for (const [label, dir, color] of [["X (0° lon)", [1, 0, 0], 0xff5a5a], ["Y (90° E)", [0, 0, -1], 0x5ad18a], ["Z (north)", [0, 1, 0], 0x5aa8ff]]) {
  const d = new THREE.Vector3(...dir), len = 5.4;
  axesGroup.add(new THREE.ArrowHelper(d, new THREE.Vector3(), len, color, 0.3, 0.15));
  const text = makeLabel(label, color);
  text.position.copy(d).multiplyScalar(len + 0.5);
  axesGroup.add(text);
}
const equator = new THREE.Mesh(new THREE.CircleGeometry(4.6, 96), new THREE.MeshBasicMaterial({
  color: 0xaaaaaa, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
equator.rotation.x = -Math.PI / 2; // lies in the equatorial plane
axesGroup.add(equator);

function rebuildPlanes() {
  for (const m of [...planesGroup.children]) { planesGroup.remove(m); m.geometry.dispose(); m.material.dispose(); }
  const seen = new Set();
  for (const { sat } of entries) {
    const key = `${sat.a}|${sat.inc.toFixed(5)}|${sat.raan.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Orbit-plane normal in physics coordinates: e1 x e2 = (sin(raan) sin(i), -cos(raan) sin(i), cos(i)).
    const n = toSceneDir([Math.sin(sat.raan) * Math.sin(sat.inc), -Math.cos(sat.raan) * Math.sin(sat.inc), Math.cos(sat.inc)]);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(sat.a / R_E, 96), new THREE.MeshBasicMaterial({
      color: colorOf(sat), transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); // CircleGeometry's normal is +z
    planesGroup.add(disc);
  }
}
$("axes-btn").onclick = () => {
  axesGroup.visible = !axesGroup.visible;
  $("axes-btn").textContent = `Axes & planes: ${axesGroup.visible ? "on" : "off"}`;
};

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

// ---------- Side panel: pause, counter, list ----------
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
  rebuildPlanes();
}
$("reset-btn").onclick = () => { userCount = 0; setConstellation(nominalConstellation()); };
$("clear-btn").onclick = () => setConstellation([]);

// ---------- Add satellite: form + live preview of the orbit and its direction ----------
function parseAddForm() {
  const alt = parseFloat($("add-alt").value), inc = parseFloat($("add-inc").value);
  const raan = parseFloat($("add-raan").value), phase = parseFloat($("add-phase").value);
  if (![alt, inc, raan, phase].every(Number.isFinite)) return { error: "Enter a number in every field." };
  if (alt < 200) return { error: "Altitude must be at least 200 km." };
  if (inc < 0 || inc > 180) return { error: "Inclination must be between 0 and 180 degrees." };
  return { sat: { name: "", plane: -1, a: R_E + alt * 1e3, inc: rad(inc), raan: rad(raan), u0: rad(phase) } };
}

const preview = new THREE.Group();
preview.visible = false;
scene.add(preview);
const previewLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.12, gapSize: 0.08 }));
const previewGhost = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
preview.add(previewLine, previewGhost);
const previewArrows = [0, 1, 2, 3].map(() => {
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  preview.add(arrow);
  return arrow;
});

let previewWanted = false;
function updatePreview() {
  const { sat, error } = parseAddForm();
  preview.visible = previewWanted && !error;
  if (!preview.visible) return;
  const T = periodOf(sat), pts = [];
  for (let i = 0; i <= 256; i++) pts.push(toScene(satPosition(sat, (i / 256) * T)));
  previewLine.geometry.dispose();
  previewLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  previewLine.computeLineDistances();
  previewGhost.position.copy(toScene(satPosition(sat, 0)));
  previewArrows.forEach((arrow, k) => {
    // Arrows sit between the start and the other quarter points; they point the way the satellite moves.
    const t = T * (0.125 + 0.25 * k);
    const p = toScene(satPosition(sat, t));
    arrow.position.copy(p);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toScene(satPosition(sat, t + 1)).sub(p).normalize());
  });
}
const addSection = $("add-section");
let previewHover = false, previewFocus = false;
const syncPreview = () => { previewWanted = previewHover || previewFocus; updatePreview(); };
addSection.addEventListener("pointerenter", () => { previewHover = true; syncPreview(); });
addSection.addEventListener("pointerleave", () => { previewHover = false; syncPreview(); });
addSection.addEventListener("focusin", () => { previewFocus = true; syncPreview(); });
addSection.addEventListener("focusout", (ev) => { previewFocus = addSection.contains(ev.relatedTarget); syncPreview(); });
addSection.addEventListener("input", updatePreview);

$("add-btn").onclick = () => {
  const { sat, error } = parseAddForm();
  $("add-err").textContent = error ?? "";
  if (error) return;
  userCount++;
  sat.name = `User-${userCount}`;
  addSatellite(sat);
  refreshList();
};

// ---------- Monte Carlo DOP ----------
$("mc-run").onclick = () => {
  const n = Math.round(parseFloat($("mc-n").value));
  const out = $("mc-out"), btn = $("mc-run");
  if (!(n >= 1 && n <= 200000)) {
    out.textContent = "Samples must be 1-200000.";
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

// ---------- Receiver readout: which satellites the receiver sees right now ----------
const recvPhys = recvUpPhys.map((v) => v * R_E);
function receiverView(t) {
  const sinMask = Math.sin(rad(maskDeg)), units = [], visible = new Set();
  for (const e of entries) {
    const p = satPosition(e.sat, t);
    const d = [p[0] - recvPhys[0], p[1] - recvPhys[1], p[2] - recvPhys[2]], len = Math.hypot(...d);
    const u = [d[0] / len, d[1] / len, d[2] / len];
    if (u[0] * recvUpPhys[0] + u[1] * recvUpPhys[1] + u[2] * recvUpPhys[2] > sinMask) { units.push(u); visible.add(e); }
  }
  return { visible, dop: dopFromUnits(units) };
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
setMask(maskDeg);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (playing) simT += dt * TIME_SCALE;
  const { visible, dop } = receiverView(simT);
  for (const e of entries) {
    e.mesh.position.copy(toScene(satPosition(e.sat, simT)));
    e.mesh.scale.setScalar(e === hovered ? 1.8 : visible.has(e) ? 1.4 : 1); // bigger = seen by the receiver
  }
  const text = `${RECEIVER.name} sees ${visible.size} satellite${visible.size === 1 ? "" : "s"}` +
    (dop ? ` · PDOP ${dop.pdop.toFixed(2)}` : " · no position fix (need 4)");
  if ($("recv").textContent !== text) $("recv").textContent = text;
  if (hovered) updateTooltip();
  controls.update();
  renderer.render(scene, camera);
});
