"""Checks for the land/ocean grid behind the low-poly Earth (tools/landmask.py)."""

import base64
import json

import numpy as np
import pytest

import landmask as lm


# ---- point-in-polygon on shapes we can check by eye ------------------------------------

SQUARE = [(0, 0), (10, 0), (10, 10), (0, 10)]
HOLE = [(4, 4), (6, 4), (6, 6), (4, 6)]
L_SHAPE = [(0, 0), (10, 0), (10, 4), (4, 4), (4, 10), (0, 10)]


def test_point_in_square():
    assert lm.point_in_polygon(5, 5, [SQUARE])
    assert not lm.point_in_polygon(11, 5, [SQUARE])
    assert not lm.point_in_polygon(5, -1, [SQUARE])


def test_hole_is_outside():
    assert lm.point_in_polygon(2, 2, [SQUARE, HOLE])            # in the square, not in the hole
    assert not lm.point_in_polygon(5, 5, [SQUARE, HOLE])        # inside the hole


def test_concave_shape():
    assert lm.point_in_polygon(2, 8, [L_SHAPE])                 # up the left arm
    assert lm.point_in_polygon(8, 2, [L_SHAPE])                 # along the bottom arm
    assert not lm.point_in_polygon(8, 8, [L_SHAPE])             # the notch


def geojson_of(*polys):
    return {"features": [{"geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring] for ring in rings]}}
                         for rings in polys]}


def test_scanline_fill_matches_ray_casting_on_simple_shapes():
    """The fast scanline fill and the slow point-by-point test must agree on every cell."""
    gj = geojson_of([L_SHAPE], [SQUARE, HOLE])
    gj["features"][1]["geometry"]["coordinates"] = [[[x + 30, y + 20] for x, y in ring] for ring in (SQUARE, HOLE)]
    mask = lm.land_mask(gj)
    polys = list(lm.polygons(gj))
    for row in range(180):
        for col in range(360):
            lat, lon = 90 - (row + 0.5), -180 + (col + 0.5)
            expected = any(lm.point_in_polygon(lon, lat, rings) for rings in polys)
            assert mask[row, col] == expected, (row, col)


# ---- the real Natural Earth data ---------------------------------------------------------

@pytest.fixture(scope="module")
def real():
    gj = json.loads(lm.SOURCE.read_text())
    return gj, lm.land_mask(gj)


def test_scanline_matches_ray_casting_on_real_coastlines(real):
    gj, mask = real
    polys = list(lm.polygons(gj))
    rng = np.random.default_rng(0)
    for _ in range(400):
        row, col = int(rng.integers(0, 180)), int(rng.integers(0, 360))
        lat, lon = 90 - (row + 0.5), -180 + (col + 0.5)
        expected = any(lm.point_in_polygon(lon, lat, rings) for rings in polys)
        assert mask[row, col] == expected, (lat, lon)


LAND = {"Pittsburgh": (40.44, -79.94), "Sahara": (23, 12), "Amazon": (-5, -60), "Greenland": (72, -40),
        "Antarctica": (-80, 0), "Australia": (-25, 134), "Siberia": (62, 100), "India": (22, 78),
        "Brazil": (-10, -50), "Madagascar": (-19, 47)}
OCEAN = {"mid-Atlantic": (0, -30), "mid-Pacific": (0, -150), "Indian Ocean": (-30, 80),
         "Arctic Ocean": (88, 0), "south Pacific": (-45, -130), "Southern Ocean": (-60, 100),
         "Gulf of Guinea": (0, 0)}


@pytest.mark.parametrize("name", LAND)
def test_known_land(real, name):
    lat, lon = LAND[name]
    assert lm.is_land(real[1], lat, lon), name


@pytest.mark.parametrize("name", OCEAN)
def test_known_ocean(real, name):
    lat, lon = OCEAN[name]
    assert not lm.is_land(real[1], lat, lon), name


def test_land_area_fraction_is_about_29_percent(real):
    """Land covers about 29% of the Earth's surface (about 149 of 510 million km^2).
    Cells shrink toward the poles, so weight each row by cos(latitude)."""
    mask = real[1]
    w = np.cos(np.radians(90 - (np.arange(180) + 0.5)))[:, None]
    fraction = (mask * w).sum() / (np.ones_like(mask) * w).sum()
    assert 0.26 < fraction < 0.32, fraction


# ---- the file the web page reads ----------------------------------------------------------

def test_bit_packing_round_trip(real):
    mask = real[1]
    assert np.array_equal(lm.unpack_bits(lm.pack_bits(mask)), mask)


def test_generated_json_matches_the_mask(real):
    """web/data/land_mask.json is what the browser loads. Decode it the way earth.js does
    (row-major, most significant bit first) and compare with a fresh mask."""
    info = json.loads(lm.OUTPUT.read_text())
    assert (info["width"], info["height"]) == (360, 180)
    raw = base64.b64decode(info["bits"])
    assert len(raw) == 360 * 180 // 8
    for row, col in [(0, 0), (49, 100), (100, 180), (179, 359), (60, 280), (130, 90)]:
        i = row * 360 + col
        bit = (raw[i >> 3] >> (7 - (i & 7))) & 1
        assert bool(bit) == bool(real[1][row, col])
    assert np.array_equal(lm.unpack_bits(raw), real[1])
