// Low-poly Earth: an icosphere (flat-shaded triangles) coloured land / ocean from the
// Natural Earth land grid made by tools/landmask.py. The colours are a stylization
// (white polar caps, tan subtropical belts, green elsewhere), not measured data.
import * as THREE from "three";

/** Load web/data/land_mask.json -> { isLand(latDeg, lonDeg) }. */
export async function loadLandMask(url) {
  const info = await (await fetch(url)).json();
  const bytes = Uint8Array.from(atob(info.bits), (c) => c.charCodeAt(0));
  const { width, height } = info;
  return {
    // same rule as tools/landmask.py is_land: row 0 is the northernmost row, bits are row-major, MSB first
    isLand(lat, lon) {
      const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) * height) / 180)));
      const col = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) * width) / 360)));
      const i = row * width + col;
      return ((bytes[i >> 3] >> (7 - (i & 7))) & 1) === 1;
    },
  };
}

const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

/** Unit icosphere: 20 * 4^level triangles (level 4 -> 5,120). Also used for the Moon (moon.js). */
export function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
                 [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
               [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5],
               [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let n = 0; n < level; n++) {
    const midpoint = new Map();
    const mid = (a, b) => {                       // new vertex halfway along an edge, pushed out to the sphere
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!midpoint.has(key)) {
        verts.push(norm(verts[a].map((x, i) => x + verts[b][i])));
        midpoint.set(key, verts.length - 1);
      }
      return midpoint.get(key);
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  return { verts, faces };
}

const OCEAN = new THREE.Color("#1f5f9e"), SEA_ICE = new THREE.Color("#d5e6f2");
const SNOW = new THREE.Color("#eef3f6"), DESERT = new THREE.Color("#c9b37c"), GREEN = new THREE.Color("#4f8f4a");

// repeatable "random" number in [-1, 1) from the triangle number, so each triangle gets a slightly
// different shade (this is what makes the faceted look) and the picture is the same every time
export const jitter = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

function faceColor(land, lat, i) {
  const a = Math.abs(lat);
  const base = land ? (a >= 68 ? SNOW : a >= 15 && a <= 32 ? DESERT : GREEN) : (a >= 72 ? SEA_ICE : OCEAN);
  return base.clone().multiplyScalar(1 + 0.07 * jitter(i));
}

/**
 * Flat-shaded Earth geometry (unit radius). Scene axes are (x, y up, z); the physical frame is
 * (x, y, z north) and toScene maps physical (x, y, z) -> scene (x, z, -y), so a triangle's
 * Earth-fixed position is physical = (sx, -sz, sy).
 */
export function buildEarthGeometry(land, level = 4) {
  const { verts, faces } = icosphere(level);
  const positions = new Float32Array(faces.length * 9);
  const colors = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    let [a, b, c] = f.map((k) => verts[k]);
    const centre = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (cross[0] * centre[0] + cross[1] * centre[1] + cross[2] * centre[2] < 0) [b, c] = [c, b];   // wind outward

    const px = centre[0], py = -centre[2], pz = centre[1];
    const lat = (Math.asin(pz / Math.hypot(px, py, pz)) * 180) / Math.PI;
    const lon = (Math.atan2(py, px) * 180) / Math.PI;
    const col = faceColor(land.isLand(lat, lon), lat, i);
    [a, b, c].forEach((v, k) => {
      positions.set(v, 9 * i + 3 * k);
      colors.set([col.r, col.g, col.b], 9 * i + 3 * k);
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();      // not indexed, so every triangle gets its own (flat) normal
  return geometry;
}
