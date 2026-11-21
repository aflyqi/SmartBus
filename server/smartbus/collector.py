"""Background collector: polls the live feed, tracks every bus and turns raw
positions into timed arrival / departure events.

A bus's progress along a route is a sequence of *milestones*

    m = 2·i      arrived at stop i      (feed status "1")
    m = 2·i + 1  departed stop i        (feed status "0", heading to i+1)

Between two polls a bus may pass several milestones. The interval between the
polls is shared out among them in proportion to their *expected* durations
(from the model), which is far more accurate than stamping everything with the
poll time. Every inferred timestamp carries an uncertainty (half the gap), which
the model later uses to weight the sample.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field

from . import clock, config, db, registry
from .dsat import BusPos, DsatClient, DsatError
from .model import MODEL, band
from .registry import RouteDir, Stop

log = logging.getLogger("smartbus.collector")

MAX_RUN, MAX_DWELL = 1800.0, 900.0
LOST_AFTER = 480.0  # seconds without sighting → trip considered over


@dataclass
class BusState:
    m: int
    seen: float
    times: dict[int, tuple[float, float] | None] = field(default_factory=dict)
    pending: dict[int, list] = field(default_factory=dict)  # stop idx -> seg row awaiting dwell
    trip_start: float = 0.0


@dataclass
class LiveBus:
    plate: str
    idx: int
    at_stop: bool
    speed: float | None
    passenger: int | None
    since: float | None  # when it reached its current milestone (None = unknown)


LIVE: dict[tuple[str, int], dict] = {}
STATES: dict[tuple[str, int, str], BusState] = {}

# back-test: (route, dir, plate, stop_idx) -> {horizon_bucket: (made_at, pred_t, lo, hi)}
PREDICTIONS: dict[tuple, dict[int, tuple]] = {}
ACC: dict[tuple[str, int], list] = defaultdict(lambda: [0, 0.0, 0.0, 0])
HORIZONS = (0, 2, 5, 10, 20, 40)

STATUS = {
    "started": None,
    "static_updated": None,
    "polls": 0,
    "routes_active": 0,
    "buses": 0,
    "samples_written": 0,
    "passes_written": 0,
    "last_cycle": None,
}


def horizon_bucket(sec: float) -> int:
    mins = sec / 60
    hb = 0
    for h in HORIZONS:
        if mins >= h:
            hb = h
    return hb


class Collector:
    def __init__(self):
        self.client = DsatClient()
        self.next_poll: dict[tuple[str, int], float] = {}
        self.inflight: set[tuple[str, int]] = set()
        self._seg_buf: list[tuple] = []
        self._pass_buf: list[tuple] = []
        self._stop = False
        self._wanted: set[str] | None = None
        if config.ROUTES.strip().lower() != "all":
            self._wanted = {r.strip().upper() for r in config.ROUTES.split(",") if r.strip()}

    # ── static data ──────────────────────────────────────────────────────
    async def refresh_static(self, only: str | None = None):
        try:
            routes = await self.client.route_list()
        except DsatError as e:
            log.warning("route list failed: %s", e)
            return
        colors = {r["routeName"]: r.get("color", "") for r in routes}
        names = [only] if only else [r["routeName"] for r in routes]
        if self._wanted is not None:
            names = [n for n in names if n.upper() in self._wanted]

        async def one(name: str, d: int):
            sd = await self.client.route_static(name, d)
            if not sd:
                return
            code = sd.get("routeCode") or ""
            info = sd["routeInfo"]
            stops = [Stop(s["staCode"], s.get("staName") or s["staCode"], None, None, s.get("laneName") or "")
                     for s in info]
            try:
                locs = await self.client.stop_locations(name, d, code)
                by = {l["stationCode"]: l for l in locs}
                for s in stops:
                    l = by.get(s.code)
                    if l:
                        s.lat, s.lon = _f(l.get("latitude")), _f(l.get("longitude"))
            except DsatError:
                pass
            rd = RouteDir(name, d, code, colors.get(name, ""), [s.code for s in stops])
            await asyncio.to_thread(registry.save_route, rd, stops, time.time())

        await asyncio.gather(*(one(n, d) for n in names for d in (0, 1)), return_exceptions=True)
        STATUS["static_updated"] = time.time()
        log.info("static data: %d route-directions, %d stops", len(registry.ROUTES), len(registry.STOPS))

    # ── main loop ────────────────────────────────────────────────────────
    async def run(self):
        STATUS["started"] = time.time()
        if not registry.ROUTES:
            await self.refresh_static()
        STATUS["static_updated"] = STATUS["static_updated"] or registry.LAST_UPDATED or None
        last_static = STATUS["static_updated"] or 0
        if await asyncio.to_thread(db.get_meta, "lang") != config.LANG:
            last_static = 0  # station names were fetched in another language
            await asyncio.to_thread(db.set_meta, "lang", config.LANG)
        last_bt = last_flush = last_purge = 0.0
        while not self._stop:
            now = time.time()
            for rd in list(registry.ROUTES.values()):
                if self._wanted is not None and rd.route.upper() not in self._wanted:
                    continue
                if rd.key in self.inflight or now < self.next_poll.get(rd.key, 0):
                    continue
                self.inflight.add(rd.key)
                asyncio.create_task(self._poll(rd))
            if now - last_bt > 60:
                last_bt = now
                await asyncio.to_thread(self._backtest_snapshot, now)
            if now - last_flush > 300:
                last_flush = now
                await asyncio.to_thread(self._flush_accuracy)
            if now - last_static > config.STATIC_REFRESH_SEC:
                last_static = now
                asyncio.create_task(self.refresh_static())
            if now - last_purge > 6 * 3600:
                last_purge = now
                await asyncio.to_thread(db.purge_old)
            STATUS["routes_active"] = sum(1 for v in LIVE.values() if v["buses"])
            STATUS["buses"] = sum(len(v["buses"]) for v in LIVE.values())
            STATUS["last_cycle"] = now
            await asyncio.sleep(1.0)

    async def stop(self):
        self._stop = True
        await asyncio.to_thread(self._flush_accuracy)
        await self.client.close()

    async def _poll(self, rd: RouteDir):
        try:
            codes, buses = await self.client.live(rd.route, rd.dir, rd.code)
            t = time.time()
            STATUS["polls"] += 1
            if codes and codes != rd.stops:
                log.info("route %s/%d stop list changed – refreshing", rd.route, rd.dir)
                asyncio.create_task(self.refresh_static(rd.route))
                self.next_poll[rd.key] = t + 30
                return
            await asyncio.to_thread(self.process, rd, t, buses)
            self.next_poll[rd.key] = t + (config.POLL_ACTIVE_SEC if buses else config.POLL_IDLE_SEC)
        except DsatError:
            self.next_poll[rd.key] = time.time() + 30
        except Exception:
            log.exception("poll %s/%d failed", rd.route, rd.dir)
            self.next_poll[rd.key] = time.time() + 30
        finally:
            self.inflight.discard(rd.key)

    # ── tracking ─────────────────────────────────────────────────────────
    _plock = threading.Lock()

    def process(self, rd: RouteDir, T: float, buses: list[BusPos]):
        with self._plock:
            self._process(rd, T, buses)

    def _process(self, rd: RouteDir, T: float, buses: list[BusPos]):
        seen = set()
        live = []
        for b in buses:
            key = (rd.route, rd.dir, b.plate)
            seen.add(key)
            m_new = 2 * b.stop_idx + (0 if b.at_stop else 1)
            st = STATES.get(key)
            if st is None or m_new < st.m - 3 or T - st.seen > LOST_AFTER:
                if st is not None:
                    self._finish(rd, st)
                st = BusState(m=m_new, seen=T, times={m_new: None}, trip_start=T)
                STATES[key] = st
            elif m_new > st.m:
                self._advance(rd, b.plate, st, m_new, T)
            else:
                st.seen = T  # same milestone (or small backwards GPS jitter)
            since = st.times.get(st.m)
            live.append(LiveBus(b.plate, st.m // 2, st.m % 2 == 0, b.speed, b.passenger,
                                since[0] if since else None))

        # trips that vanished from the feed
        for key in [k for k in STATES if k[0] == rd.route and k[1] == rd.dir and k not in seen]:
            st = STATES[key]
            if T - st.seen > LOST_AFTER:
                self._finish(rd, st)
                del STATES[key]

        live.sort(key=lambda x: (-x.idx, x.at_stop))
        LIVE[rd.key] = {"ts": T, "buses": live}
        self._flush_buffers()

    def _expected(self, rd: RouteDir, k: int, ts: float) -> float:
        i = k // 2
        if k % 2 == 0:
            return MODEL.dwell(rd, i, ts).med
        if i + 1 >= len(rd.stops):
            return 30.0
        return MODEL.run(rd, i, ts).med

    def _advance(self, rd: RouteDir, plate: str, st: BusState, m_new: int, T: float):
        gap = T - st.seen
        steps = list(range(st.m, m_new))
        if len(steps) == 1:
            fracs = [0.5]  # one milestone in the gap: the midpoint is the best guess
        else:
            # Several milestones passed between polls. The gap holds the rest of
            # the current phase, the full phases in between, and part of the
            # phase the bus is in now (≈ half of it); share it out by expected duration.
            exp = [max(self._expected(rd, k, st.seen), 3.0) for k in steps]
            t_cur = st.times.get(st.m)
            elapsed = (st.seen - t_cur[0]) if t_cur else 0.5 * exp[0]
            exp[0] = max(exp[0] - elapsed, 0.3 * exp[0], 2.0)
            tail = 0.5 * max(self._expected(rd, m_new, st.seen), 3.0)
            total = sum(exp) + tail
            acc, fracs = 0.0, []
            for e in exp:
                acc += e
                fracs.append(acc / total)
        unc = gap / 2
        for j, mm in enumerate(range(st.m + 1, m_new + 1)):
            t = st.seen + gap * fracs[j]
            st.times[mm] = (t, unc)
            self._milestone(rd, plate, st, mm, t, unc)
        st.m = m_new
        st.seen = T
        for k in [k for k in st.times if k < m_new - 4]:
            del st.times[k]

    def _milestone(self, rd: RouteDir, plate: str, st: BusState, mm: int, t: float, unc: float):
        i = mm // 2
        if mm % 2 == 0:  # arrived at stop i
            if i < len(rd.stops):
                self._pass_buf.append((rd.route, rd.dir, rd.stops[i], plate, int(t), clock.tod(t), clock.daytype(t)))
                self._evaluate(rd, plate, i, t, unc)
            dep = st.times.get(mm - 1)
            if dep and i >= 1:
                run = t - dep[0]
                u = max(unc, dep[1])
                if 0 < run <= MAX_RUN:
                    st.pending[i] = [rd.route, rd.dir, rd.stops[i - 1], rd.stops[i], dep[0], run, None, u]
                    MODEL.observe_run(rd, i - 1, dep[0], run, u)
        else:  # departed stop i
            row = st.pending.pop(i, None)
            arr = st.times.get(mm - 1)
            if row is not None:
                if arr:
                    dwell = t - arr[0]
                    if 0 <= dwell <= MAX_DWELL:
                        row[6] = dwell
                self._emit(row)

    def _finish(self, rd: RouteDir, st: BusState):
        for row in st.pending.values():
            self._emit(row)
        st.pending.clear()

    def _emit(self, row: list):
        route, d, a, b, t0, run, dwell, unc = row
        self._seg_buf.append((route, d, a, b, int(t0), round(run, 1),
                              None if dwell is None else round(dwell, 1), round(unc, 1),
                              clock.tod(t0), clock.daytype(t0)))

    def _flush_buffers(self):
        segs, passes = self._seg_buf, self._pass_buf
        if not segs and not passes:
            return
        self._seg_buf, self._pass_buf = [], []

        def _do(c):
            if segs:
                c.executemany("INSERT INTO segs(route,dir,a,b,t0,run,dwell,unc,tod,dt) VALUES (?,?,?,?,?,?,?,?,?,?)", segs)
            if passes:
                c.executemany("INSERT INTO passes(route,dir,stop,plate,t,tod,dt) VALUES (?,?,?,?,?,?,?)", passes)

        db.write(_do)
        STATUS["samples_written"] += len(segs)
        STATUS["passes_written"] += len(passes)

    # ── online back-test ─────────────────────────────────────────────────
    def _backtest_snapshot(self, now: float):
        # Compute forecasts without holding the tracking lock (it is CPU work),
        # then record them under the lock.
        snaps = [(registry.ROUTES.get(k), list(v["buses"])) for k, v in list(LIVE.items())]
        new: list[tuple] = []
        for rd, buses in snaps:
            if not rd:
                continue
            for b in buses:
                elapsed = (now - b.since) if b.since else None
                try:
                    chain = MODEL.chain(rd, b.idx, b.at_stop, elapsed, now)
                except Exception:
                    log.exception("chain failed")
                    continue
                for j, eta, sd in chain:
                    if eta > 60 * 60:
                        break
                    lo, hi = band(eta, sd)
                    new.append(((rd.route, rd.dir, b.plate, j), horizon_bucket(eta),
                                (now, now + eta, now + lo, now + hi)))
        with self._plock:
            for key, hb, pred in new:
                preds = PREDICTIONS.setdefault(key, {})
                if hb not in preds:
                    preds[hb] = pred
            # forget predictions that can no longer be scored
            cutoff = now - 2 * 3600
            for k in [k for k, v in PREDICTIONS.items() if all(p[0] < cutoff for p in v.values())]:
                del PREDICTIONS[k]

    def _evaluate(self, rd: RouteDir, plate: str, i: int, t: float, unc: float):
        preds = PREDICTIONS.pop((rd.route, rd.dir, plate, i), None)
        if not preds or unc > 20:
            return
        day = clock.day_str(t)
        for hb, (_, pred_t, lo, hi) in preds.items():
            a = ACC[(day, hb)]
            a[0] += 1
            a[1] += abs(t - pred_t)
            a[2] += t - pred_t
            a[3] += 1 if lo <= t <= hi else 0

    def _flush_accuracy(self):
        with self._plock:
            items = list(ACC.items())
            ACC.clear()
        if not items:
            return

        def _do(c):
            for (day, hb), (n, ae, bias, inb) in items:
                c.execute(
                    "INSERT INTO accuracy(day,horizon,n,abs_err,bias,in_band) VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(day,horizon) DO UPDATE SET n=n+excluded.n, abs_err=abs_err+excluded.abs_err, "
                    "bias=bias+excluded.bias, in_band=in_band+excluded.in_band",
                    (day, hb, n, ae, bias, inb),
                )

        db.write(_do)


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None
