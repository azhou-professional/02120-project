"""Ready-made constellations (idealized nominal designs; sources are listed in papers.txt).

Every preset is circular and healthy. The orientation of the planes at t = 0 (RAAN of the
first plane) is arbitrary: it is not matched to a real date, because the Earth's own angle
at t = 0 is arbitrary too.
"""

import numpy as np

from . import constellation as c

# Galileo (GSC "Reference Constellation Orbital and Technical Parameters"): Walker 24/3/1,
# semi-major axis 29,599.8 km, inclination 56 deg.
GALILEO_A, GALILEO_INC = 29599.8, 56.0

# BeiDou-3 (CSNO Signal-in-Space ICD): MEO semi-major axis 27,906.1 km, inclination 55 deg
# (altitude about 21,528 km), Walker 24/3/1; IGSO inclination 55 deg; GEO inclination 0 and
# longitudes 80, 110.5, 140 deg E.
BDS_MEO_A, BDS_MEO_INC = 27906.1, 55.0
BDS_IGSO_INC = 55.0
BDS_IGSO_CROSSING_LON = 118.0          # the three IGSO ground tracks cross at 118 deg E (Navipedia)
BDS_GEO_LONS = (80.0, 110.5, 140.0)


def gps():
    """GPS: Walker 24/6/1, 26,559.7 km, 55 deg."""
    return c.walker(24, 6, 1, a=c.A_GPS, inc_deg=c.INC_GPS)


def galileo():
    """Galileo: Walker 24/3/1, 29,599.8 km, 56 deg (8 satellites in each of 3 planes)."""
    return c.walker(24, 3, 1, a=GALILEO_A, inc_deg=GALILEO_INC)


def beidou_meo():
    """BeiDou-3 MEO: Walker 24/3/1, 27,906.1 km, 55 deg."""
    return c.walker(24, 3, 1, a=BDS_MEO_A, inc_deg=BDS_MEO_INC)


def beidou_igso_geo():
    """BeiDou-3 IGSO (3) and GEO (3).

    Both use the geostationary radius (period exactly one sidereal day), so the GEO satellites
    stay over their longitudes and the IGSO satellites trace a figure-eight on the ground.
    The three IGSO satellites share one ground track crossing the equator at 118 deg E: plane k
    has RAAN = 118 + 120 k and phase -120 k, which puts satellite k on the same track as
    satellite 0, a third of a day (k * T_sidereal / 3) later. The ICD's nominal IGSO/GEO radius
    is 42,162.2 km (2 km smaller); that would make the GEO satellites drift, so it is not used.
    """
    a = c.geostationary_radius()
    k = np.arange(3)
    igso = c.make_elements(a, 0.0, BDS_IGSO_INC, (BDS_IGSO_CROSSING_LON + 120.0 * k) % 360.0, 0.0, (-120.0 * k) % 360.0)
    geo = np.vstack([c.geostationary(lon) for lon in BDS_GEO_LONS])
    return np.vstack([igso, geo])


# key -> label, short name for lists, satellite names, element builder
PRESETS = {
    "gps": {"label": "GPS", "short": "GPS", "build": gps, "names": lambda: c.names(24, 6)},
    "galileo": {"label": "Galileo", "short": "GAL", "build": galileo, "names": lambda: c.names(24, 3)},
    "beidou_meo": {"label": "BeiDou MEO", "short": "BDS-M", "build": beidou_meo, "names": lambda: c.names(24, 3)},
    "beidou_igso_geo": {"label": "BeiDou IGSO + GEO", "short": "BDS-I/G", "build": beidou_igso_geo,
                        "names": lambda: ["I1", "I2", "I3", "G1", "G2", "G3"]},
}
