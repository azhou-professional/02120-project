// Small pictures of the satellite models for the "Add satellites" cards. One shared offscreen renderer
// draws a model and the result is copied into the card's own 2D canvas (so there is only one extra WebGL
// context however many cards there are). The hovered card's model turns.
import * as THREE from "three";
import { satelliteGeometries } from "./satmodels.js";

let renderer, scene, camera, mesh;

function setup() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(240, 140);
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, 240 / 140, 0.01, 10);
  camera.position.set(0.1, 0.18, 0.5);
  camera.lookAt(0, 0, 0);
  mesh = new THREE.Mesh(undefined, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  scene.add(mesh);
}

/** Draw `model` (gps, galileo, beidou, generic) in `color` into a card canvas, turned by `angle` radians. */
export function drawThumb(canvas, model, color, angle = 0) {
  setup();
  mesh.geometry = satelliteGeometries()[model] || satelliteGeometries().generic;
  mesh.material.color.set(color);
  mesh.rotation.set(-0.5, 0.6 + angle, 0.2);
  renderer.render(scene, camera);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
}

/** Keep turning the model in `canvas` until the returned function is called. */
export function spin(canvas, model, color) {
  let running = true;
  const start = performance.now();
  const step = (now) => {
    if (!running) return;
    drawThumb(canvas, model, color, ((now - start) / 1000) * 1.5);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => { running = false; drawThumb(canvas, model, color, 0); };
}
