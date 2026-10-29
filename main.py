"""First draft: GNSS clock drift and positioning error, relativistic vs Newtonian.
Run: python main.py   (saves drift.png and error.png)"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

C, GM, R_E = 299792458.0, 3.986004418e14, 6371e3   # m/s, m^3/s^2, m
A = 26560e3                                          # GPS-like orbit radius (m)
N_PLANES, PER_PLANE, INC = 6, 4, np.radians(55)
OMEGA = np.sqrt(GM / A**3)                           # orbital angular rate

# Config: planet is non-rotating, receiver sits at a fixed point on the surface.
CONFIG = dict(relativity=True, compensate=False)
RX = R_E * np.array([np.cos(np.radians(40)), 0, np.sin(np.radians(40))])

def sat_positions(t):
    """Newtonian circular orbits at time t (scalar or per-satellite array) -> (n_sat, 3)."""
    n = N_PLANES * PER_PLANE
    idx = np.arange(n)
    raan = 2 * np.pi * (idx // PER_PLANE) / N_PLANES
    u = OMEGA * t + 2 * np.pi * (idx % PER_PLANE) / PER_PLANE + (idx // PER_PLANE) * 0.3
    x, y = A * np.cos(u), A * np.sin(u)
    px, py, pz = x, y * np.cos(INC), y * np.sin(INC)
    cr, sr = np.cos(raan), np.sin(raan)
    return np.stack([cr * px - sr * py, sr * px + cr * py, pz], axis=1)

# Fractional clock-rate offset of satellite clock vs ground clock (weak-field GR + SR):
#   d(tau)/dt = 1 - GM/(r c^2) - v^2/(2c^2),   v^2 = GM/A for a circular orbit
RATE_SAT = -GM / (A * C**2) - GM / (2 * A * C**2)
RATE_GROUND = -GM / (R_E * C**2)
REL_OFFSET = RATE_SAT - RATE_GROUND                  # ~ +4.46e-10 (~38.5 us/day)

def clock_error(t, relativity, compensate):
    """Satellite clock reading minus ground-clock time (s)."""
    if not relativity:
        return np.zeros_like(t)                      # Newtonian: all clocks tick alike
    rate = REL_OFFSET - (REL_OFFSET if compensate else 0.0)  # factory offset removes it
    return rate * t

def solve_position(t_rx, relativity, compensate, guess):
    """Pseudorange fix with a known receiver clock: Gauss-Newton on 3 unknowns."""
    # Signal emission time (true), found by iterating the light travel time.
    tau = 0.07
    for _ in range(5):
        sats = sat_positions(t_rx - tau)
        tau = np.linalg.norm(sats - RX, axis=1) / C
    t_tx = t_rx - tau
    # visible satellites: above the local horizon
    vis = ((sats - RX) @ RX) / (np.linalg.norm(sats - RX, axis=1) * R_E) > np.sin(np.radians(5))
    # measured pseudorange uses the (possibly drifted) satellite clock stamp
    stamp = t_tx + clock_error(t_tx, relativity, compensate)
    rho = C * (t_rx - stamp)
    x = guess.copy()
    for _ in range(10):
        d = np.linalg.norm(sats[vis] - x, axis=1)
        Jm = (x - sats[vis]) / d[:, None]
        dx = np.linalg.lstsq(Jm, rho[vis] - d, rcond=None)[0]
        x = x + dx
    return x, vis.sum()

if __name__ == "__main__":
    days = 2
    t = np.arange(0, days * 86400, 600.0)            # one fix every 10 minutes
    cases = {"Newtonian": (False, False),
             "Relativistic, uncompensated": (True, False),
             "Relativistic, compensated": (True, True)}

    plt.figure(figsize=(7, 4))
    for name, (rel, comp) in cases.items():
        plt.plot(t / 86400, clock_error(t, rel, comp) * 1e6, label=name)
    plt.xlabel("time (days)"); plt.ylabel("satellite clock error (µs)")
    plt.title("Clock drift vs ground time"); plt.legend(); plt.tight_layout()
    plt.savefig("drift.png", dpi=120)

    plt.figure(figsize=(7, 4))
    for name, (rel, comp) in cases.items():
        err = []
        for ti in t:
            x, _ = solve_position(ti, rel, comp, RX + 1e3)
            err.append(np.linalg.norm(x - RX))
        print(f"{name:30s} final error = {err[-1]:.3f} m")
        plt.semilogy(t / 86400, np.maximum(err, 1e-6), label=name)
    plt.xlabel("time (days)"); plt.ylabel("position error (m)")
    plt.title("Positioning error"); plt.legend(); plt.tight_layout()
    plt.savefig("error.png", dpi=120)

    print(f"Relativistic rate offset: {REL_OFFSET * 86400e6:.2f} µs/day "
          f"(Ashby 2003: ~38.4 µs/day with Earth rotation)")
    print(f"Uncompensated range drift: {REL_OFFSET * C * 86400 / 1e3:.2f} km/day")
