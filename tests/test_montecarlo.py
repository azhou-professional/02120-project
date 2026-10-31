"""Checks the Monte-Carlo machinery: batch maths, sampling, analytic coverage, seeds, statistics."""

import math

import numpy as np
import pytest

from sim import constellation as c
from sim import geometry as g
from sim import montecarlo as mc
from sim.dop import KEYS, dop, dop_batch

ELEMENTS = c.walker(24, 6, 1)


# ---- batch maths equals the (independent) scalar maths --------------------------------

@pytest.mark.parametrize("mask_deg", [0.0, 55.0])   # 55 deg gives many trials with < 4 satellites
def test_batch_matches_scalar_pipeline(mask_deg):
    rng = np.random.default_rng(1)
    lat, lon = mc.sample_locations(rng, 200)
    t = mc.sample_times(rng, 200, c.period(c.A_GPS))
    batch = mc.run_trials(ELEMENTS, lat, lon, t, mask_deg)

    n_undefined = 0
    for i in range(200):
        sat = c.positions(ELEMENTS, t[i])
        rx = g.receiver_position(lat[i], lon[i], t[i])           # the Earth has turned by omega*t
        enu = g.enu_basis(lat[i], lon[i], t[i])
        _, el, unit = g.look_angles(rx, sat, enu)
        vis = el >= mask_deg
        ref = dop(unit[vis], enu)
        assert batch["n_visible"][i] == vis.sum()
        for k in KEYS:
            assert np.isclose(batch[k][i], ref[k], rtol=1e-9, atol=1e-12, equal_nan=True), (i, k)
        n_undefined += np.isnan(ref["gdop"])
    if mask_deg > 0:
        assert n_undefined > 20          # the undefined path really is exercised


def test_batch_positions_and_geometry_match_scalar():
    t = np.array([0.0, 1234.5, 40000.0])
    pos = c.positions(ELEMENTS, t)
    assert pos.shape == (3, 24, 3)
    for i in range(3):
        assert np.allclose(pos[i], c.positions(ELEMENTS, t[i]))
    assert c.positions(ELEMENTS, 5.0).shape == (24, 3)          # scalar shape unchanged
    assert g.enu_basis(np.array([10.0, 20.0]), np.array([30.0, 40.0])).shape == (2, 3, 3)


def test_dop_batch_tetrahedron_hand_values():
    s = np.sqrt(8) / 3
    az = np.radians([0, 120, 240])
    v = np.array([[0, 0, 1]] + [[s * np.cos(a), s * np.sin(a), -1 / 3] for a in az])
    out = dop_batch(v[None], np.ones((1, 4), dtype=bool), np.eye(3)[None])
    assert np.isclose(out["gdop"][0], np.sqrt(10) / 2)
    assert np.isclose(out["pdop"][0], 1.5)
    assert np.isclose(out["tdop"][0], 0.5)


# ---- sampling ---------------------------------------------------------------------

def test_sampling_is_uniform_by_area():
    n = 200_000
    rng = np.random.default_rng(0)
    lat, lon = mc.sample_locations(rng, n)
    z = np.sin(np.radians(lat))
    assert abs(z.mean()) < 4 * math.sqrt(1 / 3 / n)             # mean of sin(lat) is 0; variance 1/3
    frac_tropics = np.mean(np.abs(lat) < 30)                     # sin(30 deg) = 1/2 of the area
    assert abs(frac_tropics - 0.5) < 4 * math.sqrt(0.25 / n)
    assert abs(lon.mean()) < 4 * 360 / math.sqrt(12 * n)         # uniform on 360 deg: variance 360^2/12
    assert lat.min() >= -90 and lat.max() <= 90 and lon.min() >= -180 and lon.max() < 180


def test_sample_times_in_period():
    T = c.period(c.A_GPS)
    t = mc.sample_times(np.random.default_rng(0), 10_000, T)
    assert t.min() >= 0 and t.max() < T


# ---- analytic coverage (the check promised in the proposal) --------------------------

def test_cap_probability_values():
    # mask 0: lambda = arccos(R/a), p = (1 - R/a)/2
    assert np.isclose(mc.single_sat_probability(c.A_GPS, 0.0), (1 - g.R_EARTH / c.A_GPS) / 2)
    assert np.isclose(mc.expected_mean_visible(ELEMENTS, 0.0), 9.118, atol=0.002)


@pytest.mark.parametrize("mask_deg", [0.0, 10.0, 30.0])
def test_single_satellite_fraction_matches_analytic(mask_deg):
    one = ELEMENTS[:1]
    n = 200_000
    run = mc.MonteCarlo(n, seed=3, mask_deg=mask_deg, elements=one)
    run.advance(n)
    p = float(mc.single_sat_probability(one[0, 0], mask_deg))
    frac = np.mean(run.n_visible == 1)
    assert abs(frac - p) < 4 * math.sqrt(p * (1 - p) / n)


def test_24_satellite_mean_matches_analytic():
    n = 200_000
    run = mc.MonteCarlo(n, seed=4)
    run.advance(n)
    se = run.n_visible.std(ddof=1) / math.sqrt(n)
    expected = mc.expected_mean_visible(ELEMENTS, 0.0)
    print(f"MC mean {run.n_visible.mean():.4f} +- {se:.4f}, analytic {expected:.4f}")
    assert abs(run.n_visible.mean() - expected) < 4 * se


# ---- seeds and chunking -----------------------------------------------------------------

def test_same_seed_gives_identical_results_regardless_of_chunking():
    a = mc.MonteCarlo(5000, seed=7)
    b = mc.MonteCarlo(5000, seed=7)
    while a.done < a.n:
        a.advance(1000)
    while b.done < b.n:
        b.advance(777)
    assert np.array_equal(a.n_visible, b.n_visible)
    for k in KEYS:
        assert np.array_equal(a.dop[k], b.dop[k], equal_nan=True)


def test_different_seeds_differ_and_random_seed_is_reported():
    a, b = mc.MonteCarlo(1000, seed=1), mc.MonteCarlo(1000, seed=2)
    assert not np.array_equal(a.lat, b.lat)
    assert isinstance(mc.MonteCarlo(10).seed, int)


# ---- summary statistics on a hand-made result ---------------------------------------------

def test_summary_matches_hand_calculation():
    run = mc.MonteCarlo(10, seed=0)
    run.n_visible = np.array([4, 5, 6, 7, 8, 9, 10, 3, 3, 12])
    run.dop["pdop"] = np.array([2, 3, 4, 5, 6, 7, 8, np.nan, np.nan, 1.0])
    run.done = 10
    s = run.summary("pdop")
    assert np.isclose(s["nsat"]["mean"], 6.7)
    assert s["nsat"]["min"] == 3 and s["nsat"]["max"] == 12
    assert np.isclose(s["nsat"]["frac_ge4"], 0.8)
    # good = N >= 4 and PDOP <= 6: trials 0..4 and the last one -> 6 of 10
    assert np.isclose(s["availability"]["p"], 0.6)
    assert s["dop"]["n_undefined"] == 2
    assert np.isclose(s["dop"]["median"], 4.5)                  # values 1..8 -> median 4.5
    assert sum(s["nsat"]["counts"]) == 10 and s["nsat"]["counts"][3] == 2
    assert sum(s["dop"]["hist_counts"]) + s["dop"]["overflow"] == 8


def test_partial_run_summary_and_json_entry_points():
    import json
    start = json.loads(mc.mc_start(5000, 11, 6.0))
    assert start == {"n": 5000, "seed": 11, "window_days": 365.0}
    adv = json.loads(mc.mc_advance(1200, True))
    assert adv["done"] == 1200 and len(adv["points"]["lat"]) == 1200
    s = json.loads(mc.mc_summary("gdop"))
    assert s["n_done"] == 1200 and s["dop"]["type"] == "gdop"
