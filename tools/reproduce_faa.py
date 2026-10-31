"""Reproduce Table 2-1 of the FAA GPS SPS Performance Analysis Report #26 (1999).

For each GPS week 1003-1016: run the FAA's coverage method (web/sim/faa.py) on the real almanac
(satellites flagged healthy), and once on our ideal Walker 24/6/1 for comparison. Where the published
numbers differ, the "explanations" rerun the week with a different satellite set and show which one
reproduces the published row (the FAA's satellite set is not given in the report, so these are tests of
a hypothesis, labelled as such).

Writes web/data/faa_reproduction.json (the numbers the Compare tab shows, and the PDOP maps).
Takes about 7 minutes. Run from the project root:   python tools/reproduce_faa.py
"""

import json
import math
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "web"))
from sim import almanac, constellation, faa, geometry, presets  # noqa: E402

OUTPUT = ROOT / "web" / "data" / "faa_reproduction.json"
PUBLISHED = json.loads((ROOT / "web" / "data" / "published.json").read_text())["faa_pan26"]["table_2_1"]["rows"]
WEEKS = range(1003, 1017)

# Satellite sets that were tried because the healthy-only result did not match the published row.
EXPLANATIONS = {
    1012: {"label": "keep PRN 15 (flagged unhealthy in this almanac)", "exclude": []},
    1014: {"label": "drop only PRN 15 (keep PRN 16)", "exclude": [15]},
    1016: {"label": "drop only PRN 15 (keep PRN 9)", "exclude": [15]},
    1007: {"label": "no single missing satellite found that reproduces this row (best tried: without PRN 15)", "exclude": [15]},
}


def clean(x):
    """inf/NaN are not valid JSON."""
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, list):
        return [clean(v) for v in x]
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    return x


def run_almanac(sats):
    toa = sats[0]["toa"]
    cov = faa.Coverage(lambda tt: almanac.ecef_positions(sats, tt), toa + 60.0 * np.arange(faa.MINUTES))
    cov.advance(faa.MINUTES)
    return cov.results()


def round_map(values):
    return [None if not math.isfinite(v) else round(v, 2) for v in values]


def main():
    start = time.time()
    out = {"grid": {"lats": faa.GRID_LATS.tolist(), "lons": faa.GRID_LONS.tolist()},
           "method": "24 h from each almanac's reference time, every minute; 5 deg mask; good = 4+ satellites and PDOP <= 6",
           "weeks": []}

    el = presets.gps()                                  # the ideal model does not change from week to week
    cov = faa.Coverage(lambda tt: geometry.inertial_to_earth_fixed(constellation.positions(el, tt), tt), 60.0 * np.arange(faa.MINUTES))
    cov.advance(faa.MINUTES)
    ideal = cov.results()
    ideal_map = round_map(ideal.pop("point_9999_pdop"))
    out["ideal"] = clean({**ideal, "map_9999_pdop": ideal_map, "satellites": 24})
    print(f"ideal Walker 24/6/1: {ideal['global_999_pdop']:.2f}  {ideal['global_average_pct']:.3f}%  {ideal['worst_point_pct']:.3f}%", flush=True)

    for row in PUBLISHED:
        week = row[0]
        sats = almanac.load_week(week)
        all_sats = almanac.load_week(week, healthy_only=False)
        r = run_almanac(sats)
        week_map = round_map(r.pop("point_9999_pdop"))
        entry = {"week": week, "toa_utc": almanac.toa_datetime_utc(sats).isoformat(),
                 "published": dict(zip(["global_999_pdop", "global_average_pct", "worst_point_pct"], row[1:])),
                 "real": {**r, "satellites": len(sats), "unhealthy_prns": [s["prn"] for s in all_sats if s["health"] != 0]},
                 "map_9999_pdop": week_map}
        if week in EXPLANATIONS:
            e = EXPLANATIONS[week]
            alt = run_almanac([s for s in all_sats if s["prn"] not in e["exclude"]])
            alt.pop("point_9999_pdop")
            entry["explanation"] = {**e, "result": alt}
        out["weeks"].append(clean(entry))
        print(f"{week}: published {row[1]:.2f} {row[2]:.3f} {row[3]:.3f} | ours {r['global_999_pdop']:.2f} "
              f"{r['global_average_pct']:.3f} {r['worst_point_pct']:.3f}  ({time.time() - start:.0f} s)", flush=True)

    OUTPUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
