// 3D view (Three.js). Draws what Python computed; no orbital or DOP math happens here.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { trialColor, rgb01, FADE } from "./trialcolors.js";
import { buildEarthGeometry } from "./earth.js";

const R_EARTH = 6378.137;      // km; scene units are Earth radii
const K = 1 / R_EARTH;

// Physical frame (x, y, z=north) -> Three.js frame (y is up): (x, y, z) -> (x, z, -y).
const toScene = (p) => new THREE.Vector3(p[0] * K, p[2] * K, -p[1] * K);

// onPick(lat, lon): the Earth was clicked.
// onHover(i, x, y): satellite i (or -1 for none) is under the mouse, at (x, y) pixels inside the container.
// land: the land/ocean grid from earth.js (or null for a plain sphere).
// onSatClick(i): satellite i was clicked (to switch it off or on).
export function createGlobe(container, onPick, onHover, land, onSatClick) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(6, 4, 9);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 20;

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(5, 3, 4);
  scene.add(sun);

  // Everything fixed to the ground (the Earth, its graticule, Monte-Carlo dots) lives in
  // earthGroup, which is turned each update by the Earth's rotation angle from Python.
  // Satellites, orbit rings and the receiver marker are in the inertial frame (scene level).
  const earthGroup = new THREE.Group();
  scene.add(earthGroup);

  // Low-poly Earth (land/ocean from the land grid) with a lat/lon graticule every 30 degrees
  // (equator and prime meridian highlighted). Without the land grid: a plain dark-blue sphere.
  const earth = new THREE.Mesh(
    land ? buildEarthGeometry(land) : new THREE.SphereGeometry(1, 64, 48),
    land ? new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 4, specular: 0x111111 })
         : new THREE.MeshPhongMaterial({ color: 0x1b3550, shininess: 8 }));
  earthGroup.add(earth);
  addGraticule(earthGroup);

  // North pole marker so orientation is clear
  const pole = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1.35, 0)]),
    new THREE.LineBasicMaterial({ color: 0xffffff }));
  earthGroup.add(pole);

  // Receiver marker
  const receiver = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  scene.add(receiver);

  // Line-of-sight lines to visible satellites (the buffer is sized for the constellation in setConstellation)
  const losGeom = new THREE.BufferGeometry();
  losGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  losGeom.setDrawRange(0, 0);
  const los = new THREE.LineSegments(losGeom, new THREE.LineBasicMaterial({ color: 0x7CFC9A, transparent: true, opacity: 0.6 }));
  los.frustumCulled = false;   // its points change every update; the initial bounding sphere would be wrong
  scene.add(los);

  // Sight lines to satellites above the horizon but hidden by the terrain (red, dashed)
  const blockedGeom = new THREE.BufferGeometry();
  blockedGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  blockedGeom.setDrawRange(0, 0);
  const blockedLos = new THREE.LineSegments(blockedGeom,
    new THREE.LineDashedMaterial({ color: 0xff5252, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.8 }));
  blockedLos.frustumCulled = false;
  scene.add(blockedLos);
  let blockedCount = 0;                     // how many dashed lines are drawn (for tests)

  // ---- Monte-Carlo trial dots -------------------------------------------------------
  // Each trial appears as a big flash in its PDOP colour that, over FLASH_S seconds, shrinks and
  // darkens (colour x FADE); it is then copied into a permanent layer of small dark dots. The
  // permanent layer is drawn first (renderOrder 1) and flashes after it (renderOrder 2), so old
  // dots never cover a flash. Colours are passed to the shaders as plain sRGB numbers.
  const FLASH_S = 0.5, FLASH_PX = 14, DOT_PX = 4;
  const CAP_FLASH = 8192, CAP_DOT = 200000, DOT_R = 1.004;
  const px = renderer.getPixelRatio();
  const roundDot = `vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard;`;

  const dotPos = new Float32Array(CAP_DOT * 3);
  const dotCol = new Float32Array(CAP_DOT * 3);
  const dotGeom = new THREE.BufferGeometry();
  dotGeom.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
  dotGeom.setAttribute("aColor", new THREE.BufferAttribute(dotCol, 3));
  dotGeom.setDrawRange(0, 0);
  const dots = new THREE.Points(dotGeom, new THREE.ShaderMaterial({
    uniforms: { uPx: { value: DOT_PX * px } },
    vertexShader: `uniform float uPx; attribute vec3 aColor; varying vec3 vColor;
      void main() { vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uPx; }`,
    fragmentShader: `varying vec3 vColor;
      void main() { ${roundDot} gl_FragColor = vec4(vColor, 1.0); }`,
    depthWrite: false,
  }));
  dots.renderOrder = 1;
  dots.frustumCulled = false;
  earthGroup.add(dots);                     // trial dots are ground-fixed, so they turn with the Earth

  const flashPos = new Float32Array(CAP_FLASH * 3);
  const flashCol = new Float32Array(CAP_FLASH * 3);
  const flashBirth = new Float32Array(CAP_FLASH).fill(-1e6);   // seconds; -1e6 = empty slot
  const flashGeom = new THREE.BufferGeometry();
  flashGeom.setAttribute("position", new THREE.BufferAttribute(flashPos, 3));
  flashGeom.setAttribute("aColor", new THREE.BufferAttribute(flashCol, 3));
  flashGeom.setAttribute("birth", new THREE.BufferAttribute(flashBirth, 1));
  const flashMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uFade: { value: FADE },
      uLife: { value: FLASH_S }, uStartPx: { value: FLASH_PX * px }, uEndPx: { value: DOT_PX * px },
    },
    vertexShader: `uniform float uTime, uLife, uStartPx, uEndPx, uFade;
      attribute vec3 aColor; attribute float birth; varying vec3 vColor;
      void main() {
        float a = clamp((uTime - birth) / uLife, 0.0, 1.0);        // 0 = just born, 1 = faded
        vColor = aColor * mix(1.0, uFade, a);                       // darkens to the colour the permanent dot keeps
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = mix(uStartPx, uEndPx, a);
        if (a >= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);        // finished: off-screen (it lives on as a dark dot)
      }`,
    fragmentShader: `varying vec3 vColor;
      void main() { ${roundDot} gl_FragColor = vec4(vColor, 1.0); }`,
    depthWrite: false,
  });
  const flashes = new THREE.Points(flashGeom, flashMat);
  flashes.renderOrder = 2;
  flashes.frustumCulled = false;
  earthGroup.add(flashes);

  // The flash buffer is a ring: slots head..tail-1 are live, in birth order.
  let head = 0, tail = 0, dotCount = 0;

  // lat/lon (degrees) on a sphere of radius r -> scene coordinates (same mapping as toScene)
  function latLonToScene(lat, lon, r) {
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    return [r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo)];
  }

  function retireOldest() {
    const s = head % CAP_FLASH;
    if (dotCount < CAP_DOT) {
      dotPos.set(flashPos.subarray(3 * s, 3 * s + 3), 3 * dotCount);
      for (let c = 0; c < 3; c++) dotCol[3 * dotCount + c] = flashCol[3 * s + c] * FADE;
      dotCount++;
      dotGeom.setDrawRange(0, dotCount);
      dotGeom.attributes.position.needsUpdate = true;
      dotGeom.attributes.aColor.needsUpdate = true;
    }
    flashBirth[s] = -1e6;
    flashGeom.attributes.birth.needsUpdate = true;
    head++;
  }

  /** Add one flash per trial. Births are spread evenly over [t0ms, t1ms] so they are staggered. */
  function spawnTrials(points, t0ms, t1ms, pdopThreshold) {
    const k = points.lat.length;
    for (let i = 0; i < k; i++) {
      if (tail - head >= CAP_FLASH) retireOldest();
      const s = tail % CAP_FLASH;
      flashPos.set(latLonToScene(points.lat[i], points.lon[i], DOT_R), 3 * s);
      flashCol.set(rgb01(trialColor(points.pdop[i], pdopThreshold)), 3 * s);
      flashBirth[s] = (t0ms + ((i + 0.5) / k) * (t1ms - t0ms)) / 1000;
      tail++;
    }
    flashGeom.attributes.position.needsUpdate = true;
    flashGeom.attributes.aColor.needsUpdate = true;
    flashGeom.attributes.birth.needsUpdate = true;
  }

  function clearTrials() {
    head = tail = dotCount = 0;
    flashBirth.fill(-1e6);
    flashGeom.attributes.birth.needsUpdate = true;
    dotGeom.setDrawRange(0, 0);
  }

  function updateTrials() {
    const now = performance.now() / 1000;
    flashMat.uniforms.uTime.value = now;
    while (head < tail && now - flashBirth[head % CAP_FLASH] >= FLASH_S) retireOldest();
  }

  // ---- the constellation: satellites and orbit rings -----------------------------------------
  // setConstellation() (below) builds one sphere per satellite and one ring per distinct orbit.
  // Satellites that are switched off are drawn as faint ghosts; a ring is drawn faintly too if
  // every satellite on it is switched off.
  const satGeometry = new THREE.SphereGeometry(0.045, 16, 12);
  let sats = [];         // one mesh per satellite
  let ringLines = [];    // one line per distinct orbit
  let ringOf = [];       // which ring each satellite is on
  let ringActive = [];   // whether a ring has any switched-on satellite
  let enabled = [];      // whether each satellite is switched on (from the last update)
  let visible = [];      // whether each satellite is above the mask and switched on (from the last update)

  // ---- satellite hover ----------------------------------------------------------------
  // The satellite under the mouse is found in screen space: the nearest satellite within
  // HOVER_PX pixels of the pointer that is not hidden behind the Earth. Its orbit ring is
  // highlighted (the other rings dim) and the page is told so it can show a tooltip.
  const HOVER_PX = 14;
  const earthSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  let pointer = null;                       // mouse position in container pixels, or null
  let hovered = -1, lastReported = null;
  let clickCandidate = -1;                  // the satellite that was under the mouse when it was pressed

  function satScale(i) { return i === hovered ? 2.2 : !enabled[i] ? 0.7 : visible[i] ? 1.3 : 0.8; }
  function satOpacity(i) { return !enabled[i] ? 0.12 : visible[i] ? 1 : 0.35; }
  function ringOpacity(r) { return hovered >= 0 ? (r === ringOf[hovered] ? 1.0 : 0.1) : ringActive[r] ? 0.35 : 0.06; }

  function applyHighlight() {
    ringLines.forEach((line, r) => { line.material.opacity = ringOpacity(r); });
    sats.forEach((m, i) => m.scale.setScalar(satScale(i)));
  }

  function pickSatellite() {
    let best = -1, bestDist = HOVER_PX;
    if (pointer && sats.length) {
      const w = container.clientWidth, h = container.clientHeight;
      camera.updateMatrixWorld();
      sats.forEach((m, i) => {
        const ndc = m.position.clone().project(camera);
        if (ndc.z > 1) return;                                           // behind the camera
        const d = Math.hypot((ndc.x * 0.5 + 0.5) * w - pointer.x, (-ndc.y * 0.5 + 0.5) * h - pointer.y);
        if (d >= bestDist) return;
        const toSat = m.position.clone().sub(camera.position);
        const dist = toSat.length();
        const hit = new THREE.Ray(camera.position.clone(), toSat.normalize()).intersectSphere(earthSphere, new THREE.Vector3());
        if (hit && camera.position.distanceTo(hit) < dist) return;       // the Earth is in front of it
        best = i; bestDist = d;
      });
    }
    if (best !== hovered) { hovered = best; applyHighlight(); }
    const report = hovered < 0 ? "none" : `${hovered}:${Math.round(pointer.x)}:${Math.round(pointer.y)}`;
    if (report !== lastReported) { lastReported = report; onHover(hovered, pointer ? pointer.x : 0, pointer ? pointer.y : 0); }
  }

  /**
   * Replace the satellites and rings.
   *   colors: CSS colour of each satellite; ringOf: ring index of each satellite;
   *   paths: points of each ring (inertial km); ringColors, ringActive: colour / "has a satellite switched on" per ring.
   */
  function setConstellation(c) {
    sats.forEach((m) => { scene.remove(m); m.material.dispose(); });
    ringLines.forEach((l) => { scene.remove(l); l.geometry.dispose(); l.material.dispose(); });
    sats = c.colors.map((color) => {
      const m = new THREE.Mesh(satGeometry, new THREE.MeshBasicMaterial({ color, transparent: true }));
      scene.add(m);
      return m;
    });
    ringLines = c.paths.map((pts, r) => {
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts.map(toScene)),
        new THREE.LineBasicMaterial({ color: c.ringColors[r], transparent: true, opacity: 0.35 }));
      scene.add(line);
      return line;
    });
    ringOf = c.ringOf;
    ringActive = c.ringActive;
    enabled = c.colors.map(() => true);
    visible = c.colors.map(() => false);
    losGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, c.colors.length) * 6), 3));
    losGeom.setDrawRange(0, 0);
    blockedGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, c.colors.length) * 6), 3));
    blockedGeom.setDrawRange(0, 0);
    hovered = -1; lastReported = null; clickCandidate = -1;
    applyHighlight();
  }

  function update(snap) {
    if (snap.sat_positions.length !== sats.length) return;     // the constellation just changed; the next snapshot will match
    enabled = snap.enabled;
    visible = snap.visible;
    // Rotation about physical +z equals rotation about scene +y (the mapping toScene is a proper rotation)
    earthGroup.rotation.y = (snap.earth_angle_deg * Math.PI) / 180;
    const rx = toScene(snap.receiver);
    receiver.position.copy(rx);

    const buf = losGeom.attributes.position.array, bbuf = blockedGeom.attributes.position.array;
    let k = 0, kb = 0;
    snap.sat_positions.forEach((p, i) => {
      const pos = toScene(p);
      sats[i].position.copy(pos);
      sats[i].material.opacity = satOpacity(i);
      sats[i].scale.setScalar(satScale(i));
      if (visible[i]) {
        buf.set([rx.x, rx.y, rx.z, pos.x, pos.y, pos.z], k);
        k += 6;
      } else if (snap.blocked[i]) {                              // above the horizon, hidden by the valley walls
        bbuf.set([rx.x, rx.y, rx.z, pos.x, pos.y, pos.z], kb);
        kb += 6;
      }
    });
    losGeom.attributes.position.needsUpdate = true;
    losGeom.setDrawRange(0, k / 3);
    blockedGeom.attributes.position.needsUpdate = true;
    blockedGeom.setDrawRange(0, kb / 3);
    blockedLos.computeLineDistances();                             // dashes need the distance along each line
    blockedCount = kb / 6;
  }

  // Click (not drag) on the Earth -> report latitude/longitude
  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
    clickCandidate = hovered;                                   // remember it: pressing hides the tooltip and clears `hovered`
    pointer = null;
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.buttons) return;                                      // dragging to rotate: no tooltip
    const r = renderer.domElement.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  renderer.domElement.addEventListener("pointerleave", () => { pointer = null; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    if (clickCandidate >= 0) {                                  // a click on a satellite switches it off or on
      const i = clickCandidate;
      clickCandidate = -1;
      onSatClick(i);
      return;
    }
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1,
                                        -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(earth)[0];
    if (!hit) return;
    // Undo the Earth's current rotation to get Earth-fixed coordinates, then invert toScene:
    // scene (x, y, z) -> physical (x, -z, y)
    const p = earthGroup.worldToLocal(hit.point.clone());
    const x = p.x, y = -p.z, z = p.y;
    onPick(Math.asin(z / p.length()) * 180 / Math.PI, Math.atan2(y, x) * 180 / Math.PI);
  });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    updateTrials();
    controls.update();
    pickSatellite();           // every frame: satellites and the camera move even when the mouse does not
    renderer.render(scene, camera);
  });

  /** Where satellite i is on screen, in pixels inside the container (for tests and debugging). */
  function screenOf(i) {
    camera.updateMatrixWorld();
    const ndc = sats[i].position.clone().project(camera);
    return { x: (ndc.x * 0.5 + 0.5) * container.clientWidth, y: (-ndc.y * 0.5 + 0.5) * container.clientHeight };
  }

  return { update, setConstellation, spawnTrials, clearTrials, screenOf, blockedLines: () => blockedCount,
           satColor: (i) => `#${sats[i].material.color.getHexString()}` };
}

function addGraticule(scene) {
  const r = 1.002, N = 120;
  const material = (c) => new THREE.LineBasicMaterial({ color: c });
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const lon = (2 * Math.PI * i) / N, la = (lat * Math.PI) / 180;
      pts.push(toScene([r * R_EARTH * Math.cos(la) * Math.cos(lon), r * R_EARTH * Math.cos(la) * Math.sin(lon), r * R_EARTH * Math.sin(la)]));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material(lat === 0 ? 0xf2c14e : 0x3b5878)));
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const la = (2 * Math.PI * i) / N, lo = (lon * Math.PI) / 180;
      pts.push(toScene([r * R_EARTH * Math.cos(la) * Math.cos(lo), r * R_EARTH * Math.cos(la) * Math.sin(lo), r * R_EARTH * Math.sin(la)]));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material(lon === 0 ? 0xf2c14e : 0x3b5878)));
  }
}
