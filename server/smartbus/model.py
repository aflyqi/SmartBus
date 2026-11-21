"""Travel-time model.

Every journey is decomposed into alternating phases

    dwell(stop i)  ->  run(stop i -> stop i+1)  ->  dwell(stop i+1) -> ...

For each phase we estimate a *time-of-day profile* (per 10-minute bucket and day
type) from historical observations:

* Samples are pooled across every route that drives the same stop pair (the road
  does not care about the route number), with the requested route weighted
  higher.
* Weights combine a Gaussian time-of-day kernel (σ = 14 min, circular), day-type
  similarity (weekday / Saturday / Sunday), recency (half-life 21 days) and the
  timing uncertainty of the sample.
* Quantiles (15 / 50 / 85 %) come from a weighted log-spaced histogram, so the
  estimate is robust to outliers (layovers, breakdowns, GPS glitches).
* Sparse buckets are shrunk towards the all-day estimate and, failing that,
  towards a physical prior derived from stop distance.

Live predictions multiply run phases by a *real-time congestion factor* learned
from traversals completed in the last ~45 minutes on the same route (neighbouring
segments count, decaying with distance) and on the same road by other routes.
The factor fades out for phases further in the future, because congestion now
says less about the road in 40 minutes. Uncertainties are propagated along the
chain to produce a range, not just a number.
"""
from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np

from . import clock, db
from .registry import RouteDir

# ── histogram grid ───────────────────────────────────────────────────────
N_TOD = 144  # 10-minute buckets
EDGES = np.concatenate([[0.0], np.geomspace(1.0, 2400.0, 96)])
N_VAL = len(EDGES) - 1
KERNEL_SIGMA_BINS = 1.4  # 14 minutes
KERNEL = np.exp(-0.5 * (np.arange(-6, 7) / KERNEL_SIGMA_BINS) ** 2)

HISTORY_DAYS = 60
HALF_LIFE_DAYS = 21.0
OTHER_ROUTE_W = 0.6
SHRINK_K = 4.0
PROFILE_TTL = 900  # seconds

DT_SIM = np.array(clock.DT_SIM)


@dataclass
class Est:
    med: float
    lo: float  # 15th percentile
    hi: float  # 85th percentile
    n: float  # effective sample size

    @property
    def sigma(self) -> float:
        return max((self.hi - self.lo) / 2.07, 0.10 * self.med, 2.0)

    def scaled(self, f: float) -> "Est":
        return Est(self.med * f, self.lo * f, self.hi * f, self.n)


def run_prior(dist_m: float) -> Est:
    med = dist_m / 5.0 + 10  # ~18 km/h average including lights, + accel/decel
    return Est(med, med * 0.72, med * 1.55, 0.0)


DWELL_PRIOR = Est(15.0, 3.0, 40.0, 0.0)
TERMINAL_PRIOR = Est(60.0, 10.0, 300.0, 0.0)


class _Profile:
    """Quantile tables of shape (3 day types, 144 buckets)."""

    __slots__ = ("med", "lo", "hi", "n", "built")

    def __init__(self, med, lo, hi, n):
        self.med, self.lo, self.hi, self.n = med, lo, hi, n
        self.built = time.time()

    def at(self, dt: int, bucket: int) -> Est:
        return Est(
            float(self.med[dt, bucket]),
            float(self.lo[dt, bucket]),
            float(self.hi[dt, bucket]),
            float(self.n[dt, bucket]),
        )


def _quantiles(hist: np.ndarray, qs: tuple[float, ...]) -> list[np.ndarray]:
    """hist: (..., N_VAL) weights → list of arrays (...) of quantile values."""
    cum = np.cumsum(hist, axis=-1)
    total = cum[..., -1:]
    out = []
    for q in qs:
        target = q * total
        idx = np.clip((cum < target).sum(axis=-1, keepdims=True), 0, N_VAL - 1)
        prev = np.where(idx > 0, np.take_along_axis(cum, np.maximum(idx - 1, 0), -1), 0.0)
        w = np.take_along_axis(hist, idx, -1)
        frac = np.clip(np.where(w > 0, (target - prev) / np.where(w > 0, w, 1), 0.5), 0, 1)
        lo_e, hi_e = EDGES[idx], EDGES[idx + 1]
        out.append((lo_e + frac * (hi_e - lo_e))[..., 0])
    return out


def _circ_conv(arr: np.ndarray) -> np.ndarray:
    """Convolve along the tod axis (axis=1) with the circular Gaussian kernel."""
    out = np.zeros_like(arr)
    for off, k in zip(range(-6, 7), KERNEL):
        out += k * np.roll(arr, off, axis=1)
    return out


class Model:
    def __init__(self):
        self._lock = threading.Lock()
        self._raw: dict[tuple[str, str], tuple[float, np.ndarray]] = {}
        self._prof: dict[tuple, _Profile] = {}
        self._refreshing: set[tuple] = set()
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="profile")
        # Real-time evidence: log(observed / expected) of recent runs.
        self.recent_rd: dict[tuple[str, int], deque] = defaultdict(lambda: deque(maxlen=400))
        self.recent_pair: dict[tuple[str, str], deque] = defaultdict(lambda: deque(maxlen=60))

    # ── raw samples ──────────────────────────────────────────────────────
    def _samples(self, a: str, b: str) -> np.ndarray:
        """Structured array of samples for stop pair a->b (cached briefly)."""
        key = (a, b)
        hit = self._raw.get(key)
        now = time.time()
        if hit and now - hit[0] < 300:
            return hit[1]
        cutoff = int(now - HISTORY_DAYS * 86400)
        rows = db.reader().execute(
            "SELECT route, dir, t0, run, COALESCE(dwell, -1), unc, tod, dt FROM segs "
            "WHERE a=? AND b=? AND t0>=?",
            (a, b, cutoff),
        ).fetchall()
        arr = np.array(
            [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]) for r in rows],
            dtype=[("route", "U8"), ("dir", "i2"), ("t0", "f8"), ("run", "f4"), ("dwell", "f4"),
                   ("unc", "f4"), ("tod", "i2"), ("dt", "i1")],
        )
        self._raw[key] = (now, arr)
        if len(self._raw) > 6000:
            for k in list(self._raw)[:2000]:
                self._raw.pop(k, None)
        return arr

    # ── profiles ─────────────────────────────────────────────────────────
    def _build(self, kind: str, a: str, b: str, route: str, prior: Est) -> _Profile:
        s = self._samples(a, b)
        vals = s["run"] if kind == "run" else s["dwell"]
        ok = (vals >= 0) & (vals < EDGES[-1]) & (s["unc"] <= 90)
        if kind == "run":
            ok &= vals > 0
        s, vals = s[ok], vals[ok]
        if len(s) == 0:  # nothing observed yet: flat physical prior
            full = lambda v: np.full((3, N_TOD), float(v))
            return _Profile(full(prior.med), full(prior.lo), full(prior.hi), full(0.0))

        now = time.time()
        w = (
            np.power(0.5, (now - s["t0"]) / 86400.0 / HALF_LIFE_DAYS)
            / (1.0 + (s["unc"] / 20.0) ** 2)
            * np.where(s["route"] == route, 1.0, OTHER_ROUTE_W)
        )
        vbin = np.clip(np.searchsorted(EDGES, vals, side="right") - 1, 0, N_VAL - 1)
        tbin = np.clip(s["tod"] // 10, 0, N_TOD - 1)

        hist = np.zeros((3, N_TOD, N_VAL))
        w2 = np.zeros((3, N_TOD))
        w1 = np.zeros((3, N_TOD))
        np.add.at(hist, (s["dt"].astype(int), tbin, vbin), w)
        np.add.at(w1, (s["dt"].astype(int), tbin), w)
        np.add.at(w2, (s["dt"].astype(int), tbin), w * w)

        # mix day types by similarity, then smooth over time of day
        hist = np.einsum("td,dkv->tkv", DT_SIM, hist)
        w1 = DT_SIM @ w1
        w2 = (DT_SIM**2) @ w2
        hist = _circ_conv(hist)
        w1, w2 = _circ_conv(w1), _circ_conv_sq(w2)
        neff = np.where(w2 > 0, w1 * w1 / np.where(w2 > 0, w2, 1), 0.0)

        lo, med, hi = _quantiles(hist, (0.15, 0.5, 0.85))

        # all-day fallback per day type, itself shrunk towards the physical prior
        day = hist.sum(axis=1)  # (3, V)
        dlo, dmed, dhi = _quantiles(day, (0.15, 0.5, 0.85))
        dw1 = w1.sum(axis=1) / KERNEL.sum()
        dw2 = w2.sum(axis=1) / (KERNEL**2).sum()
        dn = np.where(dw2 > 0, dw1 * dw1 / np.where(dw2 > 0, dw2, 1), 0.0)
        a2 = dn / (dn + 2.0)
        dlo = a2 * np.nan_to_num(dlo) + (1 - a2) * prior.lo
        dmed = a2 * np.nan_to_num(dmed) + (1 - a2) * prior.med
        dhi = a2 * np.nan_to_num(dhi) + (1 - a2) * prior.hi

        a1 = neff / (neff + SHRINK_K)
        med = a1 * np.nan_to_num(med) + (1 - a1) * dmed[:, None]
        lo = a1 * np.nan_to_num(lo) + (1 - a1) * dlo[:, None]
        hi = a1 * np.nan_to_num(hi) + (1 - a1) * dhi[:, None]
        return _Profile(med, np.minimum(lo, med), np.maximum(hi, med), neff)

    def profile(self, kind: str, a: str, b: str, route: str, prior: Est) -> _Profile:
        """Cached profile. A stale profile is served immediately while a background
        thread rebuilds it, so hot paths (collector, API) never stall on rebuilds."""
        key = (kind, a, b, route)
        p = self._prof.get(key)
        if p is not None:
            if time.time() - p.built >= PROFILE_TTL:
                with self._lock:
                    if key not in self._refreshing:
                        self._refreshing.add(key)
                        self._pool.submit(self._refresh, key, prior)
            return p
        p = self._build(kind, a, b, route, prior)
        self._store(key, p)
        return p

    def _refresh(self, key, prior):
        try:
            self._store(key, self._build(*key, prior))
        except Exception:  # keep serving the old profile
            pass
        finally:
            with self._lock:
                self._refreshing.discard(key)

    def _store(self, key, p):
        self._prof[key] = p
        if len(self._prof) > 30000:
            with self._lock:
                for k in list(self._prof)[:8000]:
                    self._prof.pop(k, None)

    def invalidate(self):
        self._prof.clear()
        self._raw.clear()

    # ── phase estimates ──────────────────────────────────────────────────
    def run(self, rd: RouteDir, idx: int, ts: float) -> Est:
        prior = run_prior(rd.dists[idx] if idx < len(rd.dists) else 500)
        p = self.profile("run", rd.stops[idx], rd.stops[idx + 1], rd.route, prior)
        return p.at(clock.daytype(ts), min(int(clock.tod_f(ts) // 10), N_TOD - 1))

    def dwell(self, rd: RouteDir, idx: int, ts: float) -> Est:
        if idx <= 0:
            return TERMINAL_PRIOR
        p = self.profile("dwell", rd.stops[idx - 1], rd.stops[idx], rd.route, DWELL_PRIOR)
        return p.at(clock.daytype(ts), min(int(clock.tod_f(ts) // 10), N_TOD - 1))

    # ── real-time evidence ───────────────────────────────────────────────
    def observe_run(self, rd: RouteDir, idx: int, t0: float, run: float, unc: float):
        if unc > 30 or run <= 0:
            return
        exp = self.run(rd, idx, t0).med
        if exp <= 0:
            return
        lr = math.log(min(max(run / exp, 0.33), 3.0))
        t_end = t0 + run
        self.recent_rd[rd.key].append((t_end, idx, lr))
        self.recent_pair[(rd.stops[idx], rd.stops[idx + 1])].append((t_end, rd.route, rd.dir, lr))

    def rt_factor(self, rd: RouteDir, idx: int, now: float, ahead: float) -> float:
        num, den = 0.0, 1.2  # prior pseudo-weight pulls towards "normal"
        for t, i, lr in tuple(self.recent_rd.get(rd.key, ())):
            age = now - t
            if age > 2700 or abs(i - idx) > 6:
                continue
            w = math.exp(-age / 900) * (0.55 ** abs(i - idx))
            num += w * lr
            den += w
        if idx + 1 < len(rd.stops):
            for t, route, d, lr in tuple(self.recent_pair.get((rd.stops[idx], rd.stops[idx + 1]), ())):
                if (route, d) == rd.key:
                    continue
                age = now - t
                if age > 2700:
                    continue
                w = 0.7 * math.exp(-age / 900)
                num += w * lr
                den += w
        return math.exp(num / den * math.exp(-ahead / 1800))

    def congestion(self, rd: RouteDir, now: float) -> list[float]:
        """Current real-time factor per run segment (1.0 = normal)."""
        return [self.rt_factor(rd, i, now, 0) for i in range(len(rd.stops) - 1)]

    # ── chains ───────────────────────────────────────────────────────────
    @staticmethod
    def _remaining(e: Est, elapsed: float | None) -> tuple[float, float]:
        if elapsed is None:
            elapsed = 0.35 * e.med
        rem = max(e.med - elapsed, min(0.3 * e.med, 25.0) + 3.0)
        frac = max(min(rem / max(e.med, 1), 1.0), 0.35)
        return rem, e.sigma * frac

    def chain(self, rd: RouteDir, idx: int, at_stop: bool, elapsed: float | None,
              now: float, live: bool = True) -> list[tuple[int, float, float]]:
        """Arrival forecasts for every stop after ``idx``: [(stop_idx, eta_sec, sd_sec)]."""
        last = len(rd.stops) - 1
        out: list[tuple[int, float, float]] = []
        if idx >= last:
            return out
        t, var, ssum, n = now, 0.0, 0.0, 0

        def add(med, sd):
            nonlocal t, var, ssum, n
            t += med
            var += sd * sd
            ssum += sd
            n += 1

        if at_stop:
            rem, sd = self._remaining(self.dwell(rd, idx, now), elapsed)
            add(rem, sd)
            r = self.run(rd, idx, t)
            f = self.rt_factor(rd, idx, now, t - now) if live else 1.0
            add(r.med * f, r.sigma * f)
        else:
            r = self.run(rd, idx, now)
            f = self.rt_factor(rd, idx, now, 0) if live else 1.0
            rem, sd = self._remaining(r.scaled(f), elapsed)
            add(rem, sd)
        out.append((idx + 1, t - now, _sd(var, ssum)))

        for k in range(idx + 1, last):
            d = self.dwell(rd, k, t)
            add(d.med, d.sigma)
            r = self.run(rd, k, t)
            f = self.rt_factor(rd, k, now, t - now) if live else 1.0
            add(r.med * f, r.sigma * f)
            out.append((k + 1, t - now, _sd(var, ssum)))
        return out

    def travel(self, rd: RouteDir, i: int, j: int, ts: float, live: bool = False) -> tuple[float, float]:
        """Ride time from departing stop i (at ts) to arriving at stop j: (median, sd)."""
        t, var, ssum = ts, 0.0, 0.0
        now = time.time()
        for k in range(i, j):
            if k > i:
                d = self.dwell(rd, k, t)
                t += d.med
                var += d.sigma**2
                ssum += d.sigma
            r = self.run(rd, k, t)
            f = self.rt_factor(rd, k, now, max(t - now, 0)) if live else 1.0
            t += r.med * f
            var += (r.sigma * f) ** 2
            ssum += r.sigma * f
        return t - ts, _sd(var, ssum)


def _circ_conv_sq(arr: np.ndarray) -> np.ndarray:
    out = np.zeros_like(arr)
    for off, k in zip(range(-6, 7), KERNEL):
        out += (k * k) * np.roll(arr, off, axis=1)
    return out


def band(eta: float, sd: float) -> tuple[float, float]:
    """Asymmetric ~70 % interval: buses are more often late than early."""
    return max(eta - 0.9 * sd, 0.0), eta + 1.2 * sd


def _sd(var: float, ssum: float) -> float:
    # Phase errors are positively correlated (a slow road stays slow), so the
    # total spread sits between the independent (√Σσ²) and fully correlated (Σσ) cases.
    return 0.7 * math.sqrt(var) + 0.3 * ssum


MODEL = Model()
