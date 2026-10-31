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
    api.set_terrain("null")


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
    assert json.loads(api.set_constellation("[]", "[]")) == {"paths": [], "ring_of": [], "normals": []}


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
    assert math.isclose(el[0, c.A], c.geostationary_radius()) and el[0, c.INC] == 0
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


# ---- the common repeat period and the time window ------------------------------------------------------

def period_of(*keys):
    el = np.vstack([presets.PRESETS[k]["build"]() for k in keys])
    return json.loads(api.common_period(json.dumps(el.tolist())))


def test_common_period_of_gps_alone_is_its_orbital_period():
    r = period_of("gps")
    assert r["found"] and math.isclose(r["seconds"], float(c.period(c.A_GPS))) and r["mismatch_deg"] < 1e-6


def test_common_period_of_all_four_systems_is_70_sidereal_days():
    r = period_of("gps", "galileo", "beidou_meo", "beidou_igso_geo")
    assert r["found"]
    assert abs(r["seconds"] / g.T_SIDEREAL - 70.0) < 1e-6 and abs(r["days"] - 69.81) < 0.01
    assert r["mismatch_deg"] < 7.0                              # the three orbits that do not match exactly


def test_common_period_with_no_satellites_or_no_repeat():
    assert json.loads(api.common_period("[]"))["found"] is False
    # eight unrelated orbit sizes: the chance that all eight line up within 0.03 orbits is negligible
    odd = np.vstack([c.make_elements(a, 0.0, 55.0, 0.0, 0.0, 0.0) for a in (8123.4, 11234.5, 14567.8, 18901.2, 23456.7, 28901.2, 34567.8, 39876.5)])
    r = json.loads(api.common_period(json.dumps(odd.tolist())))
    assert r["found"] is False and "10 years" in r["reason"]


def test_monte_carlo_points_carry_their_time_inside_the_window():
    window = 3 * 86400.0
    mc.mc_start(2000, 3, 6.0, 0.0, json.dumps(presets.gps().tolist()), window)
    pts = json.loads(mc.mc_advance(500, True))["points"]
    assert len(pts["t"]) == 500 and 0 <= min(pts["t"]) and max(pts["t"]) < window
    assert json.loads(mc.mc_summary())["window_days"] == 3.0


def test_window_spread_does_not_change_the_answer_for_a_mixed_constellation():
    """PDOP statistics for windows of 7, 30, 120 and 365 days (and the common repeat period) agree
    within sampling error: the window only has to be long enough to mix the satellites' phases."""
    el = np.vstack([presets.gps(), presets.galileo(), presets.beidou_meo(), presets.beidou_igso_geo()])
    lcm = json.loads(api.common_period(json.dumps(el.tolist())))["seconds"]
    medians, means = [], []
    for window in (7 * 86400.0, 30 * 86400.0, 120 * 86400.0, 365 * 86400.0, lcm):
        run = mc.MonteCarlo(60_000, seed=11, elements=el, window_s=window)
        run.advance(60_000)
        pdop = run.dop["pdop"]
        medians.append(float(np.nanmedian(pdop)))
        means.append(float(run.n_visible.mean()))
    print("median PDOP by window:", [round(x, 3) for x in medians])
    assert max(medians) - min(medians) < 0.02
    assert max(means) - min(means) < 0.15


# ---- Stage 4: terrain (a cone-shaped valley around the receiver) -----------------------------------------

def cone(angle):
    return api.set_terrain(json.dumps({"type": "cone", "angle_deg": angle}))


@pytest.mark.parametrize("angle", [10.0, 25.0, 40.0])
def test_cone_is_the_same_as_an_elevation_mask(angle):
    """A cone blocks the same angle in every direction, so it must give exactly what a mask gives."""
    load("gps", "galileo")
    for lat, lon, t in [(40.44, -79.94, 1000.0), (-33.9, 151.2, 5e5), (70.0, 20.0, 2e6)]:
        api.set_terrain("null")
        masked = snap(lat, lon, t, mask=angle)
        cone(angle)
        coned = snap(lat, lon, t)
        assert coned["visible"] == masked["visible"] and coned["dop"] == masked["dop"]
        assert coned["mask_deg"] == angle


def test_blocked_means_above_the_horizon_but_below_the_walls():
    load("gps", "galileo")
    cone(30.0)
    s = snap()
    for el, on, vis, blk in zip(s["el"], s["enabled"], s["visible"], s["blocked"]):
        assert blk == (on and 0.0 <= el < 30.0)
        assert vis == (on and el >= 30.0)
    assert any(s["blocked"])                                   # some satellites really are hidden


def test_switched_off_satellites_are_never_blocked():
    el = load("gps")
    load("gps", enabled=[False] * 24)
    cone(30.0)
    s = snap()
    assert not any(s["blocked"]) and s["n_visible"] == 0


def test_terrain_validation():
    with pytest.raises(ValueError):
        cone(85.0)
    with pytest.raises(ValueError):
        cone(-1.0)
    with pytest.raises(ValueError):
        api.set_terrain(json.dumps({"type": "canyon", "angle_deg": 10}))
    assert json.loads(api.set_terrain("null")) is None


def test_monte_carlo_in_a_20_degree_valley_matches_the_analytic_mean():
    """The cap formula with mask e (README A13) gives the expected number in view in a cone of e."""
    n = 150_000
    run = mc.MonteCarlo(n, seed=21, mask_deg=20.0)
    run.advance(n)
    se = run.n_visible.std(ddof=1) / math.sqrt(n)
    expected = mc.expected_mean_visible(presets.gps(), 20.0)
    assert abs(run.n_visible.mean() - expected) < 4 * se, (run.n_visible.mean(), expected)


def test_deeper_valleys_see_fewer_satellites_and_position_worse():
    """GPS alone: as the walls get steeper, the mean number in view and the availability can only fall,
    and the median PDOP rises."""
    means, avail, med = [], [], []
    for angle in (0.0, 10.0, 20.0, 30.0, 40.0):
        run = mc.MonteCarlo(30_000, seed=4, mask_deg=angle)    # same seed: the same places and times each time
        run.advance(30_000)
        s = run.summary("pdop")
        means.append(s["nsat"]["mean"]); avail.append(s["availability"]["p"]); med.append(s["dop"]["median"])
    print("valley angle 0-40: mean in view", [round(x, 2) for x in means], "availability", [round(x, 3) for x in avail],
          "median PDOP", [round(x, 2) for x in med])
    assert all(a > b for a, b in zip(means, means[1:]))
    assert all(a >= b for a, b in zip(avail, avail[1:])) and avail[-1] < avail[0]
    assert all(a < b for a, b in zip(med, med[1:]))


# ---- orbit preview for the Add dialog ---------------------------------------------------------------------

def test_preview_does_not_change_the_constellation_and_matches_the_orbits():
    load("gps")
    before = snap()
    w = json.loads(api.walker_from_form(json.dumps(dict(T=12, P=3, F=1, alt=1200.0, inc=87.0))))
    pv = json.loads(api.preview(json.dumps(w["elements"]), 4321.0))
    assert len(pv["paths"]) == 3 and len(pv["positions"]) == 12 and len(pv["normals"]) == 12
    el = np.array(w["elements"])
    assert np.allclose(pv["positions"], c.positions(el, 4321.0))
    for i, r in enumerate(pv["ring_of"]):                      # every satellite is on its ring (circular: same radius)
        assert math.isclose(np.linalg.norm(pv["positions"][i]), np.linalg.norm(pv["paths"][r][0]), rel_tol=1e-9)
    assert snap() == before                                     # nothing was added
