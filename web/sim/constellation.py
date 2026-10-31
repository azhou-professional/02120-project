"""Satellite constellation: orbital elements and positions.

Model: two-body Kepler motion on circular orbits, nonrotating Earth, so the
inertial frame and the Earth-fixed frame are the same fixed frame.
Frame: origin at Earth's centre, +z through the north pole, +x through
(lat 0, lon 0), +y through (lat 0, lon 90E). Units: km, seconds, degrees.
"""

import numpy as np

MU = 398600.4418       # Earth's gravitational parameter, km^3/s^2
A_GPS = 26559.7        # nominal GPS orbit radius (semi-major axis), km
INC_GPS = 55.0         # nominal GPS inclination, degrees

# An "elements" table has one row per satellite with columns:
#   0: radius a (km)   1: inclination (deg)   2: RAAN (deg)   3: mean anomaly at t=0 (deg)
# (RAAN = right ascension of the ascending node, i.e. where the plane is tilted from.)


def walker(T=24, P=6, F=1, a=A_GPS, inc_deg=INC_GPS):
    """Walker delta pattern T/P/F: T satellites in P equally spaced planes.

    Plane p has RAAN = 360*p/P. Satellites inside a plane are spaced 360/(T/P)
    apart. Neighbouring planes are shifted along the orbit by F*360/T.
    Walker 24/6/1 is the idealized nominal GPS constellation.
    """
    per_plane = T // P
    rows = []
    for p in range(P):
        raan = 360.0 * p / P
        for s in range(per_plane):
            m0 = 360.0 * s / per_plane + 360.0 * F * p / T
            rows.append((a, inc_deg, raan, m0 % 360.0))
    return np.array(rows)


def names(T=24, P=6):
    """Labels like A1..A4, B1..B4, ... (letter = plane, number = slot in plane)."""
    per_plane = T // P
    return [f"{chr(ord('A') + p)}{s + 1}" for p in range(P) for s in range(per_plane)]


def mean_motion(a):
    """Angular rate along a circular orbit, rad/s: n = sqrt(mu/a^3)."""
    return np.sqrt(MU / np.asarray(a, dtype=float) ** 3)


def speed(a):
    """Speed on a circular orbit, km/s: sqrt(mu/a)."""
    return np.sqrt(MU / np.asarray(a, dtype=float))


def argument_of_latitude(elements, t):
    """Angle (degrees, 0-360) of each satellite along its orbit, measured from the
    ascending node (where it crosses the equator going north): u = M0 + n*t."""
    n = mean_motion(elements[:, 0])
    return (elements[:, 3] + np.degrees(n * np.asarray(t, dtype=float)[..., None])) % 360.0


def positions(elements, t):
    """Satellite positions (km) at time t seconds after t=0.

    t may be a number (result: N x 3) or an array of times (result: ... x N x 3,
    one set of N satellites per time).

    For a circular orbit the angle along the orbit is u = M0 + n*t, where
    n = sqrt(mu/a^3) is the mean motion. The position is the point
    a*(cos u, sin u, 0) in the orbit plane, rotated by inclination i about x,
    then by RAAN about z.
    """
    a = elements[:, 0]
    inc = np.radians(elements[:, 1])
    raan = np.radians(elements[:, 2])
    m0 = np.radians(elements[:, 3])

    u = m0 + mean_motion(a) * np.asarray(t, dtype=float)[..., None]   # shape (..., N)

    cu, su = np.cos(u), np.sin(u)
    ci, si = np.cos(inc), np.sin(inc)
    co, so = np.cos(raan), np.sin(raan)

    x = a * (co * cu - so * ci * su)
    y = a * (so * cu + co * ci * su)
    z = a * (si * su)
    return np.stack([x, y, z], axis=-1)


def period(a):
    """Orbital period in seconds: 2*pi*sqrt(a^3/mu)."""
    return 2.0 * np.pi * np.sqrt(a**3 / MU)
