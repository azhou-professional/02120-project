"""Entry points called from the web page (via Pyodide). Everything is returned
as a JSON string so the JavaScript side only has to draw it."""

import json
import math

import numpy as np

from . import constellation, geometry
from .dop import dop

DEFAULT_MASK_DEG = 0.0  # satellites below this elevation are not used (0 = geometric horizon)

ELEMENTS = constellation.walker(24, 6, 1)
NAMES = constellation.names(24, 6)
PLANE_OF = [i // 4 for i in range(len(ELEMENTS))]  # plane index of each satellite


def _clean(x):
    """NaN is not valid JSON, so undefined DOP values become null."""
    return None if isinstance(x, float) and math.isnan(x) else x


def snapshot(lat_deg, lon_deg, t_seconds, mask_deg=DEFAULT_MASK_DEG):
    """State of the sky for a receiver at (lat, lon) at time t seconds."""
    sat = constellation.positions(ELEMENTS, t_seconds)
    rx = geometry.receiver_position(lat_deg, lon_deg)
    enu = geometry.enu_basis(lat_deg, lon_deg)
    az, el, unit = geometry.look_angles(rx, sat, enu)
    visible = el >= mask_deg

    values = dop(unit[visible], enu)
    sat_lat, sat_lon = geometry.lat_lon(sat)
    return json.dumps({
        "t": t_seconds,
        "mask_deg": mask_deg,
        "receiver": rx.tolist(),
        "names": NAMES,
        "planes": PLANE_OF,
        # orbit information shown in the satellite hover tooltip
        "r_earth_km": geometry.R_EARTH,
        "elements": ELEMENTS.tolist(),                     # rows: radius km, inclination, RAAN, M0 (deg)
        "period_s": constellation.period(ELEMENTS[:, 0]).tolist(),
        "speed_kms": constellation.speed(ELEMENTS[:, 0]).tolist(),
        "u_deg": constellation.argument_of_latitude(ELEMENTS, t_seconds).tolist(),
        "sat_lat": sat_lat.tolist(),
        "sat_lon": sat_lon.tolist(),
        "sat_positions": sat.tolist(),
        "az": az.tolist(),
        "el": el.tolist(),
        "visible": visible.tolist(),
        "n_visible": int(visible.sum()),
        "dop": {k: _clean(v) for k, v in values.items()},
    })


def orbit_rings(n=181):
    """Points around each orbital plane (for drawing the orbits)."""
    rings = []
    for first in ELEMENTS[::4]:  # first satellite of each plane
        rows = np.tile(first, (n, 1))
        rows[:, 3] = np.linspace(0.0, 360.0, n)
        rings.append(constellation.positions(rows, 0.0).tolist())
    return json.dumps(rings)
