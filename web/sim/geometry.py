"""Receiver geometry: where a receiver is, and where a satellite appears in its sky.

Earth is a perfect sphere of radius R_EARTH (km) that rotates at the sidereal rate.

Frames: the satellites live in a fixed (inertial) frame with +z through the north
pole. The Earth turns about +z, so a receiver at fixed (lat, lon) on the ground moves
through that frame. At t = 0 the Earth-fixed longitude 0 points along inertial +x.
Latitude/longitude arguments below are always Earth-fixed (what a map shows); the
time argument t (seconds) says how far the Earth has turned.

Every function works on a single receiver or on a whole array of receivers
(Monte Carlo trials): extra leading array dimensions are carried through.
"""

import numpy as np

R_EARTH = 6378.137          # km (WGS-84 equatorial radius, used as the sphere radius)
T_SIDEREAL = 86164.0905     # s, one rotation of the Earth relative to the stars
OMEGA_EARTH = 2.0 * np.pi / T_SIDEREAL   # rad/s


def earth_angle_deg(t):
    """Angle (degrees) the Earth has turned t seconds after t = 0."""
    return np.degrees(OMEGA_EARTH * np.asarray(t, dtype=float))


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


def lat_lon(positions, t=0.0):
    """Earth-fixed latitude and longitude (degrees, longitude in [-180, 180)) of the point
    straight below each inertial position at time t (the inverse of receiver_position,
    ignoring height). Works on shape (..., 3)."""
    p = np.asarray(positions, dtype=float)
    r = np.linalg.norm(p, axis=-1)
    lon = np.degrees(np.arctan2(p[..., 1], p[..., 0])) - earth_angle_deg(t)
    return np.degrees(np.arcsin(p[..., 2] / r)), (lon + 180.0) % 360.0 - 180.0


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
