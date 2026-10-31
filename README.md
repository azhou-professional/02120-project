# GPS coverage and dilution of precision (DOP) simulator

A web simulation that answers: **how many GPS satellites can a user on the surface of the Earth
see, and how good is the positioning?** Position quality depends on the geometry of the visible
satellites and is measured with dilution of precision (DOP). The app shows the satellites on a 3D
globe, a sky plot for a chosen receiver, and runs a Monte Carlo over random places and times to
estimate coverage and DOP statistics. Course project for CMU 02-120 (Programming for Scientists).
The proposal is in `proposal.md`; the papers it builds on are listed in `papers.txt`.

## Run it locally

```bash
./launch.sh          # runs tools/serve.py: serves web/ at http://localhost:3000
```

Then open http://localhost:3000. Use a web server, not a double-click on `index.html`: the page
fetches the Python files over HTTP. An internet connection is needed because Pyodide (v0.26.4,
Python + numpy in the browser) and Three.js (v0.160.0) are loaded from the jsDelivr CDN.

`tools/serve.py` is Python's standard web server plus a `Cache-Control: no-store` header. Without
it, browsers keep old copies of JavaScript files, so a code change can look like it did not work.
(If you use `python3 -m http.server` instead, hard-reload with Ctrl+Shift+R after changes.)

## Run the tests

```bash
. .venv/bin/activate     # a virtual environment with numpy and pytest
python -m pytest
```

## How it works

All science is in Python (numpy), running in the browser through Pyodide. JavaScript only draws and
handles the controls.

| Part | Files |
|---|---|
| Orbits, Kepler's equation, satellite positions, repeat period | `web/sim/constellation.py` |
| Ready-made constellations (GPS, Galileo, BeiDou) | `web/sim/presets.py` |
| Earth, receiver position and rotation, elevation/azimuth | `web/sim/geometry.py` |
| DOP calculation (one receiver, and a vectorized batch) | `web/sim/dop.py` |
| Monte Carlo (sampling, statistics, analytic check) | `web/sim/montecarlo.py` |
| Entry points called by the page | `web/sim/api.py` |
| Page, globe, sky plot, charts | `web/index.html`, `main.js`, `globe.js`, `skyplot.js`, `histogram.js`, `mc.js` |
| Constellation tab: the satellite list, colours, the "Add satellites" dialog and its orbit preview | `web/constellation.js` (the numbers and validation come from `web/sim/api.py`) |
| Low-poly satellite models (GPS III, Galileo, BeiDou-3, generic) and the dialog's card pictures | `web/satmodels.js`, `web/thumbs.js` |
| Monte Carlo runs in a Web Worker with its own Pyodide | `web/mc-worker.js`, `web/pyloader.js` |
| Low-poly Earth: mesh and land colouring | `web/earth.js` |
| Land/ocean grid made from the Natural Earth outlines | `tools/landmask.py` (reads `data/ne_110m_land.geojson`, writes `web/data/land_mask.json`) |
| Local web server (no caching) | `tools/serve.py`, started by `launch.sh` |
| Tests | `tests/` |

`main.py` at the top level is an early first draft (it uses Earth radius 6371 km and a nonrotating
Earth). The web app does not use it.

The satellite models are drawn far larger than life (at true size they would be invisible). Their bodies point at the
Earth and their solar wings lie along the orbit normal; this is only for the picture and does not affect any result.

## Assumptions

These are the modelling assumptions the results depend on. **This section is kept up to date:
whenever an assumption changes, the table is edited and the change is added to the log below.**

| # | Assumption | Value / detail | Where |
|---|---|---|---|
| A1 | **Earth shape**: a perfect sphere | radius 6378.137 km (the WGS-84 equatorial radius) | `geometry.R_EARTH` |
| A2 | **Earth rotation and time**: rigid, constant rate; t is real time | one turn per sidereal day, 86,164.0905 s. t = 0 is **2026-01-01 00:00:00 UTC**, and the angle between Greenwich and the inertial +x axis (the vernal equinox) is the Greenwich Mean Sidereal Time of the date (Meeus, *Astronomical Algorithms*, eq. 12.4; checked against his worked examples). No precession, nutation or polar motion, and UTC is used as UT1 (they differ by under a second). The satellites are still idealized: the date sets where the Earth is turned, not where real satellites were | `geometry.T_SIDEREAL`, `gmst_deg`, `earth_angle_deg` |
| A3 | **Orbits**: two-body Kepler motion on circular or elliptical orbits | mu = 398,600.4418 km^3/s^2; Kepler's equation solved by Newton's method. No perturbations (Earth's oblateness, drag, Sun and Moon, radiation pressure) and no manoeuvres. All the constellation presets are circular | `constellation.positions`, `solve_kepler` |
| A4 | **GPS constellation**: an idealized Walker 24/6/1, always fully healthy | radius 26,559.7 km, inclination 55 deg, 6 planes 60 deg apart in RAAN, 4 satellites per plane 90 deg apart, 15 deg phase offset between neighbouring planes. These are not the real slot assignments | `presets.gps`, `constellation.walker` |
| A14 | **Other constellations**: idealized nominal designs, only the operational satellites (spares ignored), always healthy, circular | **Galileo** Walker 24/3/1, 29,599.8 km, 56 deg (GSC reference constellation). **BeiDou MEO** Walker 24/3/1, 27,906.1 km, 55 deg (CSNO ICD). **BeiDou IGSO** 3 satellites at 55 deg and **GEO** 3 satellites at 80, 110.5, 140 deg E; both use the geostationary radius 42,164.17 km (period exactly one sidereal day), not the ICD's 42,162.2 km, which is 2 km smaller and would make the GEO satellites drift. The IGSO satellites share one ground track crossing the equator at 118 deg E (the planned final design; later launches are reported at 120 deg E) and follow each other by a third of a sidereal day. The first plane's RAAN is 0 at t = 0 (arbitrary, like the Earth's angle at t = 0) | `presets.py` |
| A15 | **Orbits that are allowed** | eccentricity 0 to 0.9, inclination 0 to 180 deg, perigee altitude at least 160 km (a lower perigee would decay quickly under drag, which is not modelled), apogee radius at most 500,000 km (beyond the Moon's orbit two-body motion stops being meaningful), at most 300 satellites in total (a Walker set at most 120) | `constellation.validate_orbit`, `api.py` |
| A16 | **Switched-off satellites** are failed satellites | a satellite switched off in the Constellation tab (or by clicking it on the globe) is drawn as a faint ghost and is left out of visibility, DOP and the Monte Carlo. Failures are chosen by hand; there is no random failure model | `api.snapshot`, `web/constellation.js` |
| A17 | **Repeat period of a constellation**: two periods are "commensurate" if both are within 0.03 orbits of a whole number after the common time | the shortest such time, searched up to 10 years, is the approximate least common multiple. For the four nominal systems it is 70 sidereal days (69.81 days; worst phase mismatch 5.9 deg). In the Monte Carlo tab, a checkbox sets the time window to this value (and keeps it up to date as satellites are added or switched off); the tab also shows how many repeat cycles the current window covers. If no common period exists within 10 years (for example with many unrelated orbits), it says so and keeps the typed window | `constellation.approx_common_period` |
| A18 | **Terrain: a cone-shaped valley** around the receiver (Stage 4) | the walls rise to the same angle in every direction (0-80 deg), so the terrain acts exactly like an elevation mask of that angle; the Monte Carlo uses the same valley at every trial. Satellites behind the walls are fully hidden: no diffraction, no partial blocking, no reflections (multipath). Other shapes (a straight valley, a city street) would make the angle depend on direction; the code has a hook for that (`geometry.blocking_angle`) | `geometry.blocking_angle`, `api.set_terrain`, Terrain tab |
| A5 | **Receiver**: on the sphere's surface, fixed to the ground | height 0; no antenna, multipath or motion | `geometry.receiver_position` |
| A6 | **Visibility**: a satellite is usable if it is switched on and its elevation is at or above the terrain's blocking angle | elevation measured from the local horizontal plane of the sphere. With the Terrain tab's valley off, the blocking angle is 0 deg (the geometric horizon); with it on, it is the valley's wall angle (A18). No refraction or signal-strength limits | `api.snapshot`, `geometry.blocking_angle`, `geometry.look_angles` |
| A7 | **Only geometry is modelled** | DOP is computed from satellite directions alone, with all satellites weighted equally (no elevation-dependent weighting, ranging-error model, ionosphere, troposphere or ephemeris/clock errors) | `dop.py` |
| A8 | **One common receiver clock for all constellations** | the unknowns are x, y, z and one clock bias, so any 4 satellites give a fix. Real multi-system receivers either use broadcast offsets between system time scales or solve for one extra clock unknown per added system, which gives somewhat worse DOP and needs more satellites. This assumption is optimistic for mixed constellations, most of all when few satellites are visible. (Only GPS exists so far, so it has no effect yet.) | `dop.py` |
| A9 | **DOP definition** | geometry matrix rows [-ex, -ey, -ez, 1] with e the unit vector to the satellite; Q = (G^T G)^-1; GDOP = sqrt(trace Q); PDOP, TDOP from Q; HDOP, VDOP from the position block rotated to local East-North-Up. Undefined (NaN) with fewer than 4 satellites or if G^T G has condition number above 1e12 | `dop.dop`, `dop.dop_batch` |
| A10 | **"Good positioning"** | at least 4 satellites and PDOP at or below a threshold (default 6, editable), as in the PDOP limit of 6 used for the GPS SPS predicted accuracy (Langley 1999) | `montecarlo.MonteCarlo.good` |
| A11 | **Monte Carlo sampling**: random place and random time, independent | location uniform by area on the sphere (sin(latitude) uniform); time uniform over a window starting at t = 0 (**365 days by default, editable**, or, with a checkbox, the approximate common repeat period of the satellites, see A17). A long window covers many repeats of the satellites' relative geometry: the median PDOP for all four systems is 0.807 for windows of 7, 30, 120 and 365 days and for the common repeat period alike; at most 1,000,000 trials; all random numbers drawn up front from a seeded generator, so results depend only on the seed and the trial count. Earth rotation does not change these statistics, because the receiver's inertial longitude is uniform whatever the time | `montecarlo.py` |
| A12 | **Monte Carlo uncertainty** | availability 95% interval is the binomial normal approximation 1.96 sqrt(p(1-p)/n); the mean number in view is compared with its exact value (A13) | `montecarlo.summary` |
| A13 | **Analytic check** | for a uniformly random location the probability that one satellite at radius a is above elevation mask e is (1 - cos L)/2 with L = arccos(R cos e / a) - e, so the expected number in view is the sum over satellites (9.118 for GPS at mask 0). For an elliptical orbit the radius changes, so the probability is averaged over the orbit (over the mean anomaly, 2,048 points) | `montecarlo.expected_mean_visible` |

## Assumption change log

Newest first. Each entry says what changed and why.

| Date | Change | Why / effect |
|---|---|---|
| 2026-10-31 | **A6 changed, A18 added** (Stage 4): the mask is now set by a cone-shaped valley in the Terrain tab (off by default, so still 0 deg) | Studies how obstacles degrade positioning. For GPS alone (N >= 4 and PDOP <= 6): availability is 100% in the open, 99.6% with 10 deg walls, 87.9% at 20 deg, 34.4% at 30 deg and 1.8% at 40 deg; the median PDOP rises from 1.5 to 11.2. The analytic check A13 still applies, since a cone is an elevation mask. |
| 2026-10-31 | **A2 changed**: t = 0 was an arbitrary moment with longitude 0 along +x; it is now 2026-01-01 00:00:00 UTC, and the Earth's angle is the Greenwich Mean Sidereal Time | Lets the page use a real calendar date (date picker) and prepares for comparisons with real data at real places and times. The Earth's angle at t = 0 is now 100.66 deg instead of 0. The GEO and IGSO presets were shifted by that angle, so they still sit over 80, 110.5, 140 deg E and cross at 118 deg E. Monte Carlo statistics are unchanged (A11). Over a year the model and Meeus's GMST drift apart by 0.00005 deg (the sidereal day is rounded), about 5 m on the equator. |
| 2026-10-31 | **A11 changed**: Monte Carlo times were uniform over one orbital period of the constellation; they are now uniform over a window: 365 days by default and editable, or the approximate common repeat period (a checkbox). **A16 and A17 added** | Several constellations (and elliptical or added satellites) have different periods, so no single period covers them all. A long window covers many relative phasings. For one circular constellation the answers are statistically the same (the expected number in view does not depend on time); a window that is not a whole number of repeat cycles weights part of a cycle slightly more, by a few percent at most. |
| 2026-10-31 | **A3 changed**: orbits were circular only; elliptical orbits are now allowed (**A14, A15 added** for the Galileo and BeiDou presets and the limits on orbits) | Needed for user-defined satellites. The presets are all circular, so the earlier results are unchanged (the general code reproduces the old circular formula exactly, which a test checks). The analytic check A13 now averages over the orbit. |
| 2026-10-31 | **A8 added**: one common receiver clock for multi-constellation positioning | Chosen so the project stays a study of geometry, coverage and DOP. Revisit after the obstacle stage, when few visible satellites make the difference matter; an "estimate inter-system biases" option is a candidate extension. |
| 2026-10-31 | **A2 changed**: Earth was nonrotating (inertial frame = Earth-fixed frame, as in the original proposal); it now rotates at the sidereal rate | Lets geostationary satellites hold a fixed spot over the ground and makes ground tracks realistic. Monte Carlo statistics are unchanged by construction (A11); the Monte Carlo mean in view still matches the analytic value (A13). Changes the live view and any fixed-site time series. |
| 2026-10-30 | **A6 changed**: default elevation mask was 5 deg, now 0 deg | A 5 deg mask was inconsistent while nothing else blocks the sky. The mask is still a parameter. Mean satellites in view rose from about 8.4 to about 9.6 on a coarse test grid, and the uniform-random mean is 9.118. |

## How correctness is checked

The tests (`python -m pytest`) include:

- a DOP case worked out by hand (a regular tetrahedron gives GDOP = sqrt(10)/2, PDOP = 1.5, TDOP = 0.5), mathematical invariants of DOP, and the rule that adding a satellite never increases GDOP;
- orbit checks: constant radius, period, orbital speed, inclination, plane spacing and phasing;
- elliptical orbits: Kepler's equation solved to 1e-12, the general code equals the circular formula at e = 0, perigee and apogee distances, the two-focus property of an ellipse, conservation of energy and angular momentum (from finite differences of the positions), and a Monte Carlo of an elliptical orbit against the numerical orbit average;
- presets: plane spacing and phasing, the orbit periods against the published repeat cycles (GPS 2 revolutions per sidereal day, Galileo 17 in 10, BeiDou MEO 13 in 7), GEO satellites staying over their longitudes, the IGSO ground track;
- the common repeat period function: exact multiples, equal periods, no solution, and 70 sidereal days for the four nominal systems together;
- geometry checks: local East-North-Up frame, azimuth, and the analytic coverage-cap edge;
- Earth rotation: one turn per sidereal day, a geostationary satellite stays over one spot and at the zenith of the point below it, and the GPS sky repeats after a sidereal day;
- Monte Carlo: the vectorized batch agrees with the scalar calculation, area-uniform sampling, seed reproducibility, hand-computed summary statistics, and agreement with the analytic expected number of satellites in view within statistical error.

## Data and sources

Papers, data sources and links are in `papers.txt`. The `paper/` folder (the PDFs) is not tracked by git.

The only data file is the Natural Earth 110 m land outline (`data/ne_110m_land.geojson`, public
domain). It is used **only for the look of the Earth**: `tools/landmask.py` turns it into a
1-degree land/ocean grid (28.9% of the surface area comes out as land, against about 29% in
reality), and `web/earth.js` builds a flat-shaded icosphere of 5,120 triangles (edges about
4 degrees, roughly 480 km) and colours each triangle by whether its centre is land. The colours
(white polar caps, tan belts between 15 and 32 degrees latitude, green elsewhere, small random
shade differences between triangles) are a stylization, not measured data. Nothing in the DOP or
coverage results depends on it. To regenerate the grid: `python tools/landmask.py`.
