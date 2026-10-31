"""Where the Sun and the Moon are, for drawing them (they do not affect any DOP or coverage result).

Both are computed in the same inertial frame as the satellites (+x toward the vernal equinox,
+z through the north pole; see geometry.py), from the Julian Date.

Sun : Meeus, Astronomical Algorithms (2nd ed.), ch. 25, "low accuracy" method: about 0.01 deg.
Moon: the Astronomical Almanac's low-precision formulae (section D, "Low precision formulae for
      the Moon"), a short series of the largest terms: about 0.3 deg in longitude, 0.2 deg in
      latitude and 0.2% in distance, between 1950 and 2050.

Both methods are written for Terrestrial Time; we feed them UTC, which is about 69 s behind
(in that time the Moon moves 0.01 deg, far below the Moon series' own error).
"""

import numpy as np

from . import geometry

AU_KM = 149597870.7          # astronomical unit (km)
R_SUN_KM = 695700.0          # solar radius (IAU nominal value)
R_MOON_KM = 1737.4           # mean lunar radius


def centuries(jd):
    """Julian centuries of 36,525 days since J2000.0 (JD 2451545.0)."""
    return (jd - 2451545.0) / 36525.0


def obliquity_deg(jd):
    """Mean obliquity of the ecliptic (tilt of the Earth's axis), Meeus eq. 22.2."""
    T = centuries(jd)
    return 23.0 + 26.0 / 60.0 + (21.448 - 46.8150 * T - 0.00059 * T**2 + 0.001813 * T**3) / 3600.0


def ecliptic_to_equatorial(lon_deg, lat_deg, eps_deg):
    """Unit vector of ecliptic (longitude, latitude) in equatorial axes (x to the equinox, z north).
    It is a rotation by the obliquity eps about the x axis (the equinox direction is shared)."""
    lam, beta, eps = np.radians(lon_deg), np.radians(lat_deg), np.radians(eps_deg)
    x = np.cos(beta) * np.cos(lam)
    y = np.cos(beta) * np.sin(lam)
    z = np.sin(beta)
    return np.array([x, y * np.cos(eps) - z * np.sin(eps), y * np.sin(eps) + z * np.cos(eps)])


def sun_ecliptic(jd):
    """Apparent ecliptic longitude (deg) and distance (km) of the Sun, Meeus ch. 25.
    (The Sun's ecliptic latitude is under 0.0003 deg and is taken as 0.)"""
    T = centuries(jd)
    L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T**2           # mean longitude
    M = np.radians(357.52911 + 35999.05029 * T - 0.0001537 * T**2)  # mean anomaly
    e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T**2        # eccentricity of the Earth's orbit
    C = ((1.914602 - 0.004817 * T - 0.000014 * T**2) * np.sin(M)    # equation of the centre
         + (0.019993 - 0.000101 * T) * np.sin(2 * M) + 0.000289 * np.sin(3 * M))
    true_lon = L0 + C
    nu = M + np.radians(C)                                         # true anomaly
    R_au = 1.000001018 * (1 - e**2) / (1 + e * np.cos(nu))
    omega = np.radians(125.04 - 1934.136 * T)                      # Moon's node: nutation and aberration
    apparent_lon = true_lon - 0.00569 - 0.00478 * np.sin(omega)
    return apparent_lon % 360.0, R_au * AU_KM


def sun_radec(jd):
    """Apparent right ascension and declination (deg) of the Sun, Meeus ch. 25 (for the tests)."""
    lon, _ = sun_ecliptic(jd)
    omega = np.radians(125.04 - 1934.136 * centuries(jd))
    u = ecliptic_to_equatorial(lon, 0.0, obliquity_deg(jd) + 0.00256 * np.cos(omega))
    return np.degrees(np.arctan2(u[1], u[0])) % 360.0, np.degrees(np.arcsin(u[2]))


def moon_ecliptic(jd):
    """Ecliptic longitude, latitude (deg) and distance (km) of the Moon, Astronomical Almanac
    low-precision series. Each term is amplitude * sin(phase + rate * T), angles in degrees."""
    T = centuries(jd)
    s = lambda a, b: np.sin(np.radians(a + b * T))
    c = lambda a, b: np.cos(np.radians(a + b * T))
    lon = (218.32 + 481267.881 * T
           + 6.29 * s(135.0, 477198.87)       # equation of the centre (eccentric orbit)
           - 1.27 * s(259.3, -413335.36)      # evection (the Sun stretches the orbit)
           + 0.66 * s(235.7, 890534.22)       # variation
           + 0.21 * s(269.9, 954397.74)       # second term of the equation of the centre
           - 0.19 * s(357.5, 35999.05)        # annual equation (the Earth-Sun distance changes)
           - 0.11 * s(186.5, 966404.03))
    lat = (5.13 * s(93.3, 483202.02)          # the orbit is tilted 5.1 deg to the ecliptic
           + 0.28 * s(228.2, 960400.89)
           - 0.28 * s(318.3, 6003.15)
           - 0.17 * s(217.6, -407332.21))
    parallax = (0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36)
                + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74))
    distance = geometry.R_EARTH / np.sin(np.radians(parallax))   # horizontal parallax -> distance
    return lon % 360.0, lat, distance


def jd_of(t):
    """Julian Date at t seconds after the epoch (geometry.EPOCH_JD, 2026-01-01 00:00 UTC)."""
    return geometry.EPOCH_JD + np.asarray(t, dtype=float) / 86400.0


def sun_direction(t):
    """Unit vector from the Earth's centre to the Sun at t seconds after the epoch."""
    jd = jd_of(t)
    lon, _ = sun_ecliptic(jd)
    return ecliptic_to_equatorial(lon, 0.0, obliquity_deg(jd))


def moon_position(t):
    """Position of the Moon's centre (km) at t seconds after the epoch."""
    jd = jd_of(t)
    lon, lat, distance = moon_ecliptic(jd)
    return distance * ecliptic_to_equatorial(lon, lat, obliquity_deg(jd))


def ecliptic_pole(t):
    """Unit vector of the ecliptic's north pole. The Moon's spin axis is within 1.5 deg of it,
    so it is used as the Moon's 'up' when drawing it."""
    return ecliptic_to_equatorial(0.0, 90.0, obliquity_deg(jd_of(t)))
