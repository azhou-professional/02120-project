"""The Learning panel (web/index.html, <div id="learn">): its worked-example numbers must agree with the code.

Every number on the page marked data-check="key" is read from the HTML and compared with the value the
Python code computes for that key. "Agree" means the page shows the computed value correctly rounded to
the number of decimals printed (so 1.5811 must be within 0.00005 of the code's value). The test also
fails if a key is on the page but not computed here, or computed here but missing from the page.
"""

import re
from pathlib import Path

import numpy as np

from sim import constellation as c, geometry as g, montecarlo as mc, presets
from sim.dop import dop

PAGE = Path(__file__).resolve().parent.parent / "web" / "index.html"


def page_values():
    """{key: shown text} for every data-check element in the Learning panel."""
    html = PAGE.read_text()
    learn = html[html.index('<div id="learn"'):]
    return dict(re.findall(r'data-check="([\w]+)">([^<]+)<', learn))


def sky(elevations, azimuths):
    """East-North-Up unit vectors for the given elevations and azimuths (degrees)."""
    el, az = np.radians(elevations), np.radians(azimuths)
    return np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], axis=1)


def computed_values():
    """The same quantities, computed with the project's own functions."""
    out = {}

    # A. regular tetrahedron: one satellite at the zenith, three at arcsin(-1/3) = -19.47 deg
    tetra = sky([90, *[np.degrees(np.arcsin(-1 / 3))] * 3], [0, 0, 120, 240])
    d = dop(tetra, np.eye(3))
    for k in ("gdop", "pdop", "hdop", "vdop", "tdop"):
        out[f"tetra_{k}"] = d[k]

    # B. GPS period and analytic coverage at masks 0 and 5 deg
    out["gps_period_s"] = float(c.period(c.A_GPS))
    for mask in (0, 5):
        out[f"gps_lambda{mask}_deg"] = float(np.degrees(mc.cap_half_angle(c.A_GPS, mask)))
        out[f"gps_p{mask}"] = float(mc.single_sat_probability(c.A_GPS, mask))
        out[f"gps_nview{mask}"] = mc.expected_mean_visible(presets.gps(), mask)

    # C. Langley: zenith + three at 15 deg elevation, with and without the clock unknown
    fifteen = sky([90, 15, 15, 15], [0, 0, 120, 240])
    d = dop(fifteen, np.eye(3))
    for k in ("gdop", "pdop", "hdop", "vdop", "tdop"):
        out[f"langley_{k}"] = d[k]
    known = dop(fifteen, np.eye(3), estimate_clock=False)
    out["langley_hdop_known"] = known["hdop"]
    out["langley_vdop_known"] = known["vdop"]

    # D. Kepler's equation, e = 0.5, M = 60 deg: the Newton iterates (same start and step as
    # constellation.solve_kepler), then the converged answer from solve_kepler itself
    e, M = 0.5, np.radians(60.0)
    E = M + 0.85 * e
    for k in range(5):
        out[f"kepler_E{k}"] = E
        E = E - (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
    E = float(c.solve_kepler(M, e))
    out["kepler_E_rad"] = E
    out["kepler_E_deg"] = np.degrees(E)
    out["kepler_r_over_a"] = 1 - e * np.cos(E)
    out["kepler_nu_deg"] = np.degrees(2 * np.arctan(np.sqrt((1 + e) / (1 - e)) * np.tan(E / 2)))
    return out


def test_every_checked_number_on_the_page_has_a_computed_value_and_vice_versa():
    assert set(page_values()) == set(computed_values())


def test_page_numbers_are_the_code_values_correctly_rounded():
    computed = computed_values()
    for key, text in page_values().items():
        text = text.replace(",", "")
        decimals = len(text.split(".")[1]) if "." in text else 0
        assert abs(float(text) - computed[key]) <= 0.5 * 10 ** -decimals + 1e-12, (key, text, computed[key])


def test_hand_derivations_in_the_text():
    """Closed forms quoted on the page: tetrahedron DOPs, the cos(lambda) = R/a shortcut, Langley's 2x2 inverse."""
    assert np.isclose(computed_values()["tetra_gdop"], np.sqrt(10) / 2)
    assert np.isclose(np.cos(mc.cap_half_angle(c.A_GPS, 0)), g.R_EARTH / c.A_GPS)
    s = np.sin(np.radians(15))
    p, q, r = 1 + 3 * s**2, -(1 + 3 * s), 4.0
    assert np.isclose(np.sqrt(r / (p * r - q**2)), computed_values()["langley_vdop"])


def test_newton_converges_in_four_steps_as_the_page_says():
    """solve_kepler stops when a step is below 1e-13; for this example that is the 4th step."""
    e, M = 0.5, np.radians(60.0)
    E, steps = M + 0.85 * e, 0
    while True:
        dE = (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
        E, steps = E - dE, steps + 1
        if abs(dE) < 1e-13:
            break
    assert steps == 4
