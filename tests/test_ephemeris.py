"""The Sun and the Moon (web/sim/ephemeris.py) against published values and known events."""

import json

import numpy as np

from sim import api
from sim import ephemeris as E
from sim import geometry as g


def t_of(year, month, day, hour=0.0):
    """Seconds after the epoch (2026-01-01 00:00 UTC) of a UTC date."""
    return (g.julian_date(year, month, day, hour) - g.EPOCH_JD) * 86400.0


def angle_deg(a, b):
    a, b = np.asarray(a) / np.linalg.norm(a), np.asarray(b) / np.linalg.norm(b)
    return np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1)))


# ---- worked examples in Meeus, Astronomical Algorithms ----------------------------------------

def test_sun_meeus_example_25a():
    """1992 October 13.0: apparent RA 198.38083 deg, Dec -7.78507 deg, distance 0.99766 AU."""
    ra, dec = E.sun_radec(2448908.5)
    assert abs(ra - 198.38083) < 1e-4
    assert abs(dec - -7.78507) < 1e-4
    assert abs(E.sun_ecliptic(2448908.5)[1] / E.AU_KM - 0.99766) < 1e-5


def test_moon_meeus_example_47a():
    """1992 April 12.0: longitude 133.162655, latitude -3.229126 deg, distance 368,409.7 km
    (Meeus's full series). The short series should be within its stated accuracy."""
    lon, lat, d = E.moon_ecliptic(2448724.5)
    assert abs(lon - 133.162655) < 0.3
    assert abs(lat - -3.229126) < 0.2
    assert abs(d - 368409.7) / 368409.7 < 0.002


def test_obliquity_meeus_example_22a():
    """1987 April 10.0: mean obliquity 23 deg 26' 27.407" = 23.440946 deg."""
    assert abs(E.obliquity_deg(2446895.5) - 23.440946) < 1e-5


# ---- the Sun over a year ----------------------------------------------------------------------

def test_sun_declination_at_solstices_and_equinoxes():
    dec = lambda t: np.degrees(np.arcsin(E.sun_direction(t)[2]))
    assert abs(dec(t_of(2026, 6, 21, 8.4)) - 23.44) < 0.01      # June solstice 2026, 08:24 UTC
    assert abs(dec(t_of(2026, 12, 21, 20.8)) + 23.44) < 0.01    # December solstice 2026, 20:50 UTC
    assert abs(dec(t_of(2026, 3, 20, 14.75))) < 0.01            # March equinox 2026, 14:46 UTC
    assert abs(dec(t_of(2026, 9, 23, 0.1))) < 0.01              # September equinox 2026, 00:05 UTC


def test_sun_direction_is_a_unit_vector_and_noon_is_overhead_near_greenwich():
    u = E.sun_direction(t_of(2026, 3, 20, 12.0))
    assert abs(np.linalg.norm(u) - 1) < 1e-12
    # at 12:00 UTC on the equinox the Sun is overhead near longitude 0 (within the equation of time, ~2 deg)
    _, lon = g.lat_lon(u * 1e8, t_of(2026, 3, 20, 12.0))
    assert abs(lon) < 3


# ---- the Moon over a year ---------------------------------------------------------------------

def test_moon_distance_stays_between_perigee_and_apogee():
    r = np.linalg.norm([E.moon_position(t) for t in np.arange(0, 365 * 86400, 3 * 3600.0)], axis=1)
    assert r.min() > 356000 and r.max() < 407000
    assert abs(r.mean() - 384400) < 1500


def test_moon_returns_to_the_same_stars_after_a_sidereal_month():
    """Sidereal month 27.3217 days: the Moon's direction repeats to about a degree."""
    t0 = t_of(2026, 5, 1)
    assert angle_deg(E.moon_position(t0), E.moon_position(t0 + 27.3217 * 86400)) < 1.5
    assert angle_deg(E.moon_position(t0), E.moon_position(t0 + 13.66 * 86400)) > 150   # half way round


def test_eclipses():
    """Total solar eclipse 2024-04-08 (greatest 18:17 UTC): Sun and Moon line up as seen from the
    Earth's centre (to within the Moon's parallax, about 1 deg). Total lunar eclipse 2025-03-14
    (greatest 06:59 UTC): the Moon is opposite the Sun."""
    t = t_of(2024, 4, 8, 18 + 17 / 60)
    assert angle_deg(E.sun_direction(t), E.moon_position(t)) < 1.0
    t = t_of(2025, 3, 14, 6 + 59 / 60)
    assert 180 - angle_deg(E.sun_direction(t), E.moon_position(t)) < 1.0


def test_ecliptic_pole_is_tilted_by_the_obliquity():
    p = E.ecliptic_pole(0.0)
    assert abs(angle_deg(p, [0, 0, 1]) - E.obliquity_deg(g.EPOCH_JD)) < 1e-9
    assert abs(np.dot(p, E.sun_direction(t_of(2026, 7, 1)))) < 1e-4    # the Sun is on the ecliptic


def test_snapshot_includes_sun_and_moon():
    s = json.loads(api.snapshot(40.44, -79.94, 1000.0))
    assert np.allclose(s["sun_dir"], E.sun_direction(1000.0))
    assert np.allclose(s["moon"], E.moon_position(1000.0))
    assert np.allclose(s["moon_pole"], E.ecliptic_pole(1000.0))
