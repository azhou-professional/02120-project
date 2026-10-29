"""First draft: GPS coverage and dilution of precision (DOP) by Monte Carlo.

Non-rotating spherical Earth, nominal 24-satellite constellation (6 planes x 4).
Random surface points + random times -> how many satellites are visible above an
elevation mask, and how good is the geometry (DOP)?
Run: python main.py   (saves coverage.png, prints checks)
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

GM, R_E = 3.986004418e14, 6371e3        # m^3/s^2, m
A = 26560e3                              # GPS orbit radius (m)
N_PLANES, PER_PLANE, INC = 6, 4, np.radians(55)
N_SAT = N_PLANES * PER_PLANE
PERIOD = 2 * np.pi * np.sqrt(A**3 / GM)  # ~11.97 h
MASK = np.radians(5)                     # elevation mask (mountains / buildings)
rng = np.random.default_rng(0)

def sat_positions(t):
    """Circular orbits. t has shape (n,) -> positions (n, N_SAT, 3), Earth-centred."""
    idx = np.arange(N_SAT)
    plane, slot = idx // PER_PLANE, idx % PER_PLANE
    raan = 2 * np.pi * plane / N_PLANES                        # plane orientation
    u0 = 2 * np.pi * slot / PER_PLANE + plane * 2 * np.pi / N_SAT  # phase in orbit (staggered)
    u = 2 * np.pi * t[:, None] / PERIOD + u0                   # argument of latitude
    x, y = A * np.cos(u), A * np.sin(u)                        # in-plane coordinates
    px, py, pz = x, y * np.cos(INC), y * np.sin(INC)           # tilt by inclination
    cr, sr = np.cos(raan), np.sin(raan)                        # rotate about z by RAAN
    return np.stack([cr * px - sr * py, sr * px + cr * py, pz], axis=-1)

def random_points(n):
    """n points uniform on the sphere of radius R_E (normalised Gaussians)."""
    v = rng.normal(size=(n, 3))
    return R_E * v / np.linalg.norm(v, axis=1, keepdims=True)

def visibility(rx, sats):
    """Unit line-of-sight vectors (n, N_SAT, 3) and boolean mask of sats above MASK."""
    d = sats - rx[:, None, :]
    u = d / np.linalg.norm(d, axis=-1, keepdims=True)
    up = rx / R_E                                              # local vertical
    sin_el = np.einsum("nsk,nk->ns", u, up)
    return u, sin_el > np.sin(MASK)

def dops(u, vis):
    """DOP from visible sats. Row of G is [-u, 1] (x, y, z, clock). Q = (G^T G)^-1.
    GDOP = sqrt(tr Q), PDOP = sqrt(Qxx+Qyy+Qzz). Returns NaN if < 4 sats or singular."""
    G = np.concatenate([-u, np.ones(u.shape[:-1] + (1,))], axis=-1)   # (n, S, 4)
    GtG = np.einsum("nsi,ns,nsj->nij", G, vis.astype(float), G)       # sum over visible only
    ok = (vis.sum(axis=1) >= 4) & (np.abs(np.linalg.det(GtG)) > 1e-9)
    Q = np.full_like(GtG, np.nan)
    Q[ok] = np.linalg.inv(GtG[ok])
    pdop = np.sqrt(Q[:, 0, 0] + Q[:, 1, 1] + Q[:, 2, 2])
    gdop = np.sqrt(pdop**2 + Q[:, 3, 3])
    return pdop, gdop

def one_sat_fraction():
    """Analytic: Earth central angle seen by a satellite at radius A with mask e is
    lam = arccos(R cos e / A) - e; the visible cap covers (1 - cos lam) / 2 of the sphere."""
    lam = np.arccos(R_E * np.cos(MASK) / A) - MASK
    return (1 - np.cos(lam)) / 2

def check_dop_by_hand():
    """Hand case: one sat at zenith + three on the horizon, 120 deg apart in azimuth.
    G^T G is block-diagonal, so by hand PDOP = sqrt(8/3) = 1.633, GDOP = sqrt(3) = 1.732."""
    u = np.array([[[0, 0, 1], [1, 0, 0], [-.5, np.sqrt(3) / 2, 0], [-.5, -np.sqrt(3) / 2, 0]]])
    p, g = dops(u, np.ones((1, 4), bool))
    print(f"[check] hand DOP case: PDOP {p[0]:.4f} (exact {np.sqrt(8/3):.4f}), "
          f"GDOP {g[0]:.4f} (exact {np.sqrt(3):.4f})")
    assert np.isclose(p[0], np.sqrt(8 / 3)) and np.isclose(g[0], np.sqrt(3))

if __name__ == "__main__":
    check_dop_by_hand()
    n = 20000
    rx = random_points(n)
    t = rng.uniform(0, PERIOD, n)
    u, vis = visibility(rx, sat_positions(t))
    nvis = vis.sum(axis=1)
    pdop, gdop = dops(u, vis)

    # Check 1: one satellite's simulated coverage vs the analytic cap fraction.
    sim, exact = vis[:, 0].mean(), one_sat_fraction()
    se = np.sqrt(exact * (1 - exact) / n)
    print(f"[check] 1 sat coverage: MC {sim:.4f} vs analytic {exact:.4f} (std err {se:.4f})")
    assert abs(sim - exact) < 4 * se

    # Check 2: compare to the SPS Performance Standard style numbers.
    good = pdop <= 6
    print(f"[result] mean visible = {nvis.mean():.2f}, min = {nvis.min()}, max = {nvis.max()}")
    print(f"[result] P(>=4 visible) = {(nvis >= 4).mean():.4f}")
    print(f"[result] P(PDOP <= 6)   = {good.mean():.4f}   (SPS standard: >= 0.98)")
    print(f"[result] median PDOP = {np.nanmedian(pdop):.2f}, median GDOP = {np.nanmedian(gdop):.2f}")

    # Figure: visible-count histogram, PDOP CDF, mean visible sats vs latitude.
    fig, ax = plt.subplots(1, 3, figsize=(14, 4))
    vals, counts = np.unique(nvis, return_counts=True)
    ax[0].bar(vals, counts / n)
    ax[0].set(xlabel="satellites visible", ylabel="fraction of samples", title="Visible satellites")
    p = np.sort(pdop[~np.isnan(pdop)])
    ax[1].plot(p, np.arange(1, p.size + 1) / n)
    ax[1].axvline(6, ls="--", c="gray")
    ax[1].set(xlim=(0, 10), xlabel="PDOP", ylabel="cumulative fraction", title="PDOP distribution")
    lat = np.degrees(np.arcsin(rx[:, 2] / R_E))
    bins = np.linspace(-90, 90, 19)
    mid = (bins[:-1] + bins[1:]) / 2
    which = np.digitize(lat, bins) - 1
    ax[2].plot(mid, [nvis[which == k].mean() for k in range(18)], "o-")
    ax[2].set(xlabel="latitude (deg)", ylabel="mean visible satellites", title="Coverage vs latitude")
    for a in ax:
        a.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig("coverage.png", dpi=120)
    print("saved coverage.png")
