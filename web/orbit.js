// Circular satellite orbits and the nominal GPS constellation (same model as main.py).
// Physics frame: Earth-centred, non-rotating, z = north pole. Units: metres, seconds, radians.
// A satellite is a plain object: { name, plane, a, inc, raan, u0 }
//   a = orbit radius, inc = inclination, raan = plane orientation, u0 = phase at t = 0.

export const GM = 3.986004418e14;      // m^3/s^2
export const R_E = 6371e3;             // m
export const A = 26560e3;              // GPS orbit radius (m)
export const INC = (55 * Math.PI) / 180;
export const N_PLANES = 6;
export const PER_PLANE = 4;
export const N_SAT = N_PLANES * PER_PLANE;

export const periodOf = (sat) => 2 * Math.PI * Math.sqrt(sat.a ** 3 / GM); // GPS: ~11.97 h

// Position [x, y, z] of a satellite at time t seconds.
export function satPosition(sat, t) {
  const u = (2 * Math.PI * t) / periodOf(sat) + sat.u0;                // argument of latitude
  const x = sat.a * Math.cos(u), y = sat.a * Math.sin(u);              // in-plane coordinates
  const px = x, py = y * Math.cos(sat.inc), pz = y * Math.sin(sat.inc); // tilt by inclination
  const cr = Math.cos(sat.raan), sr = Math.sin(sat.raan);              // rotate about z by RAAN
  return [cr * px - sr * py, sr * px + cr * py, pz];
}

// The nominal 24-satellite constellation: 6 planes x 4 satellites, phases staggered between planes.
export function nominalConstellation() {
  const sats = [];
  for (let i = 0; i < N_SAT; i++) {
    const plane = Math.floor(i / PER_PLANE), slot = i % PER_PLANE;
    sats.push({
      name: `GPS-${"ABCDEF"[plane]}${slot + 1}`,
      plane,
      a: A,
      inc: INC,
      raan: (2 * Math.PI * plane) / N_PLANES,
      u0: (2 * Math.PI * slot) / PER_PLANE + (plane * 2 * Math.PI) / N_SAT,
    });
  }
  return sats;
}
