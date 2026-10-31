"""Satellite orbits: orbital elements, Kepler's equation, positions, and derived quantities.

Model: two-body Kepler motion on circular or elliptical orbits (no perturbations).
Frame: the inertial frame, origin at Earth's centre, +z through the north pole. The
Earth rotates in this frame (see geometry.py); at t = 0 longitude 0 points along +x
and longitude 90E along +y. Units: km, seconds, degrees (angles in the tables).
"""

import numpy as np

from . import geometry

MU = 398600.4418       # Earth's gravitational parameter, km^3/s^2
A_GPS = 26559.7        # nominal GPS orbit radius (semi-major axis), km
INC_GPS = 55.0         # nominal GPS inclination, degrees

MAX_ECC = 0.9                  # largest eccentricity accepted
MIN_PERIGEE_ALT_KM = 160.0     # lowest perigee accepted (below this, drag would pull it down fast)
LCM_TOL = 0.03                 # cycles: how close to a whole number of orbits counts as "repeated"
LCM_MAX_DAYS = 3650            # longest common period searched (10 years)

# An "elements" table has one row per satellite and these columns (angles in degrees):
A, ECC, INC, RAAN, ARGP, M0 = range(6)
#   A    semi-major axis (km)                    ECC   eccentricity (0 = circle)
#   INC  inclination                             RAAN  right ascension of the ascending node
#   ARGP argument of perigee                     M0    mean anomaly at t = 0
# (The ascending node is where the orbit crosses the equator going north; RAAN is its angle
# from +x. Perigee is the closest point to Earth; the mean anomaly grows steadily in time
# and is 0 at perigee.)


def make_elements(a, ecc=0.0, inc_deg=0.0, raan_deg=0.0, argp_deg=0.0, m0_deg=0.0):
    """Elements table (rows x 6) from numbers or arrays (broadcast against each other)."""
    cols = np.broadcast_arrays(*[np.asarray(x, dtype=float) for x in (a, ecc, inc_deg, raan_deg, argp_deg, m0_deg)])
    return np.stack(cols, axis=-1).reshape(-1, 6)


def walker(T=24, P=6, F=1, a=A_GPS, inc_deg=INC_GPS):
    """Walker delta pattern T/P/F: T satellites in P equally spaced circular planes.

    Plane p has RAAN = 360*p/P. Satellites inside a plane are spaced 360/(T/P)
    apart. Neighbouring planes are shifted along the orbit by F*360/T.
    Walker 24/6/1 is the idealized nominal GPS constellation.
    """
    per_plane = T // P
    raan = np.repeat(360.0 * np.arange(P) / P, per_plane)
    slot = np.tile(np.arange(per_plane), P)
    plane = np.repeat(np.arange(P), per_plane)
    m0 = (360.0 * slot / per_plane + 360.0 * F * plane / T) % 360.0
    return make_elements(a, 0.0, inc_deg, raan, 0.0, m0)


def names(T=24, P=6):
    """Labels like A1..A4, B1..B4, ... (letter = plane, number = slot in plane)."""
    per_plane = T // P
    return [f"{chr(ord('A') + p)}{s + 1}" for p in range(P) for s in range(per_plane)]


def geostationary_radius():
    """Orbit radius (km) whose period equals one sidereal day: a = (mu * (T/2pi)^2)^(1/3).
    A circular equatorial orbit of this size turns with the Earth, so it hangs over one
    spot (geostationary)."""
    return (MU * (geometry.T_SIDEREAL / (2.0 * np.pi)) ** 2) ** (1.0 / 3.0)


def geostationary(lon_deg):
    """One geostationary satellite above longitude lon_deg (east). At t = 0 the Earth-fixed
    longitude equals the inertial angle, so the phase at t = 0 is simply the longitude."""
    return make_elements(geostationary_radius(), 0.0, 0.0, 0.0, 0.0, lon_deg)


def validate_orbit(a, ecc=0.0, inc_deg=0.0):
    """Raise ValueError (with a message fit to show the user) if the orbit is not allowed."""
    if not 0.0 <= ecc <= MAX_ECC:
        raise ValueError(f"eccentricity must be between 0 and {MAX_ECC}")
    if not 0.0 <= inc_deg <= 180.0:
        raise ValueError("inclination must be between 0 and 180 degrees")
    perigee_alt = a * (1.0 - ecc) - geometry.R_EARTH
    if perigee_alt < MIN_PERIGEE_ALT_KM:
        raise ValueError(f"perigee altitude {perigee_alt:.0f} km is below the minimum {MIN_PERIGEE_ALT_KM:.0f} km")


# ---- Kepler's equation -------------------------------------------------------------------

def mean_motion(a):
    """Average angular rate along an orbit, rad/s: n = sqrt(mu/a^3)."""
    return np.sqrt(MU / np.asarray(a, dtype=float) ** 3)


def period(a):
    """Orbital period in seconds: 2*pi*sqrt(a^3/mu)."""
    return 2.0 * np.pi * np.sqrt(np.asarray(a, dtype=float) ** 3 / MU)


def solve_kepler(M, ecc, tol=1e-13, max_iter=60):
    """Eccentric anomaly E (rad) from the mean anomaly M (rad): solve E - e sin(E) = M.

    Newton's method, started from E = M + 0.85 e sign(sin M) (which works for all e < 1).
    M is first wrapped into [-pi, pi); E - e sin E = M is unchanged by adding 2*pi to both,
    and everything we compute from E (cos E, sin E) repeats every 2*pi, so this is safe.
    """
    M = np.asarray(M, dtype=float)
    ecc = np.asarray(ecc, dtype=float)
    M = (M + np.pi) % (2.0 * np.pi) - np.pi
    E = M + 0.85 * ecc * np.sign(np.sin(M))
    for _ in range(max_iter):
        dE = (E - ecc * np.sin(E) - M) / (1.0 - ecc * np.cos(E))
        E = E - dE
        if np.max(np.abs(dE)) < tol:
            break
    return E


def _eccentric_anomaly(elements, t):
    a, ecc = elements[:, A], elements[:, ECC]
    M = np.radians(elements[:, M0]) + mean_motion(a) * np.asarray(t, dtype=float)[..., None]   # (..., N)
    return solve_kepler(M, ecc)


def _to_inertial(x_pf, y_pf, inc_deg, raan_deg, argp_deg):
    """Rotate a point (x_pf, y_pf, 0) in the orbit plane (x toward perigee) into the inertial
    frame: by the argument of perigee about the plane normal, by the inclination about the
    node line, then by the RAAN about the pole."""
    inc, raan, argp = np.radians(inc_deg), np.radians(raan_deg), np.radians(argp_deg)
    cw, sw = np.cos(argp), np.sin(argp)
    ci, si = np.cos(inc), np.sin(inc)
    co, so = np.cos(raan), np.sin(raan)
    x1 = x_pf * cw - y_pf * sw          # in the orbit plane, measured from the ascending node
    y1 = x_pf * sw + y_pf * cw
    return np.stack([co * x1 - so * ci * y1, so * x1 + co * ci * y1, si * y1], axis=-1)


def positions(elements, t):
    """Satellite positions (km) at time t seconds after t=0.

    t may be a number (result: N x 3) or an array of times (result: ... x N x 3,
    one set of N satellites per time).

    In the orbit plane (origin at Earth's centre, which is one focus of the ellipse, x toward
    perigee) the position is (a (cos E - e), a sqrt(1 - e^2) sin E), with E from Kepler's
    equation. For e = 0 this is the circle a (cos M, sin M).
    """
    a, ecc = elements[:, A], elements[:, ECC]
    E = _eccentric_anomaly(elements, t)
    x_pf = a * (np.cos(E) - ecc)
    y_pf = a * np.sqrt(1.0 - ecc**2) * np.sin(E)
    return _to_inertial(x_pf, y_pf, elements[:, INC], elements[:, RAAN], elements[:, ARGP])


def orbit_path(element, n=181):
    """n points around one orbit (for drawing it), shape (n, 3). `element` is one row."""
    a, ecc, inc, raan, argp, _ = np.asarray(element, dtype=float)
    E = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    return _to_inertial(a * (np.cos(E) - ecc), a * np.sqrt(1.0 - ecc**2) * np.sin(E), inc, raan, argp)


# ---- quantities derived from the orbit ----------------------------------------------------------

def radius(elements, t):
    """Distance from Earth's centre, km: r = a (1 - e cos E)."""
    return elements[:, A] * (1.0 - elements[:, ECC] * np.cos(_eccentric_anomaly(elements, t)))


def true_anomaly_deg(elements, t):
    """Angle from perigee to the satellite as seen from Earth's centre (degrees, 0-360)."""
    E, ecc = _eccentric_anomaly(elements, t), elements[:, ECC]
    nu = 2.0 * np.arctan2(np.sqrt(1.0 + ecc) * np.sin(E / 2.0), np.sqrt(1.0 - ecc) * np.cos(E / 2.0))
    return np.degrees(nu) % 360.0


def argument_of_latitude(elements, t):
    """Angle (degrees, 0-360) from the ascending node to the satellite, along the orbit:
    the argument of perigee plus the true anomaly. (For a circle with perigee at the node
    this is just M0 + n*t.)"""
    return (elements[:, ARGP] + true_anomaly_deg(elements, t)) % 360.0


def speed(elements, t):
    """Speed, km/s, from the vis-viva equation v^2 = mu (2/r - 1/a)."""
    return np.sqrt(MU * (2.0 / radius(elements, t) - 1.0 / elements[:, A]))


def circular_speed(a):
    """Speed on a circular orbit, km/s: sqrt(mu/a)."""
    return np.sqrt(MU / np.asarray(a, dtype=float))


def perigee_radius(elements):
    return elements[:, A] * (1.0 - elements[:, ECC])


def apogee_radius(elements):
    return elements[:, A] * (1.0 + elements[:, ECC])


def approx_common_period(periods, tol=LCM_TOL, max_days=LCM_MAX_DAYS):
    """Smallest time T after which every satellite has completed (nearly) a whole number of
    orbits, so the whole constellation looks (nearly) the same again; None if there is none
    within max_days.

    Real periods are never exact multiples of each other, so "least common multiple" needs a
    tolerance: T = k * (longest period), the smallest k for which T / period is within `tol`
    cycles of a whole number for every period. Returns (T seconds, worst mismatch in cycles).
    Periods equal to within one part in a million count as the same.
    """
    p = np.sort(np.asarray(periods, dtype=float))[::-1]
    if p.size == 0:
        return None
    distinct = [p[0]]
    for x in p[1:]:
        if abs(x - distinct[-1]) > 1e-6 * distinct[-1]:
            distinct.append(x)
    p = np.array(distinct)

    longest = p[0]
    max_k = int(max_days * 86400.0 // longest)
    if max_k < 1:
        return None
    T = np.arange(1, max_k + 1) * longest
    ratio = T[:, None] / p[None, :]
    mismatch = np.max(np.abs(ratio - np.round(ratio)), axis=1)
    ok = np.nonzero(mismatch <= tol)[0]
    return (float(T[ok[0]]), float(mismatch[ok[0]])) if ok.size else None
