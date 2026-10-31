"""Real GPS orbits from almanacs (YUMA text format), as broadcast by the satellites.

The almanac gives, for each satellite, Kepler elements at a reference time toa (seconds into
the GPS week) plus the slow drift of the orbit plane. Positions follow the standard user
algorithm of the GPS interface specification IS-GPS-200 (Table 20-IV), simplified as the
almanac allows (no harmonic corrections). The result is Earth-fixed (ECEF): x toward
longitude 0, z toward the north pole.

Used for Stage 5: reproducing the FAA's 1999 coverage statistics with the real constellation.
"""

import datetime as dt
from pathlib import Path

import numpy as np

from . import constellation, geometry

MU_GPS = 3.986005e14              # m^3/s^2, the value GPS uses (IS-GPS-200)
OMEGA_E_GPS = 7.2921151467e-5     # rad/s, Earth rotation rate GPS uses
GPS_EPOCH = dt.datetime(1980, 1, 6)          # start of GPS week 0 (GPS time)
GPS_MINUS_UTC_1999 = 13.0                    # seconds: leap seconds between GPS time and UTC in 1999

ALMANAC_DIR = Path(__file__).resolve().parent.parent / "data" / "almanac" / "1999"

# YUMA field names -> our keys
_FIELDS = {
    "ID": "prn", "Health": "health", "Eccentricity": "e", "Time of Applicability(s)": "toa",
    "Orbital Inclination(rad)": "i0", "Rate of Right Ascen(r/s)": "omega_dot", "SQRT(A)  (m^1/2)": "sqrt_a",
    "Right Ascen at TOA(rad)": "omega0", "Argument of Perigee(rad)": "argp", "Mean Anom(rad)": "m0", "week": "week",
}


def parse_yuma(text):
    """List of satellites, each a dict with prn, health, e, toa, i0, omega_dot, sqrt_a, omega0,
    argp, m0 (radians and seconds as in the file) and week."""
    satellites, current = [], None
    for line in text.splitlines():
        if line.startswith("****"):
            current = {}
            satellites.append(current)
            continue
        if ":" not in line or current is None:
            continue
        name, value = line.split(":", 1)
        key = _FIELDS.get(name.strip()) or _FIELDS.get(name.rstrip())
        if key:
            current[key] = int(value) if key in ("prn", "health", "week") else float(value)
    return satellites


def load_week(week, healthy_only=True):
    """The almanac for one GPS week of 1999 (weeks 1003-1016 are in the repository)."""
    path = next(ALMANAC_DIR.glob(f"almanac.yuma.week{week}.*.txt"))
    sats = parse_yuma(path.read_text())
    return [s for s in sats if s["health"] == 0] if healthy_only else sats


def _arrays(sats):
    return {k: np.array([s[k] for s in sats], dtype=float) for k in ("e", "toa", "i0", "omega_dot", "sqrt_a", "omega0", "argp", "m0")}


def ecef_positions(sats, t):
    """Earth-fixed positions (km) of the satellites at GPS time t, given as seconds from the start
    of the almanac's week (t may exceed one week; it is not wrapped). t may be an array: the
    result then has shape (..., N, 3)."""
    a = _arrays(sats)
    A = a["sqrt_a"] ** 2                                    # semi-major axis, m
    n0 = np.sqrt(MU_GPS / A**3)                             # mean motion, rad/s
    tk = np.asarray(t, dtype=float)[..., None] - a["toa"]   # time since the almanac's reference time
    E = constellation.solve_kepler(a["m0"] + n0 * tk, a["e"])
    nu = np.arctan2(np.sqrt(1.0 - a["e"] ** 2) * np.sin(E), np.cos(E) - a["e"])   # true anomaly
    u = nu + a["argp"]                                      # argument of latitude
    r = A * (1.0 - a["e"] * np.cos(E))
    # longitude of the ascending node in the Earth-fixed frame: the plane drifts (omega_dot)
    # while the Earth turns underneath it (OMEGA_E_GPS)
    node = a["omega0"] + (a["omega_dot"] - OMEGA_E_GPS) * tk - OMEGA_E_GPS * a["toa"]
    xp, yp = r * np.cos(u), r * np.sin(u)
    ci, si = np.cos(a["i0"]), np.sin(a["i0"])
    x = xp * np.cos(node) - yp * ci * np.sin(node)
    y = xp * np.sin(node) + yp * ci * np.cos(node)
    z = yp * si
    return np.stack([x, y, z], axis=-1) / 1000.0


def toa_datetime_utc(sats):
    """The almanac's reference time as a UTC date and time."""
    s = sats[0]
    return GPS_EPOCH + dt.timedelta(weeks=s["week"], seconds=s["toa"] - GPS_MINUS_UTC_1999)


def to_elements(sats):
    """Our orbital elements (a km, e, i, RAAN, argp, M0 in degrees; see constellation.py) placing the
    satellites exactly where the almanac puts them at its reference time, on our timeline (seconds
    after 2026-01-01 UTC). The slow drift of the orbit plane (about -0.04 deg/day) is left out, so the
    positions are right near that date and drift apart over months."""
    a = _arrays(sats)
    t_toa = (toa_datetime_utc(sats) - dt.datetime(2026, 1, 1)).total_seconds()      # negative: 1999
    A = a["sqrt_a"] ** 2 / 1000.0
    node_ecef_at_toa = a["omega0"] - OMEGA_E_GPS * a["toa"]                          # radians
    raan = np.degrees(node_ecef_at_toa) + geometry.earth_angle_deg(t_toa)            # Earth-fixed -> inertial
    m0 = np.degrees(a["m0"]) - np.degrees(constellation.mean_motion(A)) * t_toa      # wind the phase back to t = 0
    return constellation.make_elements(A, a["e"], np.degrees(a["i0"]), raan % 360.0, np.degrees(a["argp"]) % 360.0, m0 % 360.0)
