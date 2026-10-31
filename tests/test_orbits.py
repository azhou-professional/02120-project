"""Elliptical orbits (Kepler's equation), the constellation presets, and the common repeat period."""

import math

import numpy as np
import pytest

from sim import constellation as c
from sim import geometry as g
from sim import montecarlo as mc
from sim import presets

# a generic ellipse: a = 20,000 km, e = 0.4, i = 30 deg, RAAN 40, argument of perigee 75, M0 20
ORBIT = c.make_elements(20000.0, 0.4, 30.0, 40.0, 75.0, 20.0)


def finite_difference_velocity(elements, t, dt=0.5):
    return (c.positions(elements, t + dt) - c.positions(elements, t - dt)) / (2 * dt)


# ---- Kepler's equation ---------------------------------------------------------------------

@pytest.mark.parametrize("e", [0.0, 0.1, 0.5, 0.74, 0.9])
def test_kepler_equation_is_solved(e):
    M = np.linspace(-10.0, 10.0, 2001)
    E = c.solve_kepler(M, e)
    wrapped = (M + np.pi) % (2 * np.pi) - np.pi
    assert np.max(np.abs(E - e * np.sin(E) - wrapped)) < 1e-12


def test_circle_has_eccentric_anomaly_equal_to_mean_anomaly():
    M = np.array([-3.0, -1.0, 0.0, 0.5, 2.0, 3.0])
    assert np.allclose(c.solve_kepler(M, 0.0), M)


# ---- ellipse properties --------------------------------------------------------------------

def test_circular_case_equals_the_closed_form_circle():
    """With e = 0 the general code must reproduce the circular formula
    x = a (cos O cos u - sin O cos i sin u), ... with u = M0 + n t (Stage 1 / Stage 2 result)."""
    rng = np.random.default_rng(0)
    for _ in range(20):
        a, inc, raan, m0 = rng.uniform(7000, 45000), rng.uniform(0, 120), rng.uniform(0, 360), rng.uniform(0, 360)
        t = rng.uniform(0, 200000)
        el = c.make_elements(a, 0.0, inc, raan, 0.0, m0)
        u = math.radians(m0) + math.sqrt(c.MU / a**3) * t
        i, o = math.radians(inc), math.radians(raan)
        expected = a * np.array([math.cos(o) * math.cos(u) - math.sin(o) * math.cos(i) * math.sin(u),
                                 math.sin(o) * math.cos(u) + math.cos(o) * math.cos(i) * math.sin(u),
                                 math.sin(i) * math.sin(u)])
        assert np.allclose(c.positions(el, t)[0], expected, rtol=0, atol=1e-6)


def test_argument_of_perigee_and_phase_add_up_on_a_circle():
    t = 12345.0
    a = c.positions(c.make_elements(10000.0, 0.0, 40.0, 100.0, 70.0, 30.0), t)
    b = c.positions(c.make_elements(10000.0, 0.0, 40.0, 100.0, 0.0, 100.0), t)
    assert np.allclose(a, b, atol=1e-6)


def test_radius_swings_between_perigee_and_apogee():
    T = c.period(20000.0)
    t = np.linspace(0, T, 20001)
    r = np.linalg.norm(c.positions(ORBIT, t)[:, 0, :], axis=1)
    assert np.isclose(r.min(), 20000 * (1 - 0.4), rtol=1e-6)
    assert np.isclose(r.max(), 20000 * (1 + 0.4), rtol=1e-6)
    assert np.allclose(r, c.radius(ORBIT, t)[:, 0])


def test_orbit_closes_after_one_period():
    T = c.period(20000.0)
    assert np.allclose(c.positions(ORBIT, T), c.positions(ORBIT, 0.0), atol=1e-6)


def test_perigee_and_apogee_points():
    """Mean anomaly 0 is perigee: distance a(1-e), true anomaly 0, argument of latitude = argp, and
    the position points along the in-plane direction P = (cos O cos w - sin O cos i sin w, ...)."""
    a, e, inc, raan, argp = 20000.0, 0.4, 30.0, 40.0, 75.0
    o, i, w = map(math.radians, (raan, inc, argp))
    P = np.array([math.cos(o) * math.cos(w) - math.sin(o) * math.cos(i) * math.sin(w),
                  math.sin(o) * math.cos(w) + math.cos(o) * math.cos(i) * math.sin(w),
                  math.sin(i) * math.sin(w)])
    peri = c.make_elements(a, e, inc, raan, argp, 0.0)
    assert np.allclose(c.positions(peri, 0.0)[0], a * (1 - e) * P, atol=1e-6)
    assert np.isclose(c.true_anomaly_deg(peri, 0.0)[0] % 360, 0.0, atol=1e-6) or \
        np.isclose(c.true_anomaly_deg(peri, 0.0)[0], 360.0, atol=1e-6)
    assert np.isclose(c.argument_of_latitude(peri, 0.0)[0], argp)
    apo = c.make_elements(a, e, inc, raan, argp, 180.0)
    assert np.allclose(c.positions(apo, 0.0)[0], -a * (1 + e) * P, atol=1e-6)
    assert np.isclose(c.true_anomaly_deg(apo, 0.0)[0], 180.0, atol=1e-6)


def test_every_point_satisfies_the_two_focus_property():
    """An ellipse is the set of points whose distances to the two foci add up to 2a. One focus is
    Earth's centre; the other is at -2 a e P (opposite perigee)."""
    a, e = 20000.0, 0.4
    o, i, w = map(math.radians, (40.0, 30.0, 75.0))
    P = np.array([math.cos(o) * math.cos(w) - math.sin(o) * math.cos(i) * math.sin(w),
                  math.sin(o) * math.cos(w) + math.cos(o) * math.cos(i) * math.sin(w),
                  math.sin(i) * math.sin(w)])
    f2 = -2 * a * e * P
    for pts in (c.orbit_path(ORBIT[0], 400), c.positions(ORBIT, np.linspace(0, 9000, 300))[:, 0, :]):
        total = np.linalg.norm(pts, axis=1) + np.linalg.norm(pts - f2, axis=1)
        assert np.allclose(total, 2 * a, rtol=0, atol=1e-6)


def test_energy_and_angular_momentum_are_conserved():
    """Two-body motion conserves specific energy v^2/2 - mu/r = -mu/(2a) and angular momentum
    h = r x v (constant magnitude and direction: equal areas in equal times, a fixed plane).
    The velocity comes from finite differences of the positions, not from the code's own speed."""
    hs = []
    for t in np.linspace(0, c.period(20000.0), 9, endpoint=False):
        r, v = c.positions(ORBIT, t)[0], finite_difference_velocity(ORBIT, t)[0]
        energy = 0.5 * v @ v - c.MU / np.linalg.norm(r)
        assert np.isclose(energy, -c.MU / (2 * 20000.0), rtol=1e-6)
        hs.append(np.cross(r, v))
    assert np.allclose(hs, hs[0], rtol=1e-6)


def test_speed_matches_finite_differences():
    for t in (0.0, 2000.0, 5000.0, 8000.0):
        v = np.linalg.norm(finite_difference_velocity(ORBIT, t)[0])
        assert np.isclose(c.speed(ORBIT, t)[0], v, rtol=1e-6)


def test_orbit_plane_orientation_of_an_ellipse():
    t = 3333.0
    h = np.cross(c.positions(ORBIT, t)[0], finite_difference_velocity(ORBIT, t)[0])
    h /= np.linalg.norm(h)
    assert np.isclose(np.degrees(np.arccos(h[2])), 30.0, atol=1e-3)
    assert np.isclose(np.degrees(np.arctan2(h[0], -h[1])) % 360, 40.0, atol=1e-3)


# ---- validation ------------------------------------------------------------------------------

@pytest.mark.parametrize("a,e,inc", [(c.A_GPS, 0.0, 55.0),            # GPS
                                     (26561.8, 0.74, 63.4),            # Molniya-type
                                     (7000.0, 0.0, 50.0),              # low Earth orbit, 622 km up
                                     (42164.17, 0.0, 0.0)])            # geostationary
def test_validate_orbit_accepts_real_orbits(a, e, inc):
    c.validate_orbit(a, e, inc)                                        # must not raise


@pytest.mark.parametrize("a,e,inc", [(6500.0, 0.0, 50.0),        # 122 km up: too low
                                     (20000.0, 0.7, 50.0),       # perigee 6000 km radius: inside Earth
                                     (20000.0, 0.95, 50.0),      # eccentricity too high
                                     (20000.0, 0.1, 190.0),      # inclination out of range
                                     (20000.0, -0.1, 50.0)])
def test_validate_orbit_rejects_bad_orbits(a, e, inc):
    with pytest.raises(ValueError):
        c.validate_orbit(a, e, inc)


# ---- presets -----------------------------------------------------------------------------------

@pytest.mark.parametrize("build,planes,per_plane,a,inc", [
    (presets.gps, 6, 4, 26559.7, 55.0),
    (presets.galileo, 3, 8, 29599.8, 56.0),
    (presets.beidou_meo, 3, 8, 27906.1, 55.0),
])
def test_walker_presets(build, planes, per_plane, a, inc):
    el = build()
    assert el.shape == (planes * per_plane, 6)
    assert np.allclose(el[:, c.A], a) and np.allclose(el[:, c.INC], inc) and np.all(el[:, c.ECC] == 0)
    assert np.allclose(np.unique(el[:, c.RAAN]), 360.0 * np.arange(planes) / planes)
    for p in range(planes):
        m0 = el[p * per_plane:(p + 1) * per_plane, c.M0]
        assert np.allclose(np.diff(m0) % 360, 360.0 / per_plane)                  # even spacing in a plane
        assert np.isclose(m0[0], (360.0 / 24 * p) % 360)                          # F = 1: 15 deg between planes


def test_presets_names_match_satellite_counts():
    for key, p in presets.PRESETS.items():
        assert len(p["names"]()) == len(p["build"]()), key
        assert len(set(p["names"]())) == len(p["names"]())


def revolutions_per_sidereal_day(a):
    return g.T_SIDEREAL / c.period(a)


def test_orbit_periods_match_the_published_repeat_cycles():
    """GPS: 2 revolutions per sidereal day. Galileo: 17 revolutions in 10 sidereal days (ESA
    Navipedia). BeiDou MEO: 13 revolutions in 7 sidereal days (12 h 53 min). IGSO/GEO: exactly 1."""
    assert abs(revolutions_per_sidereal_day(c.A_GPS) - 2.0) < 1e-3
    assert abs(revolutions_per_sidereal_day(presets.GALILEO_A) - 17 / 10) < 1e-3
    assert abs(revolutions_per_sidereal_day(presets.BDS_MEO_A) - 13 / 7) < 1e-3
    assert np.isclose(revolutions_per_sidereal_day(c.geostationary_radius()), 1.0)
    assert abs(c.period(presets.BDS_MEO_A) / 3600 - (12 + 53 / 60)) < 0.01


def test_beidou_igso_and_geo():
    el = presets.beidou_igso_geo()
    assert el.shape == (6, 6)
    igso, geo = el[:3], el[3:]
    assert np.allclose(igso[:, c.INC], 55.0) and np.allclose(geo[:, c.INC], 0.0)
    assert np.allclose(el[:, c.A], c.geostationary_radius())
    # the GEO satellites hang over 80, 110.5 and 140 deg E at all times, on the equator
    for t in (0.0, 30000.0, 3 * g.T_SIDEREAL + 777.0):
        lat, lon = g.lat_lon(c.positions(geo, t), t)
        assert np.allclose(lat, 0.0, atol=1e-9) and np.allclose(lon, [80.0, 110.5, 140.0], atol=1e-9)


def test_igso_satellites_share_one_ground_track_crossing_at_118_east():
    igso = presets.beidou_igso_geo()[:3]
    lat0, lon0 = g.lat_lon(c.positions(igso[:1], 0.0), 0.0)
    assert np.isclose(lat0[0], 0.0, atol=1e-9) and np.isclose(lon0[0], 118.0, atol=1e-9)
    # satellite k is on the track of satellite 0, k thirds of a sidereal day later
    for k in (1, 2):
        for t in np.linspace(0.0, 2 * g.T_SIDEREAL, 17):
            tau = k * g.T_SIDEREAL / 3
            la_k, lo_k = g.lat_lon(c.positions(igso[k:k + 1], t), t)
            la_0, lo_0 = g.lat_lon(c.positions(igso[:1], t - tau), t - tau)
            assert np.isclose(la_k[0], la_0[0], atol=1e-7) and np.isclose((lo_k[0] - lo_0[0] + 180) % 360 - 180, 0, atol=1e-7)
    lats = np.array([g.lat_lon(c.positions(igso, t), t)[0] for t in np.linspace(0, g.T_SIDEREAL, 500)])
    assert 54.9 < np.abs(lats).max() <= 55.0 + 1e-9                    # the figure-eight reaches 55 deg


# ---- the common repeat period (approximate LCM) -------------------------------------------------

def test_common_period_exact_multiples():
    T, mismatch = c.approx_common_period([10.0, 15.0], max_days=1)
    assert np.isclose(T, 30.0) and mismatch < 1e-12


def test_common_period_of_one_period_or_equal_periods():
    for periods in ([43078.0], [43078.0] * 24, [43078.0, 43078.0 * (1 + 1e-8)]):
        T, mismatch = c.approx_common_period(periods)
        assert np.isclose(T, 43078.0) and mismatch < 1e-6


def test_common_period_none_when_there_is_no_repeat_in_range():
    # periods 1000 s and 1000*sqrt(2) s never line up closely within two days
    assert c.approx_common_period([1000.0, 1000.0 * math.sqrt(2)], tol=1e-4, max_days=2) is None
    assert c.approx_common_period([], max_days=2) is None


def test_common_period_of_the_four_nominal_systems_is_70_sidereal_days():
    """GPS 2/1, Galileo 17/10, BeiDou MEO 13/7 and GEO/IGSO 1/1 revolutions per sidereal day all
    close after 10*7 = 70 sidereal days = 69.81 days."""
    periods = [c.period(x) for x in (c.A_GPS, presets.GALILEO_A, presets.BDS_MEO_A, c.geostationary_radius())]
    T, mismatch = c.approx_common_period(periods)
    assert abs(T / g.T_SIDEREAL - 70.0) < 1e-6
    assert mismatch < 0.02                                    # under 7 degrees of orbital phase


def test_common_period_of_pairs_is_shorter():
    """The answer is a whole number of the *longest* period, so it matches 10 (or 7) sidereal days
    only as closely as that period matches 10/17 (or 7/13) of a sidereal day: within 0.002 days."""
    gps, gal, bds = c.period(c.A_GPS), c.period(presets.GALILEO_A), c.period(presets.BDS_MEO_A)
    assert abs(c.approx_common_period([gps, gal])[0] / g.T_SIDEREAL - 10.0) < 2e-3
    assert abs(c.approx_common_period([gps, bds])[0] / g.T_SIDEREAL - 7.0) < 2e-3


# ---- what the page draws ---------------------------------------------------------------------------

def test_orbit_rings_for_the_page():
    import json
    from sim import api
    rings = json.loads(api.orbit_rings(60))
    assert len(rings) == 6 and all(len(r) == 60 for r in rings)          # GPS: one ring per plane
    assert np.allclose(np.linalg.norm(np.array(rings), axis=2), c.A_GPS)   # circles of GPS radius


# ---- coverage of an elliptical orbit (Monte Carlo against the numerical orbit average) ------------

def test_expected_mean_visible_reduces_to_closed_form_for_a_circle():
    one = c.make_elements(c.A_GPS, 0.0, 55.0, 0.0, 0.0, 0.0)
    assert np.isclose(mc.expected_mean_visible(one, 5.0), mc.single_sat_probability(c.A_GPS, 5.0))


def test_ellipse_monte_carlo_matches_orbit_averaged_probability():
    n, mask = 200_000, 5.0
    run = mc.MonteCarlo(n, seed=9, mask_deg=mask, elements=ORBIT)       # times cover whole periods of this orbit
    run.advance(n)
    p = mc.expected_mean_visible(ORBIT, mask)
    frac = float(np.mean(run.n_visible == 1))
    assert abs(frac - p) < 4 * math.sqrt(p * (1 - p) / n), (frac, p)
