"""Receiver geometry: where a receiver is, and where a satellite appears in its sky.

Earth is a perfect sphere of radius R_EARTH (km). Same frame as constellation.py.

Every function works on a single receiver or on a whole array of receivers
(Monte Carlo trials): extra leading array dimensions are carried through.
"""

import numpy as np

R_EARTH = 6378.137  # km (WGS-84 equatorial radius, used as the sphere radius)


def receiver_position(lat_deg, lon_deg):
    """Receiver position (km) on the surface: shape (..., 3)."""
    lat, lon = np.broadcast_arrays(np.radians(lat_deg), np.radians(lon_deg))
    return R_EARTH * np.stack([np.cos(lat) * np.cos(lon),
                               np.cos(lat) * np.sin(lon),
                               np.sin(lat)], axis=-1)


def enu_basis(lat_deg, lon_deg):
    """Local East, North, Up unit vectors as the rows of a 3x3 matrix: shape (..., 3, 3).

    Multiplying a vector by this matrix gives its (east, north, up) components.
    """
    lat, lon = np.broadcast_arrays(np.radians(lat_deg), np.radians(lon_deg))
    east = np.stack([-np.sin(lon), np.cos(lon), np.zeros_like(lon)], axis=-1)
    north = np.stack([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)], axis=-1)
    up = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)
    return np.stack([east, north, up], axis=-2)


def lat_lon(positions):
    """Latitude and longitude (degrees) of the point straight below each position
    (the inverse of receiver_position, ignoring height). Works on shape (..., 3)."""
    p = np.asarray(positions, dtype=float)
    r = np.linalg.norm(p, axis=-1)
    return np.degrees(np.arcsin(p[..., 2] / r)), np.degrees(np.arctan2(p[..., 1], p[..., 0]))


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
