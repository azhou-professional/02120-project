"""Turn the NASA Moon colour map into a small brightness (albedo) grid for the low-poly Moon.

Input : data/moon/lroc_color_poles_1k.jpg   (NASA Scientific Visualization Studio, CGI Moon Kit,
        https://svs.gsfc.nasa.gov/4720 ; Lunar Reconnaissance Orbiter Wide Angle Camera mosaic,
        1024 x 512, equirectangular, longitude -180..180 with 0 (the centre of the near side) in the middle)
Output: web/data/moon_albedo.json   (2-degree grid, one byte of brightness per cell)

Grid: 180 columns (longitude) x 90 rows (latitude). Cell (row, col) covers
    lat 90 - 2*row ... 90 - 2*(row+1)   (row 0 is the northernmost row)
    lon -180 + 2*col ... -180 + 2*(col+1)
and holds the mean grey level (0-255) of the image pixels in it. Bytes are row by row, base64.

Needs Pillow (to read the JPEG). Run from the project root:   python tools/moonmap.py
"""

import base64
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "moon" / "lroc_color_poles_1k.jpg"
OUTPUT = ROOT / "web" / "data" / "moon_albedo.json"
WIDTH, HEIGHT = 180, 90

# Places to check the grid by (latitude, longitude in degrees): dark lava plains (maria) and bright highlands
MARIA = {"Mare Imbrium": (33, -16), "Mare Serenitatis": (28, 17), "Mare Tranquillitatis": (8.5, 31),
         "Mare Crisium": (17, 59), "Oceanus Procellarum": (18, -57)}
HIGHLANDS = {"southern highlands": (-30, 5), "far side": (10, 170), "near Tycho": (-35, -20)}


def albedo_grid(image):
    """Mean grey level of the image (a 2-D array, rows from north to south) in each grid cell."""
    rows, cols = image.shape
    grid = np.zeros((HEIGHT, WIDTH))
    r_edges = np.linspace(0, rows, HEIGHT + 1).round().astype(int)
    c_edges = np.linspace(0, cols, WIDTH + 1).round().astype(int)
    for i in range(HEIGHT):
        for j in range(WIDTH):
            grid[i, j] = image[r_edges[i]:r_edges[i + 1], c_edges[j]:c_edges[j + 1]].mean()
    return grid.round().astype(np.uint8)


def brightness(grid, lat, lon):
    """Look up (lat, lon) in degrees (same rule as web/moon.js)."""
    height, width = grid.shape
    row = min(height - 1, max(0, int((90.0 - lat) * height / 180.0)))
    col = min(width - 1, max(0, int((lon + 180.0) * width / 360.0)))
    return int(grid[row, col])


def main():
    from PIL import Image     # only this tool needs Pillow; the web app and the tests do not
    image = np.asarray(Image.open(SOURCE).convert("L"), dtype=float)
    grid = albedo_grid(image)
    OUTPUT.write_text(json.dumps({
        "width": WIDTH,
        "height": HEIGHT,
        "source": "NASA SVS CGI Moon Kit (LRO WAC mosaic), https://svs.gsfc.nasa.gov/4720",
        "layout": "row 0 = lat 89, col 0 = lon -179 (cell centres); row-major, one byte (grey 0-255) per cell, base64",
        "grey": base64.b64encode(grid.tobytes()).decode("ascii"),
    }))
    print(f"wrote {OUTPUT.relative_to(ROOT)}: grey levels {grid.min()}-{grid.max()}, mean {grid.mean():.0f}")
    for name, (lat, lon) in {**MARIA, **HIGHLANDS}.items():
        print(f"  {name:22s} {brightness(grid, lat, lon):4d}")


if __name__ == "__main__":
    main()
