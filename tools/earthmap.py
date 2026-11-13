"""Turn the NASA Blue Marble image into a small colour grid for the land of the low-poly Earth.

Input : data/earth/world.200401.3x5400x2700.jpg   (NASA Earth Observatory, Blue Marble Next Generation,
        January 2004, true colour without bathymetry, public domain; 5400 x 2700, equirectangular,
        north at the top, longitude -180 at the left edge)
        https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/january/world.200401.3x5400x2700.jpg
Output: web/data/earth_color.json   (1-degree grid, three bytes R, G, B per cell)

Grid: 360 columns (longitude) x 180 rows (latitude), the same cells as tools/landmask.py. Cell (row, col) covers
    lat 90 - row ... 90 - (row+1)   (row 0 is the northernmost row)
    lon -180 + col ... -180 + (col+1)
and holds the mean colour of the image pixels in it (15 x 15 pixels per cell). Cells are row by row,
each cell R, G, B, base64.

Only the colours of the land are used (web/earth.js); the ocean keeps its own colour. Like the Moon map,
this is only for the look: nothing in the DOP or coverage results depends on it.

Needs Pillow (to read the JPEG). Run from the project root:   python tools/earthmap.py
"""

import base64
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "earth" / "world.200401.3x5400x2700.jpg"
OUTPUT = ROOT / "web" / "data" / "earth_color.json"
WIDTH, HEIGHT = 360, 180

# Places to check the grid by (latitude, longitude in degrees)
PLACES = {"Sahara": (23, 13), "Amazon": (-5, -62), "Australian interior": (-25, 133),
          "Greenland": (75, -40), "Antarctica": (-80, 0), "Siberia (January snow)": (62, 100),
          "Pacific Ocean": (0, -150)}


def color_grid(image):
    """Mean colour of the image (array rows x cols x 3, rows from north to south) in each grid cell."""
    rows, cols, _ = image.shape
    grid = np.zeros((HEIGHT, WIDTH, 3))
    r_edges = np.linspace(0, rows, HEIGHT + 1).round().astype(int)
    c_edges = np.linspace(0, cols, WIDTH + 1).round().astype(int)
    for i in range(HEIGHT):
        for j in range(WIDTH):
            grid[i, j] = image[r_edges[i]:r_edges[i + 1], c_edges[j]:c_edges[j + 1]].mean(axis=(0, 1))
    return grid.round().astype(np.uint8)


def color(grid, lat, lon):
    """Look up (lat, lon) in degrees -> (R, G, B) in 0-255 (same rule as web/earth.js)."""
    height, width, _ = grid.shape
    row = min(height - 1, max(0, int((90.0 - lat) * height / 180.0)))
    col = min(width - 1, max(0, int((lon + 180.0) * width / 360.0)))
    return tuple(int(x) for x in grid[row, col])


def main():
    from PIL import Image     # only this tool needs Pillow; the web app and the tests do not
    image = np.asarray(Image.open(SOURCE).convert("RGB"), dtype=float)
    grid = color_grid(image)
    OUTPUT.write_text(json.dumps({
        "width": WIDTH,
        "height": HEIGHT,
        "source": "NASA Blue Marble Next Generation, January 2004 (world.200401.3x5400x2700.jpg), public domain",
        "layout": "row 0 = lat 89.5, col 0 = lon -179.5 (cell centres); row-major, 3 bytes (R, G, B 0-255) per cell, base64",
        "rgb": base64.b64encode(grid.tobytes()).decode("ascii"),
    }))
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {WIDTH} x {HEIGHT} cells")
    for name, (lat, lon) in PLACES.items():
        print(f"  {name:24s} R, G, B = {color(grid, lat, lon)}")


if __name__ == "__main__":
    main()
