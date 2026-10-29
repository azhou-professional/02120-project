// Nominal GPS constellation: 6 planes x 4 satellites, circular orbits.
// Same model as main.py. Physics frame: Earth-centred, z = north pole. Units: metres, seconds.

export const GM = 3.986004418e14;      // m^3/s^2
export const R_E = 6371e3;             // m
export const A = 26560e3;              // GPS orbit radius (m)
export const INC = (55 * Math.PI) / 180;
export const N_PLANES = 6;
export const PER_PLANE = 4;
export const N_SAT = N_PLANES * PER_PLANE;
export const PERIOD = 2 * Math.PI * Math.sqrt(A ** 3 / GM); // ~11.97 h

// Position [x, y, z] of satellite `idx` (0..23) at time t seconds.
export function satPosition(idx, t) {
  const plane = Math.floor(idx / PER_PLANE);
  const slot = idx % PER_PLANE;
  const raan = (2 * Math.PI * plane) / N_PLANES;                       // plane orientation
  const u0 = (2 * Math.PI * slot) / PER_PLANE + (plane * 2 * Math.PI) / N_SAT; // phase, staggered
  const u = (2 * Math.PI * t) / PERIOD + u0;                           // argument of latitude
  const x = A * Math.cos(u), y = A * Math.sin(u);                      // in-plane coordinates
  const px = x, py = y * Math.cos(INC), pz = y * Math.sin(INC);        // tilt by inclination
  const cr = Math.cos(raan), sr = Math.sin(raan);                      // rotate about z by RAAN
  return [cr * px - sr * py, sr * px + cr * py, pz];
}
