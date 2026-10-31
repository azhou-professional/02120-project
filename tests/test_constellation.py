"""Checks that the Walker 24/6/1 constellation and Kepler motion are right."""

import numpy as np

from sim import constellation as c

ELEMENTS = c.walker(24, 6, 1)


def test_table_shape():
    assert ELEMENTS.shape == (24, 6)
    assert np.all(ELEMENTS[:, c.ECC] == 0) and np.all(ELEMENTS[:, c.ARGP] == 0)     # circular


def test_planes_are_60_deg_apart_with_4_sats_each():
    raans = np.unique(ELEMENTS[:, c.RAAN])
    assert np.allclose(raans, [0, 60, 120, 180, 240, 300])
    for raan in raans:
        assert np.sum(ELEMENTS[:, c.RAAN] == raan) == 4


def test_in_plane_spacing_is_90_and_plane_phase_offset_is_15():
    for p in range(6):
        m0 = ELEMENTS[4 * p:4 * p + 4, c.M0]
        assert np.allclose(np.diff(m0) % 360, 90)          # 90 deg inside a plane
        assert np.isclose(m0[0], (15 * p) % 360)           # F*360/T = 15 deg per plane


def test_radius_is_constant_in_time():
    for t in (0.0, 1234.5, 20000.0, 86400.0):
        r = np.linalg.norm(c.positions(ELEMENTS, t), axis=1)
        assert np.allclose(r, c.A_GPS, rtol=1e-12)


def test_period_is_about_11h58m_and_orbit_closes():
    T = c.period(c.A_GPS)
    assert abs(T / 3600 - 11.967) < 0.01                   # ~11 h 58 min
    assert np.allclose(c.positions(ELEMENTS, T), c.positions(ELEMENTS, 0.0), atol=1e-6)


def test_orbital_speed_matches_sqrt_mu_over_a():
    dt = 1.0
    v = (c.positions(ELEMENTS, dt) - c.positions(ELEMENTS, -dt)) / (2 * dt)
    assert np.allclose(np.linalg.norm(v, axis=1), np.sqrt(c.MU / c.A_GPS), rtol=1e-4)


def test_orbit_plane_has_55_deg_inclination_and_correct_raan():
    t, dt = 5000.0, 1.0
    r = c.positions(ELEMENTS, t)
    v = c.positions(ELEMENTS, t + dt) - c.positions(ELEMENTS, t - dt)
    h = np.cross(r, v)                                     # normal to the orbit plane
    h /= np.linalg.norm(h, axis=1, keepdims=True)
    inc = np.degrees(np.arccos(h[:, 2]))
    assert np.allclose(inc, 55.0, atol=1e-3)
    # h = (sin(raan) sin(i), -cos(raan) sin(i), cos(i))
    raan = np.degrees(np.arctan2(h[:, 0], -h[:, 1])) % 360
    assert np.allclose((raan - ELEMENTS[:, c.RAAN] + 180) % 360 - 180, 0, atol=1e-3)


def test_argument_of_latitude_matches_the_actual_position():
    """u is the angle from the ascending node along the orbit, so the position must be
    r = a*(cos(u) * node_direction + sin(u) * perpendicular_in_plane); recover u from the
    position (independent of the formula used for u) and compare."""
    for t in (0.0, 3000.0, 25000.0):
        r = c.positions(ELEMENTS, t)
        raan, inc = np.radians(ELEMENTS[:, c.RAAN]), np.radians(ELEMENTS[:, c.INC])
        node = np.stack([np.cos(raan), np.sin(raan), np.zeros(24)], axis=1)
        cos_u = np.sum(r * node, axis=1) / c.A_GPS
        sin_u = r[:, 2] / (c.A_GPS * np.sin(inc))                  # z = a sin(i) sin(u)
        u_from_position = np.degrees(np.arctan2(sin_u, cos_u)) % 360
        diff = (c.argument_of_latitude(ELEMENTS, t) - u_from_position + 180) % 360 - 180
        assert np.allclose(diff, 0, atol=1e-6)


def test_argument_of_latitude_at_start_and_after_one_period():
    assert np.allclose(c.argument_of_latitude(ELEMENTS, 0.0), ELEMENTS[:, c.M0])
    after = c.argument_of_latitude(ELEMENTS, c.period(c.A_GPS))
    assert np.allclose((after - ELEMENTS[:, c.M0] + 180) % 360 - 180, 0, atol=1e-6)


def test_speed_and_mean_motion_consistent():
    assert np.isclose(c.circular_speed(c.A_GPS), c.A_GPS * c.mean_motion(c.A_GPS))     # v = a * n
    assert abs(c.circular_speed(c.A_GPS) - 3.87) < 0.01                                 # GPS: ~3.87 km/s
    assert np.allclose(c.speed(ELEMENTS, 1234.0), c.circular_speed(c.A_GPS))            # vis-viva, e = 0


def test_names():
    n = c.names(24, 6)
    assert n[0] == "A1" and n[3] == "A4" and n[4] == "B1" and n[-1] == "F4"
    assert len(set(n)) == 24
