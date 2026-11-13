"""Checks for the Earth colour grid behind the low-poly Earth's land (tools/earthmap.py)."""

import base64
import json
from pathlib import Path

import numpy as np

import earthmap as em

GRID_FILE = Path(__file__).resolve().parent.parent / "web" / "data" / "earth_color.json"


def stored_grid():
    info = json.loads(GRID_FILE.read_text())
    data = np.frombuffer(base64.b64decode(info["rgb"]), dtype=np.uint8)
    return data.reshape(info["height"], info["width"], 3)


def test_cell_means_of_a_known_image():
    # a 360 x 720 image (2 x 2 pixels per cell): left half red, right half blue,
    # and one cell whose four pixels are 0, 0, 100, 100 in green (mean 50)
    image = np.zeros((360, 720, 3))
    image[:, :360, 0] = 200
    image[:, 360:, 2] = 120
    image[0:2, 0:2, 1] = [[0, 0], [100, 100]]
    grid = em.color_grid(image)
    assert grid.shape == (180, 360, 3)
    assert (grid[:, :180] == [200, 0, 0]).all(axis=2)[1:].all()
    assert (grid[:, 180:] == [0, 0, 120]).all()
    assert tuple(grid[0, 0]) == (200, 50, 0)


def test_lookup_rule():
    grid = np.arange(180 * 360 * 3).reshape(180, 360, 3) % 256
    assert em.color(grid, 89.5, -179.5) == tuple(grid[0, 0])
    assert em.color(grid, -89.5, 179.5) == tuple(grid[179, 359])
    assert em.color(grid, 0.5, 0.5) == tuple(grid[89, 180])
    assert em.color(grid, 90.0, 180.0) == tuple(grid[0, 359])      # the edges stay in the grid


def test_stored_grid_has_known_colours():
    grid = stored_grid()
    assert grid.shape == (em.HEIGHT, em.WIDTH, 3)
    r, g, b = em.color(grid, *em.PLACES["Sahara"])
    assert r > g > b and r > 120                                   # bright sand: tan
    r, g, b = em.color(grid, *em.PLACES["Amazon"])
    assert g > r and g > b                                          # rainforest: green
    r, g, b = em.color(grid, *em.PLACES["Australian interior"])
    assert r > g > b                                                # red desert
    for ice in ("Greenland", "Antarctica"):
        assert min(em.color(grid, *em.PLACES[ice])) > 200           # ice sheets: white
    assert max(em.color(grid, *em.PLACES["Pacific Ocean"])) < 40    # open ocean: dark


def test_land_is_brighter_than_ocean_overall():
    # uses the land grid of tools/landmask.py: same 1-degree cells, row 0 at the north
    info = json.loads((GRID_FILE.parent / "land_mask.json").read_text())
    bits = np.unpackbits(np.frombuffer(base64.b64decode(info["bits"]), dtype=np.uint8))
    land = bits[: info["width"] * info["height"]].reshape(info["height"], info["width"]).astype(bool)
    brightness = stored_grid().astype(float).mean(axis=2)
    assert brightness[land].mean() > brightness[~land].mean() + 50
