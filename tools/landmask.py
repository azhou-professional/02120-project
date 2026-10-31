"""Turn the Natural Earth land outlines into a small land/ocean grid for the low-poly Earth.

Input : data/ne_110m_land.geojson   (Natural Earth 110 m "Land", public domain)
Output: web/data/land_mask.json     (1-degree grid, one bit per cell)

Grid: 360 columns (longitude) x 180 rows (latitude). Cell (row, col) is centred at
    lat = 90 - (row + 0.5) degrees   (row 0 is the northernmost row)
    lon = -180 + (col + 0.5) degrees
and is land if that centre lies inside a land polygon. Bits are packed row by row,
most significant bit first, then written as base64.

Run from the project root:   python tools/landmask.py
"""

import base64
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "ne_110m_land.geojson"
OUTPUT = ROOT / "web" / "data" / "land_mask.json"
WIDTH, HEIGHT = 360, 180


def polygons(geojson):
    """Each land polygon as a list of rings (outer ring first, then holes); a ring is a
    list of (lon, lat) points."""
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        parts = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for rings in parts:
            yield [[(p[0], p[1]) for p in ring] for ring in rings]


def point_in_polygon(x, y, rings):
    """Ray casting (even-odd rule): shoot a ray toward +x and count edge crossings over
    all rings of the polygon. An odd count means inside; a hole's ring flips it back."""
    inside = False
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y):
                if x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                    inside = not inside
    return inside


def land_mask(geojson, width=WIDTH, height=HEIGHT):
    """Boolean array (height, width): True where the cell centre is on land.

    Scanline fill: for each row, find where every polygon edge crosses that latitude,
    sort the crossings, and fill between pairs (the same even-odd rule as above, but
    much faster than testing every cell against every polygon)."""
    lon_centres = -180.0 + (np.arange(width) + 0.5) * (360.0 / width)
    mask = np.zeros((height, width), dtype=bool)
    polys = list(polygons(geojson))
    for row in range(height):
        lat = 90.0 - (row + 0.5) * (180.0 / height)
        for rings in polys:
            xs = []
            for ring in rings:
                for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
                    if (y1 > lat) != (y2 > lat):
                        xs.append(x1 + (lat - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for x_in, x_out in zip(xs[0::2], xs[1::2]):
                mask[row] |= (lon_centres >= x_in) & (lon_centres < x_out)
    return mask


def pack_bits(mask):
    """Row-major, most significant bit first (what web/earth.js reads)."""
    return np.packbits(mask.reshape(-1)).tobytes()


def unpack_bits(data, width=WIDTH, height=HEIGHT):
    bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8))[: width * height]
    return bits.reshape(height, width).astype(bool)


def is_land(mask, lat, lon):
    """Look up (lat, lon) in degrees in a mask made by land_mask (same rule as the JS code)."""
    height, width = mask.shape
    row = min(height - 1, max(0, int((90.0 - lat) * height / 180.0)))
    col = min(width - 1, max(0, int((lon + 180.0) * width / 360.0)))
    return bool(mask[row, col])


def main():
    geojson = json.loads(SOURCE.read_text())
    mask = land_mask(geojson)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "width": WIDTH,
        "height": HEIGHT,
        "source": "Natural Earth 110m Land (public domain), https://www.naturalearthdata.com",
        "layout": "row 0 = lat 89.5, col 0 = lon -179.5; row-major, MSB first, base64",
        "bits": base64.b64encode(pack_bits(mask)).decode("ascii"),
    }))
    weights = np.cos(np.radians(90.0 - (np.arange(HEIGHT) + 0.5)))[:, None]
    land_fraction = float((mask * weights).sum() / (np.ones_like(mask) * weights).sum())
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {mask.sum()} land cells of {mask.size}, "
          f"{100 * land_fraction:.1f}% of the surface area is land")


if __name__ == "__main__":
    main()
