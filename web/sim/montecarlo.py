"""Monte-Carlo estimate of coverage and DOP.

Each trial picks a random receiver location (uniform over the sphere's surface)
and a random time, then records how many satellites are above the elevation
mask and the DOP values. A trial is "good" if it has at least 4 satellites and
PDOP <= pdop_max.

All random numbers for a run are drawn once, up front, from one seeded
generator. So the results depend only on (seed, n), never on how the run is
split into chunks.
"""

import json
import math

import numpy as np

from . import constellation, geometry, presets
from .dop import KEYS, dop_batch

MAX_TRIALS = 1_000_000
SUB_CHUNK = 20_000      # trials per vectorized batch (bounds memory)
HIST_BINS = 40
DEFAULT_WINDOW_S = 365 * 86400.0    # random times are drawn from [0, window): one year by default


# ---- sampling ------------------------------------------------------------------

def sample_locations(rng, n):
    """n random (lat, lon) in degrees, uniform by AREA on the sphere.

    The surface area between latitudes is proportional to the change in
    sin(lat), so sin(lat) is drawn uniformly on [-1, 1] (drawing lat itself
    uniformly would over-sample the poles).
    """
    lat = np.degrees(np.arcsin(rng.uniform(-1.0, 1.0, n)))
    lon = rng.uniform(-180.0, 180.0, n)
    return lat, lon


def sample_times(rng, n, window):
    """n random times uniform on [0, window) seconds."""
    return rng.uniform(0.0, window, n)


# ---- analytic coverage (used as a check) -----------------------------------------

def cap_half_angle(a, mask_deg):
    """Central angle (rad) from the sub-satellite point to where the satellite
    sits exactly at the mask elevation: lambda = arccos(R cos(eps) / a) - eps."""
    eps = np.radians(mask_deg)
    return np.arccos(geometry.R_EARTH * np.cos(eps) / a) - eps


def single_sat_probability(a, mask_deg):
    """Probability that a uniformly random surface point sees one satellite at
    radius a above the mask: area of the spherical cap / area of sphere = (1 - cos(lambda)) / 2."""
    return (1.0 - np.cos(cap_half_angle(a, mask_deg))) / 2.0


def expected_mean_visible(elements, mask_deg, n_grid=2048):
    """Expected number of visible satellites for a uniform random location (and a time spread
    evenly over whole orbits).

    By linearity of expectation this is the sum over satellites of the single-satellite
    probability. For a circular orbit that probability does not depend on the time. For an
    ellipse the distance r changes along the orbit, so the probability is averaged over the
    orbit: over the mean anomaly M (uniform in time), using n_grid equally spaced values
    (for a smooth periodic function this converges very fast)."""
    M = np.linspace(0.0, 2.0 * np.pi, n_grid, endpoint=False)
    a, ecc = elements[:, constellation.A, None], elements[:, constellation.ECC, None]
    r = a * (1.0 - ecc * np.cos(constellation.solve_kepler(M[None, :], ecc)))      # (N, n_grid)
    return float(np.sum(np.mean(single_sat_probability(r, mask_deg), axis=1)))


# ---- one batch of trials -----------------------------------------------------------

def run_trials(elements, lat, lon, t, mask_deg):
    """Satellite counts and DOPs for trials at (lat, lon, t) (equal-length arrays)."""
    sat = constellation.positions(elements, t)           # (M, N, 3)
    rx = geometry.receiver_position(lat, lon, t)         # (M, 3), the Earth has turned by omega*t
    enu = geometry.enu_basis(lat, lon, t)                # (M, 3, 3)
    _, el, unit = geometry.look_angles(rx, sat, enu)
    visible = el >= mask_deg
    out = dop_batch(unit, visible, enu)
    out["n_visible"] = visible.sum(axis=1)
    return out


# ---- a whole run -------------------------------------------------------------------

class MonteCarlo:
    def __init__(self, n, seed=None, pdop_max=6.0, mask_deg=0.0, elements=None, window_s=DEFAULT_WINDOW_S):
        if elements is None:
            elements = presets.gps()
        elements = np.asarray(elements, dtype=float).reshape(-1, 6)
        if len(elements) == 0:
            raise ValueError("there are no satellites to simulate")
        if seed is None:
            seed = int(np.random.SeedSequence().entropy % 2**32)
        self.elements, self.seed, self.n = elements, int(seed), int(n)
        self.pdop_max, self.mask_deg, self.window_s = float(pdop_max), float(mask_deg), float(window_s)

        rng = np.random.default_rng(self.seed)
        self.lat, self.lon = sample_locations(rng, self.n)
        # Random times are drawn from [0, window). Earth rotation does not matter here:
        # longitude is drawn uniformly and independently of t, so the receiver's inertial
        # longitude (lon + omega*t) is uniform for every t. The window should span many
        # repeats of the satellites' relative geometry (see constellation.approx_common_period).
        self.t = sample_times(rng, self.n, self.window_s)

        self.n_visible = np.zeros(self.n, dtype=int)
        self.dop = {k: np.full(self.n, np.nan) for k in KEYS}
        self.done = 0

    def advance(self, k):
        """Compute the next k trials (or fewer if the run ends). Returns the slice done."""
        start = self.done
        stop = min(self.n, start + int(k))
        for lo in range(start, stop, SUB_CHUNK):
            hi = min(stop, lo + SUB_CHUNK)
            out = run_trials(self.elements, self.lat[lo:hi], self.lon[lo:hi], self.t[lo:hi], self.mask_deg)
            self.n_visible[lo:hi] = out["n_visible"]
            for key in KEYS:
                self.dop[key][lo:hi] = out[key]
        self.done = stop
        return slice(start, stop)

    def good(self, upto=None):
        """Boolean array: trial has >= 4 satellites and PDOP <= pdop_max."""
        d = self.done if upto is None else upto
        # NaN PDOP compares False, so undefined geometry is never "good".
        return (self.n_visible[:d] >= 4) & (self.dop["pdop"][:d] <= self.pdop_max)

    def summary(self, dop_type="pdop"):
        """Statistics and histograms over the trials done so far."""
        d = self.done
        if d == 0:
            return {"n_done": 0, "n": self.n, "seed": self.seed}
        nv = self.n_visible[:d]
        x = self.dop[dop_type][:d]
        valid = x[~np.isnan(x)]

        p_good = float(self.good().mean())
        half_width = 1.96 * math.sqrt(p_good * (1 - p_good) / d)        # 95% binomial interval

        out = {
            "n_done": d, "n": self.n, "seed": self.seed,
            "pdop_max": self.pdop_max, "mask_deg": self.mask_deg,
            "window_days": self.window_s / 86400.0, "n_satellites": len(self.elements),
            "nsat": {
                "mean": float(nv.mean()),
                "std": float(nv.std(ddof=1)) if d > 1 else None,
                "se": float(nv.std(ddof=1) / math.sqrt(d)) if d > 1 else None,
                "min": int(nv.min()), "max": int(nv.max()),
                "frac_ge4": float((nv >= 4).mean()),
                "counts": np.bincount(nv, minlength=len(self.elements) + 1).tolist(),
                "expected_mean": expected_mean_visible(self.elements, self.mask_deg),
            },
            "availability": {"p": p_good, "lo": max(0.0, p_good - half_width),
                             "hi": min(1.0, p_good + half_width)},
            "dop": {"type": dop_type, "n_undefined": int(d - len(valid))},
        }
        if len(valid) > 0:
            lo = float(valid.min())
            hi = max(float(np.percentile(valid, 99)) * 1.2, lo + 1e-6)   # clip the long upper tail
            counts, edges = np.histogram(valid, bins=HIST_BINS, range=(lo, hi))
            out["dop"].update({
                "median": float(np.median(valid)),
                "p95": float(np.percentile(valid, 95)),
                "p99": float(np.percentile(valid, 99)),
                "max": float(valid.max()),
                "hist_counts": counts.tolist(), "hist_edges": edges.tolist(),
                "overflow": int((valid > hi).sum()),
            })
        return out


# ---- entry points called from the web worker (JSON in/out) -------------------------

_run = None


def _nan_to_none(arr):
    return [None if math.isnan(v) else v for v in arr.tolist()]


def mc_start(n, seed, pdop_max, mask_deg=0.0, elements_json=None, window_s=DEFAULT_WINDOW_S):
    """Start a new run on the satellites in elements_json (a list of 6-number rows; default GPS).
    seed None (or negative, as sent from JavaScript) means a random seed."""
    global _run
    n = max(1, min(int(n), MAX_TRIALS))
    use_seed = None if seed is None or seed < 0 else int(seed)
    elements = None if elements_json is None else json.loads(elements_json)
    _run = MonteCarlo(n, seed=use_seed, pdop_max=pdop_max, mask_deg=mask_deg, elements=elements, window_s=window_s)
    return json.dumps({"n": _run.n, "seed": _run.seed, "window_days": _run.window_s / 86400.0})


def mc_advance(k, want_points=False):
    """Do the next k trials. With want_points, also return where they were and their PDOP."""
    s = _run.advance(k)
    out = {"done": _run.done, "n": _run.n}
    if want_points:
        out["points"] = {
            "lat": _run.lat[s].tolist(), "lon": _run.lon[s].tolist(),
            "pdop": _nan_to_none(_run.dop["pdop"][s]),
            "n_visible": _run.n_visible[s].tolist(),
        }
    return json.dumps(out)


def mc_summary(dop_type="pdop"):
    return json.dumps(_run.summary(dop_type))
