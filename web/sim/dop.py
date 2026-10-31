"""Dilution of precision (DOP) from satellite geometry.

A receiver solves for 4 unknowns: position (x, y, z) and clock bias. Linearizing
the range equations gives one row per satellite in the geometry matrix G:
    [-ex, -ey, -ez, 1]
where e is the unit vector from receiver to satellite. Errors in the solution
scale with the covariance-like matrix Q = (G^T G)^-1, and
    GDOP = sqrt(trace Q)
    PDOP = sqrt(Q11 + Q22 + Q33)          (3-D position)
    TDOP = sqrt(Q44)                      (clock)
    HDOP, VDOP: the same position block of Q, rotated to local East-North-Up,
                HDOP = sqrt(Q_EE + Q_NN),  VDOP = sqrt(Q_UU).
"""

import numpy as np

KEYS = ("gdop", "pdop", "hdop", "vdop", "tdop")
MAX_COND = 1e12  # G^T G worse than this is treated as singular (no solution)


def _undefined():
    return {k: float("nan") for k in KEYS}


def dop_batch(unit_los, visible, enu):
    """DOP for many receivers at once (Monte Carlo trials).

    unit_los: (M, N, 3) unit vectors to all N satellites for each of M trials
    visible : (M, N) bool, which satellites count in each trial
    enu     : (M, 3, 3) local East-North-Up matrices
    Returns a dict of (M,) arrays (same keys as dop()), NaN where undefined.

    Same maths as dop(), but with no ragged arrays: the sum over visible
    satellites G^T G = sum_i g_i g_i^T is taken with weight 1 (visible) or 0.
    """
    M = unit_los.shape[0]
    g = np.concatenate([-unit_los, np.ones(unit_los.shape[:-1] + (1,))], axis=-1)   # (M, N, 4)
    GtG = np.einsum("ms,msi,msj->mij", visible.astype(float), g, g)                 # (M, 4, 4)

    ok = visible.sum(axis=1) >= 4
    eye = np.eye(4)
    with np.errstate(divide="ignore", invalid="ignore"):
        cond = np.linalg.cond(np.where(ok[:, None, None], GtG, eye))
    ok &= np.isfinite(cond) & (cond <= MAX_COND)

    Q = np.linalg.inv(np.where(ok[:, None, None], GtG, eye))                        # identity where undefined
    Q_enu = enu @ Q[:, :3, :3] @ np.swapaxes(enu, 1, 2)

    def pick(values):
        return np.where(ok, np.sqrt(values), np.nan)

    return {
        "gdop": pick(np.trace(Q, axis1=1, axis2=2)),
        "pdop": pick(Q[:, 0, 0] + Q[:, 1, 1] + Q[:, 2, 2]),
        "hdop": pick(Q_enu[:, 0, 0] + Q_enu[:, 1, 1]),
        "vdop": pick(Q_enu[:, 2, 2]),
        "tdop": pick(Q[:, 3, 3]),
    }


def dop(unit_los, enu):
    """DOP values from unit line-of-sight vectors (N x 3) and the ENU matrix (3 x 3).

    Returns a dict with gdop, pdop, hdop, vdop, tdop. If fewer than 4 satellites
    are given or the geometry is singular, every value is NaN.
    """
    unit_los = np.asarray(unit_los, dtype=float).reshape(-1, 3)
    if len(unit_los) < 4:
        return _undefined()

    G = np.hstack([-unit_los, np.ones((len(unit_los), 1))])
    GtG = G.T @ G
    if not np.isfinite(np.linalg.cond(GtG)) or np.linalg.cond(GtG) > MAX_COND:
        return _undefined()

    Q = np.linalg.inv(GtG)
    Q_enu = enu @ Q[:3, :3] @ enu.T  # position block expressed in East, North, Up

    return {
        "gdop": float(np.sqrt(np.trace(Q))),
        "pdop": float(np.sqrt(np.trace(Q[:3, :3]))),
        "hdop": float(np.sqrt(Q_enu[0, 0] + Q_enu[1, 1])),
        "vdop": float(np.sqrt(Q_enu[2, 2])),
        "tdop": float(np.sqrt(Q[3, 3])),
    }
