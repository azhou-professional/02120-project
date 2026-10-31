"""The page-facing API: the constellation held in Python, switched-off satellites, and the
forms that build satellites."""

import json
import math

import numpy as np
import pytest

from sim import api
from sim import constellation as c
from sim import geometry as g
from sim import montecarlo as mc
from sim import presets
from sim.dop import dop


def load(*keys, enabled=None):
    """Put the given presets into the constellation; returns the elements table."""
    el = np.vstack([presets.PRESETS[k]["build"]() for k in keys])
    on = np.ones(len(el), dtype=bool) if enabled is None else np.asarray(enabled, dtype=bool)
    api.set_constellation(json.dumps(el.tolist()), json.dumps(on.tolist()))
    return el


def snap(lat=40.44, lon=-79.94, t=1000.0, mask=0.0):
    return json.loads(api.snapshot(lat, lon, t, mask))


@pytest.fixture(autouse=True)
def back_to_gps():
    yield
    load("gps")


# ---- switching satellites off ---------------------------------------------------------------

def test_switched_off_satellites_do_not_count():
    el = load("gps")
    full = snap()
    on = np.ones(24, dtype=bool)
    visible_idx = [i for i, v in enumerate(full["visible"]) if v]
    on[visible_idx[:3]] = False                                   # fail three satellites that are in view
    load("gps", enabled=on)
    s = snap()
    assert s["n_visible"] == full["n_visible"] - 3
    assert s["enabled"].count(False) == 3
    assert len(s["sat_positions"]) == 24                          # ghosts still have positions to draw
    assert not any(s["visible"][i] for i in visible_idx[:3])


def test_dop_uses_only_switched_on_satellites():
    """Keep exactly five satellites on and compare with a DOP worked out directly from them."""
    load("gps")
    full = snap()
    keep = [i for i, v in enumerate(full["visible"]) if v][:5]
    on = np.zeros(24, dtype=bool)
    on[keep] = True
    load("gps", enabled=on)
    s = snap()
    assert s["n_visible"] == 5
    el = presets.gps()
    t, lat, lon = 1000.0, 40.44, -79.94
    rx, enu = g.receiver_position(lat, lon, t), g.enu_basis(lat, lon, t)
    _, _, unit = g.look_angles(rx, c.positions(el, t), enu)
    expected = dop(unit[keep], enu)
    for k in expected:
        assert math.isclose(s["dop"][k], expected[k], rel_tol=1e-9)


def test_no_satellites_at_all():
    api.set_constellation("[]", "[]")
    s = snap()
    assert s["n_visible"] == 0 and s["dop"]["gdop"] is None and s["sat_positions"] == []
    assert json.loads(api.set_constellation("[]", "[]")) == {"paths": [], "ring_of": []}


def test_set_constellation_rejects_bad_input():
    with pytest.raises(ValueError):
        api.set_constellation(json.dumps(presets.gps().tolist()), "[true]")           # wrong length
    with pytest.raises(ValueError):
        api.set_constellation(json.dumps(np.zeros((api.MAX_SATELLITES + 1, 6)).tolist()), json.dumps([True] * (api.MAX_SATELLITES + 1)))


# ---- several constellations at once -------------------------------------------------------------

def test_all_four_presets_together():
    load("gps", "galileo", "beidou_meo", "beidou_igso_geo")
    s = snap()
    assert len(s["sat_positions"]) == 24 + 24 + 24 + 6
    assert s["n_visible"] > 15                                    # many more than GPS alone (about 9)
    json.loads(api.snapshot(0.0, 0.0, 5000.0))                    # valid JSON everywhere


def test_adding_a_constellation_never_makes_dop_worse():
    """With one common clock, extra satellites only add rows to the geometry matrix, so GDOP can
    only stay the same or fall. Checked on the real geometry at many places and times."""
    rng = np.random.default_rng(3)
    for _ in range(40):
        lat, lon, t = rng.uniform(-80, 80), rng.uniform(-180, 180), rng.uniform(0, 5e6)
        load("gps")
        gps_only = snap(lat, lon, t)["dop"]["gdop"]
        load("gps", "galileo", "beidou_meo", "beidou_igso_geo")
        everything = snap(lat, lon, t)["dop"]["gdop"]
        assert everything <= gps_only + 1e-9, (lat, lon, t)


def test_orbit_paths_share_one_ring_per_orbit():
    el = load("gps", "galileo", "beidou_meo", "beidou_igso_geo")
    info = json.loads(api.set_constellation(json.dumps(el.tolist()), json.dumps([True] * len(el))))
    # 6 GPS planes + 3 Galileo + 3 BeiDou MEO + 3 IGSO + 1 (the three GEO satellites share the equator)
    assert len(info["paths"]) == 16
    ring_of = info["ring_of"]
    assert ring_of[:4] == [0, 0, 0, 0] and ring_of[4] == 1                    # GPS: four per plane
    assert len(set(ring_of[-3:])) == 1                                          # the three GEO share a ring
    for i, r in enumerate(ring_of):                                              # every satellite lies on its ring
        point = c.positions(el[i:i + 1], 4321.0)[0]
        ring = np.array(info["paths"][r])
        radii = np.linalg.norm(ring, axis=1)
        assert abs(np.linalg.norm(point) - radii.min()) < 1e-6 or el[i, c.ECC] > 0 or abs(np.linalg.norm(point) - radii[0]) < 1e-6


def test_preset_info_and_elements():
    info = json.loads(api.preset_info())
    assert [p["key"] for p in info] == ["gps", "galileo", "beidou_meo", "beidou_igso_geo"]
    assert [p["count"] for p in info] == [24, 24, 24, 6]
    for p in info:
        data = json.loads(api.preset_elements(p["key"]))
        assert len(data["elements"]) == p["count"] == len(data["names"])


# ---- the 'add a satellite' form ---------------------------------------------------------------------

def form(**kw):
    base = dict(geo=False, alt=20181.6, inc=55.0, raan=0.0, phase=0.0, elliptical=False, apogee=None, argp=0.0, lon=0.0)
    base.update(kw)
    return json.loads(api.orbit_from_form(json.dumps(base)))


def test_circular_form():
    r = form(alt=20181.563, inc=55.0, raan=60.0, phase=15.0)
    assert r["ok"]
    a, e, inc, raan, argp, m0 = r["elements"]
    assert math.isclose(a, g.R_EARTH + 20181.563) and e == 0 and (inc, raan, argp, m0) == (55.0, 60.0, 0.0, 15.0)
    assert abs(r["info"]["period_s"] / 3600 - 11.966) < 0.01


def test_elliptical_form_has_the_requested_perigee_and_apogee():
    r = form(alt=500.0, apogee=35000.0, elliptical=True, argp=270.0, inc=63.4)
    assert r["ok"]
    el = np.array([r["elements"]])
    assert math.isclose(c.perigee_radius(el)[0] - g.R_EARTH, 500.0, rel_tol=1e-9)
    assert math.isclose(c.apogee_radius(el)[0] - g.R_EARTH, 35000.0, rel_tol=1e-9)
    # and the orbit really swings between those distances
    radii = np.linalg.norm(c.positions(el, np.linspace(0, c.period(el[0, 0]), 4000))[:, 0, :], axis=1)
    assert math.isclose(radii.min(), g.R_EARTH + 500.0, rel_tol=1e-4)
    assert math.isclose(radii.max(), g.R_EARTH + 35000.0, rel_tol=1e-4)


def test_geostationary_form_ignores_the_other_fields():
    r = form(geo=True, lon=-75.0, alt="junk", inc=None)
    assert r["ok"]
    el = np.array([r["elements"]])
    assert math.isclose(el[0, c.A], c.geostationary_radius()) and el[0, c.INC] == 0 and el[0, c.M0] == -75.0
    lat, lon = g.lat_lon(c.positions(el, 12345.0), 12345.0)
    assert math.isclose(lat[0], 0.0, abs_tol=1e-9) and math.isclose(lon[0], -75.0, abs_tol=1e-9)


@pytest.mark.parametrize("kw,fragment", [
    (dict(alt=100.0), "perigee altitude"),
    (dict(inc=200.0), "inclination"),
    (dict(alt=None), "altitude must be a number"),
    (dict(raan=float("nan")), "RAAN must be a number"),
    (dict(elliptical=True, alt=1000.0, apogee=500.0), "apogee altitude must be at least"),
    (dict(elliptical=True, alt=500.0, apogee=None), "apogee altitude must be a number"),
    (dict(elliptical=True, alt=200000.0, apogee=600000.0), "apogee radius"),      # e = 0.49: legal, but too far out
    (dict(elliptical=True, alt=500.0, apogee=600000.0), "eccentricity"),          # e = 0.97: too eccentric
    (dict(geo=True, lon=None), "longitude must be a number"),
])
def test_form_errors_are_readable(kw, fragment):
    r = form(**kw)
    assert not r["ok"] and fragment in r["error"]


# ---- the Walker generator ------------------------------------------------------------------------------

def walker(**kw):
    base = dict(T=24, P=6, F=1, alt=20181.6, inc=55.0)
    base.update(kw)
    return json.loads(api.walker_from_form(json.dumps(base)))


def test_walker_form_matches_the_walker_function():
    r = walker(T=24, P=3, F=2, alt=23221.7, inc=56.0)
    assert r["ok"] and len(r["elements"]) == 24 and len(r["names"]) == 24
    assert np.allclose(r["elements"], c.walker(24, 3, 2, g.R_EARTH + 23221.7, 56.0))


@pytest.mark.parametrize("kw,fragment", [
    (dict(T=25, P=6), "multiple of P"),
    (dict(T=4, P=6), "multiple of P"),
    (dict(P=0), "between 1 and 26"),
    (dict(F=6), "between 0 and P - 1"),
    (dict(T=240, P=6), "at most"),
    (dict(T=24.5), "whole numbers"),
    (dict(alt=50.0), "perigee altitude"),
    (dict(inc=None), "inclination must be a number"),
])
def test_walker_form_errors(kw, fragment):
    r = walker(**kw)
    assert not r["ok"] and fragment in r["error"]


# ---- Monte Carlo on the live constellation -------------------------------------------------------------

def test_monte_carlo_on_a_mixed_constellation_matches_the_analytic_mean():
    el = np.vstack([presets.gps(), presets.galileo(), presets.beidou_meo(), presets.beidou_igso_geo()])
    n = 100_000
    run = mc.MonteCarlo(n, seed=5, elements=el)                       # default 365 day window
    run.advance(n)
    se = run.n_visible.std(ddof=1) / math.sqrt(n)
    expected = mc.expected_mean_visible(el, 0.0)
    assert abs(run.n_visible.mean() - expected) < 4 * se, (run.n_visible.mean(), expected, se)
    assert expected > 30                                               # 78 satellites, about 0.38 each


def test_monte_carlo_rejects_an_empty_constellation():
    with pytest.raises(ValueError):
        mc.MonteCarlo(10, elements=np.empty((0, 6)))
