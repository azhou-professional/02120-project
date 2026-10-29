// Globe + 24 GPS satellites. Scene units: 1 unit = 1 Earth radius.
// Three.js is y-up, physics is z-up, so physics (x, y, z) is drawn at (x, z, -y).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { R_E, N_SAT, N_PLANES, PER_PLANE, PERIOD, satPosition } from "./orbit.js";

const TIME_SCALE = 600; // simulated seconds per real second (one orbit ~ 72 s)
const PLANE_COLORS = [0xff6b6b, 0xffb84d, 0xf7e15a, 0x5ad18a, 0x4dabff, 0xb08cff];

const toScene = ([x, y, z]) => new THREE.Vector3(x / R_E, z / R_E, -y / R_E);

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

// Earth: shaded sphere plus a lat/lon grid every 30 degrees (no texture needed yet).
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(5, 3, 4);
scene.add(sun);
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 48),
  new THREE.MeshStandardMaterial({ color: 0x1d4e89, roughness: 0.9 })
));
const gridMat = new THREE.LineBasicMaterial({ color: 0x8fb8e8, transparent: true, opacity: 0.45 });
const ring = (pts) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat);
for (let lat = -60; lat <= 60; lat += 30) {
  const pts = [], r = Math.cos((lat * Math.PI) / 180), y = Math.sin((lat * Math.PI) / 180);
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * 2 * Math.PI;
    pts.push(new THREE.Vector3(1.002 * r * Math.cos(a), 1.002 * y, 1.002 * r * Math.sin(a)));
  }
  scene.add(ring(pts));
}
for (let lon = 0; lon < 180; lon += 30) {
  const pts = [], a = (lon * Math.PI) / 180;
  for (let i = 0; i <= 128; i++) {
    const p = (i / 128) * 2 * Math.PI;
    pts.push(new THREE.Vector3(1.002 * Math.cos(p) * Math.cos(a), 1.002 * Math.sin(p), 1.002 * Math.cos(p) * Math.sin(a)));
  }
  scene.add(ring(pts));
}

// Orbit paths: sample satellite 0 of each plane over one period.
for (let plane = 0; plane < N_PLANES; plane++) {
  const pts = [];
  for (let i = 0; i <= 256; i++) pts.push(toScene(satPosition(plane * PER_PLANE, (i / 256) * PERIOD)));
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: PLANE_COLORS[plane], transparent: true, opacity: 0.35 })
  ));
}

// Satellites, coloured by plane.
const sats = [];
for (let i = 0; i < N_SAT; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshBasicMaterial({ color: PLANE_COLORS[Math.floor(i / PER_PLANE)] })
  );
  scene.add(m);
  sats.push(m);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime() * TIME_SCALE;
  sats.forEach((m, i) => m.position.copy(toScene(satPosition(i, t))));
  controls.update();
  renderer.render(scene, camera);
});
