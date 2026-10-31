"""The FAA's coverage method (GPS SPS Performance Analysis Report #26, section 2), for any satellites.

Grid: every 5 deg from 180W to 175E (72 longitudes) and 80S to 80N (33 latitudes): 2,376 points.
Time: every minute for 24 h (1,440 samples). Mask: 5 deg. A sample is "good" if 4 or more satellites
are above the mask and PDOP <= 6. Reported per day:
  - global 99.9% PDOP: the 99.9th percentile of PDOP over all point-minutes (undefined PDOP, fewer than
    4 satellites, counts as infinitely bad);
  - global average: the percentage of good point-minutes, every grid point weighted equally (as on the
    FAA's grid); the area-weighted value (cos latitude) is given too;
  - worst-case point: the lowest percentage of good minutes at any one grid point;
and, for the maps, each point's 99.99th-percentile PDOP (the statistic of the FAA's contour plot).
Everything is computed in the Earth-fixed frame, where the grid points do not move.
"""

import json
import math

import numpy as np

from . import almanac, constellation, geometry, presets
from .dop import dop_batch

GRID_LATS = np.arange(-80.0, 80.1, 5.0)          # 33
GRID_LONS = np.arange(-180.0, 180.0, 5.0)        # 72
MASK_DEG = 5.0
PDOP_MAX = 6.0
MINUTES = 1440


def grid():
    lat, lon = np.meshgrid(GRID_LATS, GRID_LONS, indexing="ij")
    return lat.ravel(), lon.ravel()               # 2,376 points, latitude-major


class Coverage:
    """Accumulates the FAA statistics minute by minute, so a long run can report progress.

    positions_at(t_array) must return Earth-fixed satellite positions (km), shape (len(t), N, 3), for
    the times t_array (any time unit the caller likes: these are just labels passed through)."""

    def __init__(self, positions_at, times, mask_deg=MASK_DEG, pdop_max=PDOP_MAX):
        self.positions_at, self.times = positions_at, np.asarray(times, dtype=float)
        self.mask_deg, self.pdop_max = mask_deg, pdop_max
        self.lat, self.lon = grid()
        self.rx = geometry.earth_fixed_position(self.lat, self.lon)      # (M, 3)
        self.enu = geometry.earth_fixed_enu(self.lat, self.lon)         # (M, 3, 3)
        M, T = len(self.lat), len(self.times)
        self.pdop = np.full((T, M), np.inf)          # inf where undefined (counts as bad)
        self.nvis = np.zeros((T, M), dtype=np.int16)
        self.done = 0

    def advance(self, n_minutes):
        """Compute the next n_minutes samples. Returns the fraction done."""
        stop = min(len(self.times), self.done + int(n_minutes))
        M = len(self.lat)
        for k in range(self.done, stop):
            sat = self.positions_at(self.times[k:k + 1])[0]                         # (N, 3)
            sats = np.broadcast_to(sat, (M,) + sat.shape)
            _, el, unit = geometry.look_angles(self.rx, sats, self.enu)
            visible = el >= self.mask_deg
            p = dop_batch(unit, visible, self.enu)["pdop"]
            self.pdop[k] = np.where(np.isnan(p), np.inf, p)
            self.nvis[k] = visible.sum(axis=1)
        self.done = stop
        return self.done / len(self.times)

    def results(self):
        d = self.done
        pdop, nvis = self.pdop[:d], self.nvis[:d]
        good = (nvis >= 4) & (pdop <= self.pdop_max)
        per_point = good.mean(axis=0)                                               # (M,)
        weights = np.cos(np.radians(self.lat))
        worst = int(np.argmin(per_point))
        point_999 = np.percentile(pdop, 99.9, axis=0)                               # each point's 99.9% PDOP
        finite = np.isfinite(point_999)          # infinite where a point lacks a fix more than 0.1% of the time
        return {
            "minutes": d,
            # The report does not define "global 99.9% PDOP". The mean over grid points of each point's own
            # 99.9th-percentile PDOP reproduces its values (e.g. 3.30 vs 3.31, 3.70 vs 3.71); the 99.9th
            # percentile of all point-minutes pooled together comes out about 0.8 higher. Both are given.
            "global_999_pdop": float(point_999[finite].mean()) if finite.any() else float("inf"),
            "global_999_pdop_pooled": float(np.percentile(pdop, 99.9)),
            "points_without_999_pdop": int((~finite).sum()),
            "global_average_pct": 100.0 * float(good.mean()),
            "global_average_area_weighted_pct": 100.0 * float(np.average(per_point, weights=weights)),
            "worst_point_pct": 100.0 * float(per_point[worst]),
            "worst_point": {"lat": float(self.lat[worst]), "lon": float(self.lon[worst]),
                            "min_visible": int(nvis[:, worst].min()),
                            "pct_time_8_or_more_visible": 100.0 * float((nvis[:, worst] >= 8).mean())},
            "mean_visible": float(nvis.mean()),
            "mean_visible_area_weighted": float(np.average(nvis.mean(axis=0), weights=weights)),
            "max_pdop": float(pdop.max()),
            # map: each point's 99.99th-percentile PDOP (inf -> null in JSON is done by the caller)
            "point_9999_pdop": np.percentile(pdop, 99.99, axis=0).tolist(),
        }


# ---- entry points for the browser's worker ("Recompute this week") ---------------------------------------

_run = None


def _clean(x):
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, list):
        return [_clean(v) for v in x]
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    return x


def faa_start(week):
    """Start one week (1003-1016, real almanac, healthy satellites) or week 0 = the ideal Walker 24/6/1."""
    global _run
    week = int(week)
    if week == 0:
        el = presets.gps()
        _run = Coverage(lambda tt: geometry.inertial_to_earth_fixed(constellation.positions(el, tt), tt), 60.0 * np.arange(MINUTES))
    else:
        sats = almanac.load_week(week)
        _run = Coverage(lambda tt: almanac.ecef_positions(sats, tt), sats[0]["toa"] + 60.0 * np.arange(MINUTES))
    return json.dumps({"minutes": MINUTES})


def faa_advance(n_minutes):
    return json.dumps({"fraction": _run.advance(n_minutes)})


def faa_result():
    r = _run.results()
    r.pop("point_9999_pdop")
    return json.dumps(_clean(r))
