"""Checks for the Moon brightness grid behind the low-poly Moon (tools/moonmap.py)."""

import base64
import json
from pathlib import Path

import numpy as np

import moonmap as mm

GRID_FILE = Path(__file__).resolve().parent.parent / "web" / "data" / "moon_albedo.json"


def stored_grid():
    info = json.loads(GRID_FILE.read_text())
    data = np.frombuffer(base64.b64decode(info["grey"]), dtype=np.uint8)
    return data.reshape(info["height"], info["width"])


def test_cell_means_of_a_known_image():
    """An image whose left half is 0 and right half 200 gives cells of 0 and 200."""
    image = np.zeros((90 * 2, 180 * 2))
    image[:, 180:] = 200
    grid = mm.albedo_grid(image)
    assert grid.shape == (90, 180)
    assert (grid[:, :90] == 0).all() and (grid[:, 90:] == 200).all()


def test_lookup_rule():
    grid = np.arange(90 * 180).reshape(90, 180) % 256
    assert mm.brightness(grid, 89.0, -179.0) == grid[0, 0]
    assert mm.brightness(grid, -89.0, 179.0) == grid[89, 179]
    assert mm.brightness(grid, 0.5, 0.5) == grid[44, 90]
    assert mm.brightness(grid, 90.0, 180.0) == grid[0, 179]    # the edges stay in the grid


def test_stored_grid_shows_dark_maria_and_bright_highlands():
    grid = stored_grid()
    assert grid.shape == (mm.HEIGHT, mm.WIDTH)
    darkest_highland = min(mm.brightness(grid, *p) for p in mm.HIGHLANDS.values())
    brightest_mare = max(mm.brightness(grid, *p) for p in mm.MARIA.values())
    assert brightest_mare < darkest_highland


def test_near_side_has_more_maria_than_far_side():
    """The maria are almost all on the near side (longitudes -90..90)."""
    grid = stored_grid().astype(float)
    near, far = grid[:, 45:135], np.hstack([grid[:, :45], grid[:, 135:]])
    assert near.mean() < far.mean() - 15
