// Low-poly Moon: an icosphere (flat-shaded triangles) like the Earth, each triangle given the grey level
// of the real Moon at its centre, from the brightness grid made by tools/moonmap.py (NASA LRO mosaic).
// Its position comes from Python (ephemeris.py); this file only builds the shape and colours.
import * as THREE from "three";
import { icosphere, jitter } from "./earth.js";

/** Load web/data/moon_albedo.json -> { grey(latDeg, lonDeg) } with grey in 0..1. */
export async function loadMoonAlbedo(url) {
  const info = await (await fetch(url)).json();
  const bytes = Uint8Array.from(atob(info.grey), (c) => c.charCodeAt(0));
  const { width, height } = info;
  return {
    // same rule as tools/moonmap.py brightness(): row 0 is the northernmost row, row-major
    grey(lat, lon) {
      const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) * height) / 180)));
      const col = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) * width) / 360)));
      return bytes[row * width + col] / 255;
    },
  };
}

/**
 * Flat-shaded Moon geometry (unit radius). Model axes: +z points at selenographic (lat 0, lon 0), the
 * centre of the near side; +y is the Moon's north; +x is longitude 90 deg E. The globe turns the Moon
 * with lookAt(Earth) and up = its pole, so the near side always faces the Earth (tidal locking).
 * Without the grid (albedo = null): a plain grey Moon.
 */
export function buildMoonGeometry(albedo, level = 4) {
  const { verts, faces } = icosphere(level);
  const positions = new Float32Array(faces.length * 9);
  const colors = new Float32Array(faces.length * 9);
  const col = new THREE.Color();
  faces.forEach((f, i) => {
    let [a, b, c] = f.map((k) => verts[k]);
    const centre = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (cross[0] * centre[0] + cross[1] * centre[1] + cross[2] * centre[2] < 0) [b, c] = [c, b];   // wind outward

    const [x, y, z] = centre;
    const lat = (Math.asin(y / Math.hypot(x, y, z)) * 180) / Math.PI;
    const lon = (Math.atan2(x, z) * 180) / Math.PI;
    // the grid holds image grey levels (sRGB); a small shade difference per triangle gives the faceted look
    const g = Math.min(1, (albedo ? albedo.grey(lat, lon) : 0.6) * (1 + 0.04 * jitter(i)));
    col.setRGB(g, g, g, THREE.SRGBColorSpace);
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
