"""Historical aggregates: headways (how often buses come) and congestion maps."""
from __future__ import annotations

import time
from collections import defaultdict

from . import clock, db, registry
from .model import MODEL, N_TOD, run_prior
from .registry import RouteDir

_cache: dict[tuple, tuple[float, object]] = {}


def _cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    if len(_cache) > 3000:
        for k in list(_cache)[:1000]:
            _cache.pop(k, None)
    return val


def headway_curve(route: str, d: int, stop: str, dt: int, days: int = 28) -> list[dict]:
    """Per half hour: buses/hour and expected wait for a random arrival at the stop."""

    def build():
        since = int(time.time() - days * 86400)
        rows = db.reader().execute(
            "SELECT t FROM passes WHERE route=? AND dir=? AND stop=? AND dt=? AND t>=? ORDER BY t",
            (route, d, stop, dt, since),
        ).fetchall()
        by_day: dict[str, list[float]] = defaultdict(list)
        for (t,) in rows:
            by_day[clock.day_str(t)].append(t)
        n_days = max(len(by_day), 1)
        count = [0] * 48
        h1 = [0.0] * 48
        h2 = [0.0] * 48
        for ts in by_day.values():
            prev = None
            for t in ts:
                if prev is not None and t - prev < 20:  # duplicate sighting
                    continue
                slot = min(int(clock.tod_f(t) // 30), 47)
                count[slot] += 1
                if prev is not None:
                    h = t - prev
                    if h <= 3600:
                        h1[slot] += h
                        h2[slot] += h * h
                prev = t
        out = []
        for s in range(48):
            per_hour = count[s] * 2 / n_days
            wait = (h2[s] / (2 * h1[s])) if h1[s] > 0 else None
            out.append({
                "tod": s * 30,
                "per_hour": round(per_hour, 2),
                "wait": round(wait) if wait else None,
            })
        return {"days": len(by_day), "slots": out}

    return _cached(("hw", route, d, stop, dt), 1800, build)


def headway_now(route: str, d: int, stop: str, ts: float) -> dict | None:
    curve = headway_curve(route, d, stop, clock.daytype(ts))
    if not curve["days"]:
        return None
    slot = curve["slots"][min(int(clock.tod_f(ts) // 30), 47)]
    if not slot["per_hour"]:
        return None
    return slot


def travel_curve(rd: RouteDir, i: int, j: int, dt: int, step: int = 15) -> list[dict]:
    """Typical ride time from stop i to j across the day for one day type."""

    def build():
        # anchor on a recent date of the requested day type so the model sees the right dt
        base = time.time()
        while clock.daytype(base) != dt:
            base -= 86400
        midnight = base - clock.tod_f(base) * 60
        out = []
        for tod in range(0, 1440, step):
            med, sd = MODEL.travel(rd, i, j, midnight + tod * 60)
            out.append({"tod": tod, "med": round(med), "lo": round(max(med - 0.9 * sd, 0)), "hi": round(med + 1.2 * sd)})
        return out

    return _cached(("tc", rd.route, rd.dir, i, j, dt, step), 900, build)


def congestion_map(rd: RouteDir, dt: int) -> dict:
    """Per run segment × hour: typical seconds and slowdown vs. that segment's best hour."""

    def build():
        segs = []
        for k in range(len(rd.stops) - 1):
            prior_d = rd.dists[k] if k < len(rd.dists) else 500
            p = MODEL.profile("run", rd.stops[k], rd.stops[k + 1], rd.route, run_prior(prior_d))
            hours = []
            for h in range(24):
                b = slice(h * 6, h * 6 + 6)
                hours.append(float(p.med[dt, b].mean()))
            n = float(p.n[dt].sum() / N_TOD * 6)
            free = min(hours) if hours else 1
            segs.append({
                "from": rd.stops[k],
                "to": rd.stops[k + 1],
                "sec": [round(x) for x in hours],
                "index": [round(x / free, 2) if free > 0 else 1 for x in hours],
                "n": round(n, 1),
            })
        return {"segments": segs}

    return _cached(("cm", rd.route, rd.dir, dt), 1800, build)


def data_counts() -> dict:
    def build():
        c = db.reader()
        segs = c.execute("SELECT COUNT(*) FROM segs").fetchone()[0]
        passes = c.execute("SELECT COUNT(*) FROM passes").fetchone()[0]
        first = c.execute("SELECT MIN(t0) FROM segs").fetchone()[0]
        today = int(time.time() - clock.tod_f(time.time()) * 60)
        segs_today = c.execute("SELECT COUNT(*) FROM segs WHERE t0>=?", (today,)).fetchone()[0]
        return {"segs": segs, "passes": passes, "first": first, "segs_today": segs_today,
                "routes": len(registry.ROUTES), "stops": len(registry.STOPS)}

    return _cached(("counts",), 60, build)


def accuracy(days: int = 7) -> list[dict]:
    since = clock.day_str(time.time() - days * 86400)
    rows = db.reader().execute(
        "SELECT horizon, SUM(n), SUM(abs_err), SUM(bias), SUM(in_band) FROM accuracy WHERE day>=? "
        "GROUP BY horizon ORDER BY horizon",
        (since,),
    ).fetchall()
    out = []
    for h, n, ae, bias, inb in rows:
        if n:
            out.append({"horizon": h, "n": n, "mae": round(ae / n, 1), "bias": round(bias / n, 1),
                        "in_band": round(inb / n, 3)})
    return out
