// Very low-poly satellite models (about 16-45 triangles each), drawn far larger than life so they can be
// seen. Each model is one merged geometry; its vertex colours are grey levels that the material colour
// (the constellation's colour) is multiplied by, so the solar wings come out as a darker shade.
//
// Model axes: +z points at the Earth (the body is turned with lookAt(Earth's centre)); the solar wings lie
// along +-y, which is set to the orbit normal, as on real navigation satellites whose wings turn about an
// axis roughly perpendicular to the orbit plane.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const BODY = 1.0, ANTENNA = 0.85, BOOM = 0.7, WING = 0.5;      // brightness of each part

function part(geometry, shade, x = 0, y = 0, z = 0, rotateX = 0) {
  const g = geometry.toNonIndexed();
  if (rotateX) g.rotateX(rotateX);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(shade), 3));
  g.deleteAttribute("uv");
  return g;
}
const box = (w, h, d, shade, x, y, z) => part(new THREE.BoxGeometry(w, h, d), shade, x, y, z);
// a flat panel in the y-x plane (a solar wing), two triangles, seen from both sides
const panel = (w, h, shade, x, y, z) => part(new THREE.PlaneGeometry(w, h), shade, x, y, z, Math.PI / 2);
const wingPair = (len, width, gap, shade, panels = 1) => {
  const out = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < panels; k++) {
      const segment = len / panels;
      const y = side * (gap + segment * (k + 0.5) + k * 0.004);
      out.push(part(new THREE.PlaneGeometry(width, segment), shade, 0, y, 0));
    }
    out.push(box(0.004, gap, 0.004, BOOM, 0, side * gap / 2, 0));   // boom from the body to the wing
  }
  return out;
};

function build(parts) {
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// GPS III: a cube-like bus, a wide antenna panel on the Earth face, two square solar wings
const gps = () => build([
  box(0.05, 0.05, 0.055, BODY),
  box(0.06, 0.06, 0.008, ANTENNA, 0, 0, 0.032),
  ...wingPair(0.07, 0.05, 0.035, WING),
]);

// Galileo: a slim bus, a small laser retro-reflector on the Earth face, two long wings of two panels each
const galileo = () => build([
  box(0.035, 0.03, 0.06, BODY),
  box(0.016, 0.016, 0.008, ANTENNA, 0, 0.008, 0.034),
  ...wingPair(0.11, 0.032, 0.025, WING, 2),
]);

// BeiDou-3: a box bus, a dish antenna on the Earth face, two wings of two panels
const beidou = () => {
  const dish = new THREE.ConeGeometry(0.024, 0.014, 8, 1, true);   // open cone = a shallow dish
  return build([
    box(0.045, 0.045, 0.045, BODY),
    part(dish, ANTENNA, 0, 0, 0.03, -Math.PI / 2),
    ...wingPair(0.08, 0.04, 0.03, WING, 2),
  ]);
};

// Satellites you add: a small cube with two short wings
const generic = () => build([box(0.035, 0.035, 0.035, BODY), ...wingPair(0.045, 0.028, 0.026, WING)]);

let cache = null;
/** The four shared geometries: { gps, galileo, beidou, generic }. */
export function satelliteGeometries() {
  if (!cache) cache = { gps: gps(), galileo: galileo(), beidou: beidou(), generic: generic() };
  return cache;
}

export const triangleCount = (g) => g.attributes.position.count / 3;
