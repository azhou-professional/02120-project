// Checks for orbit.js and dop.js. Open test.html in a browser (or see README of the run command).
import { R_E, A, INC, N_SAT, nominalConstellation, satPosition } from "./orbit.js";
import { dopFromUnits, monteCarlo } from "./dop.js";
import { isLand } from "./earth.js";

const results = [];
const check = (name, ok, detail) => results.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);

// Small seeded random generator (mulberry32) so the Monte Carlo checks are repeatable.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sats = nominalConstellation();

// 1. Constellation: 24 satellites, all at radius A, none beyond |z| = A sin(inc).
let maxR = 0, maxZ = 0;
for (const s of sats) for (let t = 0; t < 43200; t += 600) {
  const p = satPosition(s, t);
  maxR = Math.max(maxR, Math.abs(Math.hypot(...p) - A)); maxZ = Math.max(maxZ, Math.abs(p[2]));
}
check("24 satellites", sats.length === N_SAT, `got ${sats.length}`);
check("circular orbit radius", maxR < 1e-3, `max |r - A| = ${maxR.toExponential(2)} m`);
check("max |z| = A sin(55 deg)", Math.abs(maxZ / A - Math.sin(INC)) < 1e-3, `${(maxZ / A).toFixed(4)} vs ${Math.sin(INC).toFixed(4)}`);

// 2. JS positions vs numpy positions from main.py at t = 12345 s (satellites 0, 5, 17).
const ref = { 0: [-6050073.3647, 14833691.5031, 21184706.9527], 5: [-5479587.2036, -23873279.2226, -10270066.3705], 17: [-8782221.0721, 13951633.7671, -20824459.3757] };
for (const [i, r] of Object.entries(ref)) {
  const p = satPosition(sats[i], 12345);
  const err = Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]);
  check(`satellite ${i} matches main.py`, err < 1, `error ${err.toExponential(2)} m`);
}

// 3. DOP by hand: one satellite at zenith + three on the horizon 120 deg apart in azimuth.
//    G^T G is block diagonal, so PDOP = sqrt(8/3), GDOP = sqrt(3).
const s3 = Math.sqrt(3) / 2;
const d = dopFromUnits([[0, 0, 1], [1, 0, 0], [-0.5, s3, 0], [-0.5, -s3, 0]]);
check("hand DOP: PDOP", Math.abs(d.pdop - Math.sqrt(8 / 3)) < 1e-9, `${d.pdop.toFixed(4)} vs ${Math.sqrt(8 / 3).toFixed(4)}`);
check("hand DOP: GDOP", Math.abs(d.gdop - Math.sqrt(3)) < 1e-9, `${d.gdop.toFixed(4)} vs ${Math.sqrt(3).toFixed(4)}`);
check("fewer than 4 satellites gives no DOP", dopFromUnits([[0, 0, 1], [1, 0, 0], [0, 1, 0]]) === null, "");

// 4. One satellite: Monte Carlo coverage vs analytic spherical-cap fraction.
//    Earth central angle seen at elevation mask e is lam = arccos(R cos e / a) - e; the cap covers (1 - cos lam) / 2.
const e = (5 * Math.PI) / 180;
const exact = (1 - Math.cos(Math.acos((R_E * Math.cos(e)) / A) - e)) / 2;
const n = 20000;
const one = monteCarlo([sats[0]], { n, maskDeg: 5, rng: seeded(1) });
const sim = one.hist[1] || 0, se = Math.sqrt((exact * (1 - exact)) / n);
check("1 satellite coverage vs analytic", Math.abs(sim - exact) < 4 * se, `MC ${sim.toFixed(4)} vs ${exact.toFixed(4)} (std err ${se.toFixed(4)})`);

// 5. Full constellation vs the numpy run of main.py (mean 8.12 visible, median PDOP 1.72, PDOP <= 6 always).
const all = monteCarlo(sats, { n, maskDeg: 5, rng: seeded(2) });
check("mean visible ~ 8.12", Math.abs(all.meanVis - 8.12) < 0.1, `got ${all.meanVis.toFixed(3)}`);
check("median PDOP ~ 1.72", Math.abs(all.medPdop - 1.72) < 0.05, `got ${all.medPdop.toFixed(3)}`);
check("P(PDOP <= 6) >= 0.98 (SPS standard)", all.pGood >= 0.98, `got ${all.pGood.toFixed(4)}`);

// 6. Low-poly Earth map: known places must be land or sea (lat, lon).
const places = [["Pittsburgh", 40.4, -80, true], ["London", 51.5, -0.1, true], ["Cairo", 30, 31.2, true], ["Tokyo", 35.7, 139.7, true],
  ["Sydney", -33.9, 151.2, true], ["Sao Paulo", -23.5, -46.6, true], ["Moscow", 55.8, 37.6, true], ["Beijing", 39.9, 116.4, true],
  ["Mumbai", 19.1, 72.9, true], ["Cape Town", -33.9, 18.5, true], ["South Pole", -90, 0, true], ["Sahara", 23, 12, true],
  ["Reykjavik", 64.1, -21.9, true], ["Nairobi", -1.3, 36.8, true], ["Mexico City", 19.4, -99.1, true],
  ["mid-Pacific", 0, -150, false], ["mid-Atlantic", 20, -40, false], ["Indian Ocean", -20, 80, false], ["Mediterranean", 34, 18, false],
  ["Black Sea", 43, 34, false], ["Caspian Sea", 42, 51, false], ["North Pole", 89, 0, false], ["Gulf of Mexico", 25, -90, false],
  ["Southern Ocean", -55, 100, false], ["Bay of Bengal", 14, 88, false], ["Arabian Sea", 15, 65, false]];
const wrong = places.filter(([, lat, lon, land]) => isLand(lat, lon) !== land).map((p) => p[0]);
check("map: 26 known places land/sea", wrong.length === 0, wrong.length ? "wrong: " + wrong.join(", ") : "all correct");

const bad = results.filter((r) => r.startsWith("FAIL")).length;
document.getElementById("out").textContent = results.join("\n") + `\n\n${bad === 0 ? "ALL PASSED" : bad + " FAILED"}`;
