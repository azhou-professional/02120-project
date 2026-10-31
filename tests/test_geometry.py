"""Checks receiver geometry: positions, local frame, elevation and azimuth."""

import numpy as np
import pytest

from sim import constellation as c
from sim import geometry as g


def look(lat, lon, sat):
    rx = g.receiver_position(lat, lon)
    return g.look_angles(rx, np.array([sat], dtype=float), g.enu_basis(lat, lon))


def test_receiver_positions():
    assert np.allclose(g.receiver_position(0, 0), [g.R_EARTH, 0, 0])
    assert np.allclose(g.receiver_position(0, 90), [0, g.R_EARTH, 0], atol=1e-9)
    assert np.allclose(g.receiver_position(90, 0), [0, 0, g.R_EARTH], atol=1e-9)


def test_enu_at_lat0_lon0():
    east, north, up = g.enu_basis(0, 0)
    assert np.allclose(east, [0, 1, 0])
    assert np.allclose(north, [0, 0, 1])
    assert np.allclose(up, [1, 0, 0])


@pytest.mark.parametrize("lat,lon", [(0, 0), (40.4, -80.0), (-33.9, 151.2), (89.0, 10.0)])
def test_enu_is_orthonormal_and_right_handed(lat, lon):
    B = g.enu_basis(lat, lon)
    assert np.allclose(B @ B.T, np.eye(3))
    assert np.allclose(np.cross(B[0], B[1]), B[2])        # east x north = up


@pytest.mark.parametrize("lat,lon", [(0, 0), (40.4, -80.0), (-33.9, 151.2), (89.0, 10.0), (-10, -179)])
def test_lat_lon_inverts_receiver_position(lat, lon):
    la, lo = g.lat_lon(g.receiver_position(lat, lon))
    assert np.isclose(la, lat) and np.isclose(lo, lon)
    la, lo = g.lat_lon(3.0 * g.receiver_position(lat, lon))        # height does not matter
    assert np.isclose(la, lat) and np.isclose(lo, lon)


def test_satellite_ground_latitude_never_exceeds_inclination():
    """With 55 deg inclination the sub-satellite latitude stays within +-55 deg and reaches it."""
    elements = c.walker(24, 6, 1)
    lats = np.array([g.lat_lon(c.positions(elements, t))[0] for t in np.linspace(0, c.period(c.A_GPS), 400)])
    assert np.abs(lats).max() <= 55.0 + 1e-9
    assert np.abs(lats).max() > 54.9


# ---- rotating Earth ---------------------------------------------------------------------

def test_earth_turns_once_per_sidereal_day():
    assert np.isclose(g.earth_angle_deg(0.0), 0.0)
    assert np.isclose(g.earth_angle_deg(g.T_SIDEREAL), 360.0)
    assert np.isclose(g.earth_angle_deg(g.T_SIDEREAL / 4), 90.0)
    assert abs(g.T_SIDEREAL / 3600 - 23.9345) < 1e-3                   # 23 h 56 min 4 s


def test_receiver_moves_with_the_earth():
    quarter = g.T_SIDEREAL / 4
    assert np.allclose(g.receiver_position(0, 0, quarter), [0, g.R_EARTH, 0], atol=1e-6)    # lon 0 -> +y
    assert np.allclose(g.receiver_position(90, 0, quarter), [0, 0, g.R_EARTH], atol=1e-6)   # pole stays put
    assert np.allclose(g.receiver_position(40, -80, g.T_SIDEREAL), g.receiver_position(40, -80), atol=1e-6)


def test_local_frame_turns_with_the_earth():
    east, north, up = g.enu_basis(0, 0, g.T_SIDEREAL / 4)
    assert np.allclose(east, [-1, 0, 0], atol=1e-12)    # east, up, north all carried round by 90 degrees
    assert np.allclose(up, [0, 1, 0], atol=1e-12)
    assert np.allclose(north, [0, 0, 1], atol=1e-12)


@pytest.mark.parametrize("t", [0.0, 1000.0, 30000.0, 86164.0905, 400000.0])
def test_lat_lon_inverts_receiver_position_at_any_time(t):
    for lat, lon in [(0, 0), (40.4, -80.0), (-33.9, 151.2), (-10, -179)]:
        la, lo = g.lat_lon(g.receiver_position(lat, lon, t), t)
        assert np.isclose(la, lat) and np.isclose(lo, lon)


def test_geostationary_satellite_hangs_over_one_spot():
    a_geo = c.geostationary_radius()
    assert abs(a_geo - 42164.17) < 0.05
    assert np.isclose(c.period(a_geo), g.T_SIDEREAL)                    # period = one sidereal day
    lon_sat = 77.5
    one = c.geostationary(lon_sat)                                      # equatorial circle, phase = longitude at t=0
    for t in np.linspace(0, 3 * g.T_SIDEREAL, 25):
        lat, lon = g.lat_lon(c.positions(one, t), t)
        assert np.isclose(lat[0], 0.0, atol=1e-9) and np.isclose(lon[0], lon_sat, atol=1e-9)
        # seen from the equator right below it, it stays at the zenith all the time
        rx, enu = g.receiver_position(0, lon_sat, t), g.enu_basis(0, lon_sat, t)
        _, el, _ = g.look_angles(rx, c.positions(one, t), enu)
        assert np.isclose(el[0], 90.0, atol=1e-6)


def test_gps_ground_view_repeats_after_a_sidereal_day():
    """GPS makes ~2 revolutions per sidereal day, so a fixed ground site sees (almost) the same
    sky one sidereal day later (the nominal orbit radius gives 2.0002 revolutions)."""
    elements = c.walker(24, 6, 1)
    lat, lon = 40.4, -80.0
    for t in (0.0, 15000.0, 50000.0):
        els = []
        for tt in (t, t + g.T_SIDEREAL):
            rx, enu = g.receiver_position(lat, lon, tt), g.enu_basis(lat, lon, tt)
            els.append(g.look_angles(rx, c.positions(elements, tt), enu)[1])
        assert np.max(np.abs(els[0] - els[1])) < 0.5                    # degrees


def test_satellite_overhead_is_90_deg():
    _, el, _ = look(30, 50, 3 * g.R_EARTH * g.receiver_position(30, 50) / g.R_EARTH)
    assert np.isclose(el[0], 90.0)


def test_azimuth_north_and_east():
    # receiver at (0,0); satellite above (lat 10, lon 0) is due north, above (0, 10) due east
    az_n, el_n, _ = look(0, 0, c.A_GPS * np.array([np.cos(np.radians(10)), 0, np.sin(np.radians(10))]))
    az_e, el_e, _ = look(0, 0, c.A_GPS * np.array([np.cos(np.radians(10)), np.sin(np.radians(10)), 0]))
    assert np.isclose(az_n[0], 0.0, atol=1e-9) or np.isclose(az_n[0], 360.0)
    assert np.isclose(az_e[0], 90.0)
    assert el_n[0] > 0 and el_e[0] > 0


@pytest.mark.parametrize("mask_deg", [0.0, 5.0, 10.0, 30.0])
def test_coverage_cap_edge_has_elevation_equal_to_mask(mask_deg):
    """Analytic coverage of one satellite at radius a: central angle
    lambda = arccos(R cos(eps) / a) - eps. A receiver exactly lambda away from
    the sub-satellite point must see the satellite at elevation eps."""
    eps = np.radians(mask_deg)
    lam = np.arccos(g.R_EARTH * np.cos(eps) / c.A_GPS) - eps
    sat = [c.A_GPS, 0.0, 0.0]                               # sub-satellite point is (0, 0)
    _, el_edge, _ = look(0, np.degrees(lam), sat)
    assert np.isclose(el_edge[0], mask_deg, atol=1e-8)
    _, el_in, _ = look(0, np.degrees(lam) * 0.99, sat)      # slightly inside: visible
    _, el_out, _ = look(0, np.degrees(lam) * 1.01, sat)     # slightly outside: not
    assert el_in[0] > mask_deg > el_out[0]
