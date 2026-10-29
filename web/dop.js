// Dilution of precision (DOP) and the Monte Carlo coverage simulation.
import { R_E, satPosition } from "./orbit.js";

// Invert a 4x4 matrix (array of 4 rows) by Gauss-Jordan elimination. Returns null if singular.
function invert4(M) {
  const a = M.map((row, i) => [...row, ...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-9) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row) => row.slice(4));
}

// DOP from unit line-of-sight vectors receiver -> satellite (one [ux, uy, uz] per visible satellite).
// Each row of G is [-u, 1] (unknowns x, y, z, clock bias). Q = (G^T G)^-1.
// PDOP = sqrt(Qxx + Qyy + Qzz), GDOP = sqrt(trace Q). Returns null with < 4 satellites or a singular G^T G.
export function dopFromUnits(units) {
  if (units.length < 4) return null;
  const GtG = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  for (const [ux, uy, uz] of units) {
    const g = [-ux, -uy, -uz, 1];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) GtG[i][j] += g[i] * g[j];
  }
  const Q = invert4(GtG);
  if (!Q) return null;
  const pdop = Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2]);
  return { pdop, gdop: Math.sqrt(pdop ** 2 + Q[3][3]) };
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Monte Carlo: n random surface points (uniform on the sphere) at random times in [0, tMax].
// Counts satellites above the elevation mask and computes DOP from those.
// hist[k] = fraction of samples with exactly k visible satellites.
export function monteCarlo(sats, { n = 5000, maskDeg = 5, rng = Math.random, tMax = 86400, pdopLimit = 6 } = {}) {
  const sinMask = Math.sin((maskDeg * Math.PI) / 180);
  const hist = [];
  const pdops = [], gdops = [];
  let sumVis = 0, minVis = Infinity, maxVis = 0, ge4 = 0, good = 0;
  for (let i = 0; i < n; i++) {
    const z = 2 * rng() - 1, phi = 2 * Math.PI * rng(), r = Math.sqrt(1 - z * z);
    const up = [r * Math.cos(phi), r * Math.sin(phi), z];              // local vertical = unit position
    const t = rng() * tMax;
    const units = [];
    for (const sat of sats) {
      const p = satPosition(sat, t);
      const d = [p[0] - R_E * up[0], p[1] - R_E * up[1], p[2] - R_E * up[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      const u = [d[0] / len, d[1] / len, d[2] / len];
      if (u[0] * up[0] + u[1] * up[1] + u[2] * up[2] > sinMask) units.push(u); // sin(elevation) > sin(mask)
    }
    const nv = units.length;
    hist[nv] = (hist[nv] || 0) + 1;
    sumVis += nv; minVis = Math.min(minVis, nv); maxVis = Math.max(maxVis, nv);
    if (nv >= 4) ge4++;
    const dop = dopFromUnits(units);
    if (dop) {
      pdops.push(dop.pdop); gdops.push(dop.gdop);
      if (dop.pdop <= pdopLimit) good++;
    }
  }
  for (let k = 0; k <= maxVis; k++) hist[k] = (hist[k] || 0) / n;
  return {
    n, maskDeg, nSats: sats.length, pdopLimit, hist,
    meanVis: sumVis / n, minVis: n ? minVis : 0, maxVis,
    pGe4: ge4 / n, pGood: good / n,
    medPdop: median(pdops), medGdop: median(gdops),
  };
}
