"""Entry points called from the web page (via Pyodide). Everything is returned
as a JSON string so the JavaScript side only has to draw it.

The page owns the list of satellites (names, colours, which are switched on) and sends the
numbers to Python with set_constellation(); snapshot() then works on that constellation."""

import json
import math

import numpy as np

from . import constellation, geometry, presets
from .dop import dop

DEFAULT_MASK_DEG = 0.0       # satellites below this elevation are not used (0 = geometric horizon)
MAX_SATELLITES = 300         # most satellites the page may hold at once
MAX_WALKER_SATELLITES = 120  # largest single Walker set

# The constellation snapshot() works on: an elements table and, for each satellite, whether it is
# switched on. Switched-off satellites are drawn as ghosts but do not count for visibility or DOP.
_state = {"elements": presets.gps(), "enabled": np.ones(24, dtype=bool), "terrain": None}
MAX_TERRAIN_DEG = 80.0       # steepest valley wall allowed


def _clean(x):
    """NaN is not valid JSON, so undefined DOP values become null."""
    return None if isinstance(x, float) and math.isnan(x) else x


# ---- the sky seen by one receiver ------------------------------------------------------------

def snapshot(lat_deg, lon_deg, t_seconds, mask_deg=DEFAULT_MASK_DEG):
    """State of the sky for a receiver at (lat, lon) at time t seconds."""
    elements, enabled = _state["elements"], _state["enabled"]
    sat = constellation.positions(elements, t_seconds)
    rx = geometry.receiver_position(lat_deg, lon_deg, t_seconds)   # inertial position: the Earth turns
    enu = geometry.enu_basis(lat_deg, lon_deg, t_seconds)
    az, el, unit = geometry.look_angles(rx, sat, enu)
    # usable: switched on and above both the mask and the terrain in its direction
    limit = np.maximum(mask_deg, geometry.blocking_angle(az, _state["terrain"]))
    visible = (el >= limit) & enabled
    blocked = enabled & (el >= mask_deg) & ~visible                 # above the horizon but hidden by the terrain

    values = dop(unit[visible], enu)
    sat_lat, sat_lon = geometry.lat_lon(sat, t_seconds)             # Earth-fixed point below each satellite
    return json.dumps({
        "t": t_seconds,
        "earth_angle_deg": float(geometry.earth_angle_deg(t_seconds)),
        "mask_deg": float(np.max(limit)) if len(limit) else float(mask_deg),   # for a cone: the cone angle
        "terrain": _state["terrain"],
        "receiver": rx.tolist(),
        # orbit information shown in the satellite hover tooltip
        "r_earth_km": geometry.R_EARTH,
        "elements": elements.tolist(),          # rows: a (km), e, inclination, RAAN, arg. of perigee, M0 (deg)
        "period_s": constellation.period(elements[:, constellation.A]).tolist(),
        "speed_kms": constellation.speed(elements, t_seconds).tolist(),
        "radius_km": constellation.radius(elements, t_seconds).tolist(),
        "perigee_alt_km": (constellation.perigee_radius(elements) - geometry.R_EARTH).tolist(),
        "apogee_alt_km": (constellation.apogee_radius(elements) - geometry.R_EARTH).tolist(),
        "nu_deg": constellation.true_anomaly_deg(elements, t_seconds).tolist(),
        "u_deg": constellation.argument_of_latitude(elements, t_seconds).tolist(),
        "sat_lat": sat_lat.tolist(),
        "sat_lon": sat_lon.tolist(),
        "sat_positions": sat.tolist(),
        "az": az.tolist(),
        "el": el.tolist(),
        "enabled": enabled.tolist(),
        "visible": visible.tolist(),
        "blocked": blocked.tolist(),
        "n_visible": int(visible.sum()),
        "dop": {k: _clean(v) for k, v in values.items()},
    })


# ---- the constellation --------------------------------------------------------------------------

def orbit_paths(elements, n=181):
    """Points around each distinct orbit (for drawing it) and, for every satellite, which orbit
    it is on. Satellites that differ only in their phase share an orbit (one ring)."""
    index, paths, ring_of = {}, [], []
    for row in elements:
        key = tuple(np.round(row[:constellation.M0], 9))          # same orbit if all but the phase match
        if key not in index:
            index[key] = len(paths)
            paths.append(constellation.orbit_path(row, n).tolist())
        ring_of.append(index[key])
    return paths, ring_of


def set_terrain(terrain_json):
    """Set the terrain around the receiver: "null" for open sky or {"type": "cone", "angle_deg": e}."""
    terrain = json.loads(terrain_json)
    if terrain is not None:
        if terrain.get("type") != "cone":
            raise ValueError("only the cone terrain is available")
        angle = float(terrain["angle_deg"])
        if not 0.0 <= angle <= MAX_TERRAIN_DEG:
            raise ValueError(f"the blocking angle must be between 0 and {MAX_TERRAIN_DEG:.0f} degrees")
        terrain = {"type": "cone", "angle_deg": angle}
    _state["terrain"] = terrain
    return json.dumps(terrain)


def set_constellation(elements_json, enabled_json):
    """Replace the constellation. Returns the orbit rings to draw: {"paths", "ring_of"}."""
    elements = np.array(json.loads(elements_json), dtype=float).reshape(-1, 6)
    enabled = np.array(json.loads(enabled_json), dtype=bool).reshape(-1)
    if len(elements) != len(enabled):
        raise ValueError("elements and enabled flags must have the same length")
    if len(elements) > MAX_SATELLITES:
        raise ValueError(f"at most {MAX_SATELLITES} satellites are allowed")
    _state["elements"], _state["enabled"] = elements, enabled
    paths, ring_of = orbit_paths(elements)
    return json.dumps({"paths": paths, "ring_of": ring_of})


def epoch_info():
    """The calendar moment of t = 0 (for the page's date picker and timeline)."""
    return json.dumps({"epoch_utc": geometry.EPOCH_UTC, "earth_angle_at_epoch_deg": geometry.EARTH_ANGLE_AT_EPOCH})


def common_period(elements_json):
    """The approximate least common multiple of the orbital periods of these satellites (see
    constellation.approx_common_period). Returns {"found": true, "days", "seconds", "mismatch_deg"},
    where mismatch_deg is the worst phase error after that time, or {"found": false, "reason"}."""
    elements = np.array(json.loads(elements_json), dtype=float).reshape(-1, 6)
    if len(elements) == 0:
        return json.dumps({"found": False, "reason": "there are no satellites"})
    result = constellation.approx_common_period(constellation.period(elements[:, constellation.A]))
    if result is None:
        return json.dumps({"found": False, "reason": f"no common period within {constellation.LCM_MAX_DAYS // 365} years"})
    seconds, mismatch_cycles = result
    return json.dumps({"found": True, "days": seconds / 86400.0, "seconds": seconds, "mismatch_deg": 360.0 * mismatch_cycles})


def preset_info():
    """The ready-made constellations: key, label, label prefix, system, number of satellites."""
    return json.dumps([{"key": key, "label": p["label"], "short": p["short"], "system": p["system"],
                        "count": len(p["build"]())} for key, p in presets.PRESETS.items()])


def preset_elements(key):
    p = presets.PRESETS[key]
    return json.dumps({"elements": p["build"]().tolist(), "names": p["names"]()})


# ---- building satellites from the forms ---------------------------------------------------------------

def _number(params, key, label):
    value = params.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a number")
    return float(value)


def _orbit_info(row):
    a, ecc = row[constellation.A], row[constellation.ECC]
    return {"a_km": a, "ecc": ecc, "period_s": float(constellation.period(a)),
            "perigee_alt_km": a * (1.0 - ecc) - geometry.R_EARTH,
            "apogee_alt_km": a * (1.0 + ecc) - geometry.R_EARTH}


def orbit_from_form(params_json):
    """One satellite from the 'add a satellite' form. Returns {"ok": true, "elements": [6 numbers],
    "info": {...}} or {"ok": false, "error": "message"}.

    params: geo (geostationary: only lon is used), lon, alt (altitude, km; the perigee altitude if
    elliptical), inc, raan, phase (mean anomaly at t = 0), elliptical, apogee (altitude, km), argp."""
    try:
        p = json.loads(params_json)
        if p.get("geo"):
            row = constellation.geostationary(_number(p, "lon", "longitude"))
        else:
            hp = _number(p, "alt", "altitude")
            inc = _number(p, "inc", "inclination")
            raan = _number(p, "raan", "RAAN")
            phase = _number(p, "phase", "starting phase")
            if p.get("elliptical"):
                ha = _number(p, "apogee", "apogee altitude")
                argp = _number(p, "argp", "argument of perigee")
                if ha < hp:
                    raise ValueError("apogee altitude must be at least the perigee altitude")
                a = geometry.R_EARTH + (hp + ha) / 2.0
                ecc = (ha - hp) / (ha + hp + 2.0 * geometry.R_EARTH)
            else:
                a, ecc, argp = geometry.R_EARTH + hp, 0.0, 0.0
            constellation.validate_orbit(a, ecc, inc)
            row = constellation.make_elements(a, ecc, inc, raan, argp, phase)
        return json.dumps({"ok": True, "elements": row[0].tolist(), "info": _orbit_info(row[0])})
    except ValueError as err:
        return json.dumps({"ok": False, "error": str(err)})


def walker_from_form(params_json):
    """A Walker T/P/F constellation. Returns {"ok": true, "elements": [...], "names": [...]} or
    {"ok": false, "error": "message"}. params: T, P, F, alt (altitude, km), inc."""
    try:
        p = json.loads(params_json)
        T, P, F = (_number(p, k, k) for k in ("T", "P", "F"))
        if not (T.is_integer() and P.is_integer() and F.is_integer()):
            raise ValueError("T, P and F must be whole numbers")
        T, P, F = int(T), int(P), int(F)
        alt, inc = _number(p, "alt", "altitude"), _number(p, "inc", "inclination")
        if not 1 <= P <= 26:
            raise ValueError("P (planes) must be between 1 and 26")
        if T < P or T % P != 0:
            raise ValueError("T (satellites) must be a multiple of P (planes)")
        if T > MAX_WALKER_SATELLITES:
            raise ValueError(f"T may be at most {MAX_WALKER_SATELLITES}")
        if not 0 <= F <= P - 1:
            raise ValueError(f"F must be between 0 and P - 1 = {P - 1}")
        a = geometry.R_EARTH + alt
        constellation.validate_orbit(a, 0.0, inc)
        return json.dumps({"ok": True, "elements": constellation.walker(T, P, F, a, inc).tolist(),
                           "names": constellation.names(T, P)})
    except ValueError as err:
        return json.dumps({"ok": False, "error": str(err)})
