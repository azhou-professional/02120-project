"""Checks the DOP calculation against a hand-derived case and mathematical invariants."""

import json

import numpy as np

from sim import api
from sim.dop import dop

I3 = np.eye(3)


def tetrahedron():
    """Regular tetrahedron: one vertex straight up, three below at z = -1/3.

    The vertices sum to 0 and sum(e e^T) = (4/3) I. Hence
        G^T G = diag(4/3, 4/3, 4/3, 4),  Q = diag(3/4, 3/4, 3/4, 1/4)
        GDOP = sqrt(9/4 + 1/4) = sqrt(10)/2 = 1.5811
        PDOP = sqrt(9/4) = 1.5,   TDOP = sqrt(1/4) = 0.5
        HDOP = sqrt(3/4 + 3/4) = sqrt(1.5),   VDOP = sqrt(3/4)
    (Three vertices are below the horizon; the function does not care, so this
    is still a valid check of the matrix algebra.)
    """
    s = np.sqrt(8) / 3
    az = np.radians([0, 120, 240])
    low = [[s * np.cos(a), s * np.sin(a), -1 / 3] for a in az]
    return np.array([[0, 0, 1]] + low)


def test_tetrahedron_matches_hand_calculation():
    v = tetrahedron()
    assert np.allclose(v.sum(axis=0), 0)
    out = dop(v, I3)
    assert np.isclose(out["gdop"], np.sqrt(10) / 2)
    assert np.isclose(out["pdop"], 1.5)
    assert np.isclose(out["tdop"], 0.5)
    assert np.isclose(out["hdop"], np.sqrt(1.5))
    assert np.isclose(out["vdop"], np.sqrt(0.75))


def test_fewer_than_four_satellites_is_undefined():
    out = dop(tetrahedron()[:3], I3)
    assert all(np.isnan(x) for x in out.values())


def test_degenerate_geometry_is_undefined():
    # all satellites on the horizon plane (z = 0): the vertical is unobservable
    az = np.radians([0, 72, 144, 216, 288])
    flat = np.array([[np.cos(a), np.sin(a), 0.0] for a in az])
    out = dop(flat, I3)
    assert all(np.isnan(x) for x in out.values())


def test_rotating_about_vertical_does_not_change_dop():
    v = tetrahedron() + 0.0
    th = np.radians(37)
    Rz = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]])
    a, b = dop(v, I3), dop(v @ Rz.T, I3)
    for k in a:
        assert np.isclose(a[k], b[k])


def test_adding_a_satellite_never_increases_gdop():
    rng = np.random.default_rng(0)
    for _ in range(50):
        v = rng.normal(size=(6, 3))
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        assert dop(v, I3)["gdop"] <= dop(v[:5], I3)["gdop"] + 1e-12
        assert dop(v[:5], I3)["gdop"] <= dop(v[:4], I3)["gdop"] + 1e-12


def snap(lat, lon, t, mask=api.DEFAULT_MASK_DEG):
    return json.loads(api.snapshot(lat, lon, t, mask))


def test_dop_identities_on_real_constellation():
    for lat, lon, t in [(40.4, -80.0, 0), (0, 0, 10000), (-60, 100, 30000), (70, -20, 50000)]:
        d = snap(lat, lon, t)["dop"]
        assert np.isclose(d["gdop"] ** 2, d["pdop"] ** 2 + d["tdop"] ** 2)
        assert np.isclose(d["pdop"] ** 2, d["hdop"] ** 2 + d["vdop"] ** 2)


def test_snapshot_contains_orbit_information_for_the_tooltip():
    s = snap(40.4, -80.0, 12345.0)
    for key in ("elements", "period_s", "speed_kms", "u_deg", "sat_lat", "sat_lon"):
        assert len(s[key]) == 24, key
    assert np.allclose(s["elements"][0], [26559.7, 55.0, 0.0, 0.0])
    assert abs(s["period_s"][0] / 3600 - 11.967) < 0.01
    assert abs(s["speed_kms"][0] - 3.87) < 0.01
    assert s["r_earth_km"] == 6378.137


def test_snapshot_is_valid_json_when_nothing_is_visible():
    s = snap(0, 0, 0, mask=89.99)
    assert s["n_visible"] <= 1
    assert s["dop"]["gdop"] is None


def test_loose_sanity_of_visibility_and_pdop():
    """Not a formal validation (that is Stages 2 and 5), only a smell test."""
    counts, pdops = [], []
    for lat in range(-80, 81, 20):
        for lon in range(-180, 180, 60):
            for t in range(0, 43200, 3600):
                s = snap(lat, lon, t)
                counts.append(s["n_visible"])
                if s["dop"]["pdop"] is not None:
                    pdops.append(s["dop"]["pdop"])
    counts, pdops = np.array(counts), np.array(pdops)
    print(f"visible: mean {counts.mean():.2f}, min {counts.min()}, max {counts.max()}")
    print(f"PDOP: median {np.median(pdops):.2f}, 95th pct {np.percentile(pdops, 95):.2f}")
    assert 7 < counts.mean() < 13
    assert 1 < np.median(pdops) < 3
