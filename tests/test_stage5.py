"""Stage 5: real 1999 GPS almanacs, the FAA coverage method, and Langley's worked DOP values."""

import datetime as dt
import json
import math
import re
from pathlib import Path

import numpy as np
import pytest

from sim import almanac as al
from sim import api, constellation as c, faa, geometry as g, presets
from sim.dop import dop

WEB = Path(__file__).resolve().parent.parent / "web"


# ---- almanac parsing -------------------------------------------------------------------------------------

def test_parse_week_1007_against_the_file_text():
    """PRN 1 of week 1007, read off the file by eye: e = 4.8365592957E-003, sqrt(A) = 5154.285156,
    inclination 0.9570926428 rad, Right Ascen at TOA -1.4810622931, toa 589824, week 1007."""
    sats = al.load_week(1007, healthy_only=False)
    assert len(sats) == 27
    p1 = sats[0]
    assert p1["prn"] == 1 and p1["health"] == 0 and p1["week"] == 1007 and p1["toa"] == 589824.0
    assert p1["e"] == 4.8365592957e-3 and p1["sqrt_a"] == 5154.285156
    assert p1["i0"] == 0.9570926428 and p1["omega0"] == -1.4810622931


@pytest.mark.parametrize("week", range(1003, 1017))
def test_every_almanac_is_sensible(week):
    sats = al.load_week(week, healthy_only=False)
    assert 24 <= len(sats) <= 32 and all(s["week"] == week for s in sats)
    for s in sats:
        assert abs(s["sqrt_a"] - 5153.6) < 5 and 0 <= s["e"] < 0.03 and abs(math.degrees(s["i0"]) - 55) < 5


def test_reference_time_is_in_its_week():
    t = al.toa_datetime_utc(al.load_week(1007))
    assert dt.datetime(1999, 4, 25) <= t < dt.datetime(1999, 5, 2)          # week 1007 = 25 Apr - 1 May 1999


# ---- almanac orbits ---------------------------------------------------------------------------------------------

SATS = al.load_week(1007)
TOA = SATS[0]["toa"]


def test_orbit_radius_and_latitude():
    t = TOA + np.linspace(0, 86400, 300)
    p = al.ecef_positions(SATS, t)                                       # (300, N, 3)
    r = np.linalg.norm(p, axis=2)
    for k, s in enumerate(SATS):
        A = s["sqrt_a"] ** 2 / 1000
        assert r[:, k].min() >= A * (1 - s["e"]) - 1e-6 and r[:, k].max() <= A * (1 + s["e"]) + 1e-6
    lat = np.degrees(np.arcsin(p[..., 2] / r))
    assert np.all(np.abs(lat) <= np.degrees([s["i0"] for s in SATS]) + 1e-9)


def test_period_is_about_11h58m():
    A = SATS[0]["sqrt_a"] ** 2
    assert abs(2 * math.pi * math.sqrt(A**3 / al.MU_GPS) / 3600 - 11.967) < 0.02


def test_ground_track_repeats_after_a_sidereal_day():
    """Two orbits per sidereal day: the point below each satellite comes back to (almost) the same place."""
    p0 = al.ecef_positions(SATS, TOA)
    p1 = al.ecef_positions(SATS, TOA + g.T_SIDEREAL)
    angle = np.degrees(np.arccos(np.sum(p0 * p1, axis=1) / np.linalg.norm(p0, axis=1) / np.linalg.norm(p1, axis=1)))
    assert angle.max() < 1.0


def test_ascending_node_is_where_the_almanac_formula_says():
    """Find numerically when satellite 0 crosses the equator going north; its longitude there must be
    Omega0 + (Omega_dot - OmegaE) tk - OmegaE toa (the node longitude of IS-GPS-200)."""
    s = SATS[0]
    t = TOA + np.arange(0, 43200, 1.0)
    z = al.ecef_positions(SATS[:1], t)[:, 0, 2]
    k = np.nonzero((z[:-1] < 0) & (z[1:] >= 0))[0][0]
    tc = t[k] + (0 - z[k]) / (z[k + 1] - z[k])                            # interpolate the crossing
    x, y, _ = al.ecef_positions(SATS[:1], tc)[0]
    node = s["omega0"] + (s["omega_dot"] - al.OMEGA_E_GPS) * (tc - s["toa"]) - al.OMEGA_E_GPS * s["toa"]
    assert abs((math.degrees(math.atan2(y, x) - node) + 180) % 360 - 180) < 1e-3


def test_gps_1999_preset_puts_satellites_where_the_almanac_does():
    """At the almanac's reference time (on our timeline) the preset's satellites are exactly at the
    almanac positions; a day later they are within 20 km (the plane drift is left out)."""
    el = presets.gps_1999()
    t_toa = (al.toa_datetime_utc(SATS) - dt.datetime(2026, 1, 1)).total_seconds()
    for hours, tol in ((0, 1e-6), (24, 20.0)):
        ours = g.inertial_to_earth_fixed(c.positions(el, t_toa + 3600 * hours), t_toa + 3600 * hours)
        assert np.abs(ours - al.ecef_positions(SATS, TOA + 3600 * hours)).max() < tol


# ---- the FAA coverage method --------------------------------------------------------------------------------------

def test_grid_is_the_faas():
    lat, lon = faa.grid()
    assert len(lat) == 2376 and lat.min() == -80 and lat.max() == 80 and lon.min() == -180 and lon.max() == 175


def test_ideal_model_by_the_faa_method():
    """A short run (2 hours) on the ideal 24 satellites: everything is good, and the grid's mean number
    in view is close to the analytic value (the grid stops at 80 deg and the samples are few)."""
    el = presets.gps()
    cov = faa.Coverage(lambda tt: g.inertial_to_earth_fixed(c.positions(el, tt), tt), 60.0 * np.arange(120))
    cov.advance(120)
    r = cov.results()
    assert r["global_average_pct"] == 100.0 and r["worst_point_pct"] == 100.0
    from sim import montecarlo as mc
    assert abs(r["mean_visible_area_weighted"] - mc.expected_mean_visible(el, 5.0)) < 0.15
    assert r["global_999_pdop"] < r["global_999_pdop_pooled"]          # the per-point mean is the smaller one


def test_reproduction_file_matches_the_published_table_in_the_clean_weeks():
    """The stored reproduction (tools/reproduce_faa.py) against Table 2-1 in the weeks whose satellite set
    is not in doubt: availabilities to 0.01 percentage points, the 99.9% PDOP within 0.06."""
    data = json.loads((WEB / "data" / "faa_reproduction.json").read_text())
    for w in data["weeks"]:
        if w["week"] in (1003, 1004, 1005, 1006, 1013, 1015):
            pub, ours = w["published"], w["real"]
            assert abs(ours["global_average_pct"] - pub["global_average_pct"]) < 0.01, w["week"]
            assert abs(ours["worst_point_pct"] - pub["worst_point_pct"]) < 0.01, w["week"]
            assert abs(ours["global_999_pdop"] - pub["global_999_pdop"]) < 0.06, w["week"]
        if w["week"] in (1014, 1016):                       # with only PRN 15 left out
            pub, alt = w["published"], w["explanation"]["result"]
            assert abs(alt["worst_point_pct"] - pub["worst_point_pct"]) < 0.01
            assert abs(alt["global_999_pdop"] - pub["global_999_pdop"]) < 0.06


def test_recompute_entry_points_match_the_stored_week():
    data = json.loads((WEB / "data" / "faa_reproduction.json").read_text())
    stored = next(w for w in data["weeks"] if w["week"] == 1003)["real"]
    faa.faa_start(1003)
    while json.loads(faa.faa_advance(240))["fraction"] < 1:
        pass
    r = json.loads(faa.faa_result())
    for k in ("global_999_pdop", "global_average_pct", "worst_point_pct"):
        assert math.isclose(r[k], stored[k], rel_tol=1e-9)


# ---- Langley (1999) ---------------------------------------------------------------------------------------------------

def test_langley_worked_values():
    for row in json.loads(api.langley_checks()):
        tol = 0.5 if "elevation" in row["quantity"] else 0.0006           # 3 decimals published; "about 45 deg"
        assert abs(row["ours"] - row["published"]) < tol, row


def test_known_clock_needs_only_three_satellites():
    up = np.array([[0, 0, 1.0], [1, 0, 0], [0, 1, 0]])
    assert math.isnan(dop(up, np.eye(3))["pdop"])                          # 4 unknowns, 3 satellites
    assert math.isclose(dop(up, np.eye(3), estimate_clock=False)["pdop"], math.sqrt(3))
    assert math.isnan(dop(up, np.eye(3), estimate_clock=False)["gdop"])


def test_fredericton_day_matches_langleys_figure_5():
    r = json.loads(api.fredericton_day())
    assert abs(r["gdop_mean"] - 2.0) < 0.3 and r["gdop_max"] <= 3.5


# ---- the page loads the almanacs it needs -----------------------------------------------------------------------------

def test_pyloader_lists_every_almanac_file():
    text = (WEB / "pyloader.js").read_text()
    weeks = range(1003, 1017)
    toa = {int(k): int(v) for k, v in re.findall(r"(\d{4}): (\d+)", re.search(r"const TOA = \{(.*?)\}", text).group(1))}
    listed = {f"almanac.yuma.week{w}.{toa.get(w, 589824)}.txt" for w in weeks}
    on_disk = {p.name for p in (WEB / "data" / "almanac" / "1999").glob("*.txt")}
    assert listed == on_disk
