"""Receiver geometry: where a receiver is, and where a satellite appears in its sky.

Earth is a perfect sphere of radius R_EARTH (km) that rotates at the sidereal rate.

Frames: the satellites live in a fixed (inertial) frame with +z through the north
pole and +x toward the vernal equinox (the direction astronomers measure sidereal
time from). The Earth turns about +z, so a receiver at fixed (lat, lon) on the
ground moves through that frame. Latitude/longitude arguments below are always
Earth-fixed (what a map shows).

Time: t is seconds after the epoch, 2026-01-01 00:00:00 UTC. The angle between
longitude 0 (Greenwich) and +x is the Greenwich Mean Sidereal Time (GMST), so a
calendar date and time fixes where the Earth is turned. (Precession, nutation,
polar motion and the small UTC/UT1 difference are ignored.)

Every function works on a single receiver or on a whole array of receivers
(Monte Carlo trials): extra leading array dimensions are carried through.
"""

import numpy as np

R_EARTH = 6378.137          # km (WGS-84 equatorial radius, used as the sphere radius)
T_SIDEREAL = 86164.0905     # s, one rotation of the Earth relative to the stars
OMEGA_EARTH = 2.0 * np.pi / T_SIDEREAL   # rad/s


def julian_date(year, month, day, hour=0.0):
    """Julian Date of a UTC calendar date (Gregorian calendar), Meeus, Astronomical Algorithms, ch. 7."""
    if month <= 2:
        year, month = year - 1, month + 12
    a = year // 100
    b = 2 - a + a // 4
    return int(365.25 * (year + 4716)) + int(30.6001 * (month + 1)) + day + hour / 24.0 + b - 1524.5


def gmst_deg(jd):
    """Greenwich Mean Sidereal Time (degrees, 0-360) at Julian Date jd (UT), Meeus eq. 12.4."""
    T = (jd - 2451545.0) / 36525.0
    theta = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T**2 - T**3 / 38710000.0
    return theta % 360.0


EPOCH_UTC = "2026-01-01T00:00:00Z"                 # t = 0
EPOCH_JD = julian_date(2026, 1, 1)                 # 2461041.5
EARTH_ANGLE_AT_EPOCH = gmst_deg(EPOCH_JD)          # degrees, about 100.66 (GMST 6h 42m 39s)


def earth_angle_deg(t):
    """Angle (degrees) from inertial +x to longitude 0 at t seconds after the epoch: the GMST,
    which grows at the sidereal rate (one turn per 86,164.0905 s)."""
    return EARTH_ANGLE_AT_EPOCH + np.degrees(OMEGA_EARTH * np.asarray(t, dtype=float))


def receiver_position(lat_deg, lon_deg, t=0.0):
    """Receiver position (km) in the inertial frame at time t: shape (..., 3)."""
    lat, lon = np.broadcast_arrays(np.radians(lat_deg), np.radians(np.asarray(lon_deg) + earth_angle_deg(t)))
    return R_EARTH * np.stack([np.cos(lat) * np.cos(lon),
                               np.cos(lat) * np.sin(lon),
                               np.sin(lat)], axis=-1)


def enu_basis(lat_deg, lon_deg, t=0.0):
    """Local East, North, Up unit vectors (inertial frame, at time t) as the rows of a
    3x3 matrix: shape (..., 3, 3).

    Multiplying a vector by this matrix gives its (east, north, up) components.
    """
    lat, lon = np.broadcast_arrays(np.radians(lat_deg), np.radians(np.asarray(lon_deg) + earth_angle_deg(t)))
    east = np.stack([-np.sin(lon), np.cos(lon), np.zeros_like(lon)], axis=-1)
    north = np.stack([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)], axis=-1)
    up = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)
    return np.stack([east, north, up], axis=-2)


def inertial_to_earth_fixed(positions, t):
    """Rotate inertial positions (shape (..., N, 3)) at times t (shape (...) or a number) into the
    Earth-fixed frame, in which longitude 0 lies along +x: a rotation by minus the Earth's angle."""
    th = np.radians(earth_angle_deg(t))[..., None]
    x, y, z = positions[..., 0], positions[..., 1], positions[..., 2]
    return np.stack([np.cos(th) * x + np.sin(th) * y, -np.sin(th) * x + np.cos(th) * y, z], axis=-1)


def earth_fixed_position(lat_deg, lon_deg):
    """Receiver position (km) in the Earth-fixed frame (longitude 0 along +x), shape (..., 3)."""
    return receiver_position(lat_deg, np.asarray(lon_deg) - EARTH_ANGLE_AT_EPOCH, 0.0)


def earth_fixed_enu(lat_deg, lon_deg):
    """East, North, Up unit vectors in the Earth-fixed frame, shape (..., 3, 3)."""
    return enu_basis(lat_deg, np.asarray(lon_deg) - EARTH_ANGLE_AT_EPOCH, 0.0)


def lat_lon(positions, t=0.0):
    """Earth-fixed latitude and longitude (degrees, longitude in [-180, 180)) of the point
    straight below each inertial position at time t (the inverse of receiver_position,
    ignoring height). Works on shape (..., 3)."""
    p = np.asarray(positions, dtype=float)
    r = np.linalg.norm(p, axis=-1)
    lon = np.degrees(np.arctan2(p[..., 1], p[..., 0])) - earth_angle_deg(t)
    return np.degrees(np.arcsin(p[..., 2] / r)), (lon + 180.0) % 360.0 - 180.0


def blocking_angle(az_deg, terrain):
    """Elevation (degrees) below which the terrain around the receiver hides the sky, in the direction
    az_deg (same shape as az_deg). terrain is None (open sky) or {"type": "cone", "angle_deg": e}: a
    receiver at the bottom of a cone-shaped valley, whose walls rise to e degrees in every direction.
    (Other shapes would make this depend on the azimuth.)"""
    az = np.asarray(az_deg, dtype=float)
    if not terrain:
        return np.zeros_like(az)
    if terrain.get("type") == "cone":
        return np.full_like(az, float(terrain["angle_deg"]))
    raise ValueError(f"unknown terrain type {terrain.get('type')!r}")


def look_angles(rx, sat_positions, enu):
    """Azimuth, elevation and line-of-sight unit vectors from receiver(s) to satellites.

    Shapes for a single receiver: rx (3,), sat_positions (N, 3), enu (3, 3).
    For M receivers: rx (M, 3), sat_positions (M, N, 3), enu (M, 3, 3).

    Returns (az_deg, el_deg, unit_los):
      az_deg  : degrees clockwise from north, in [0, 360)       shape (..., N)
      el_deg  : degrees above the local horizontal plane        shape (..., N)
      unit_los: unit vectors from the receiver toward each satellite
                (same fixed frame as the positions)              shape (..., N, 3)
    """
    d = sat_positions - rx[..., None, :]
    unit = d / np.linalg.norm(d, axis=-1, keepdims=True)
    local = np.einsum("...ij,...nj->...ni", enu, unit)      # (east, north, up) of each unit vector
    east, north, up = local[..., 0], local[..., 1], local[..., 2]
    el = np.degrees(np.arcsin(np.clip(up, -1.0, 1.0)))
    az = np.degrees(np.arctan2(east, north)) % 360.0
    return az, el, unit
