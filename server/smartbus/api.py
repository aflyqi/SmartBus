"""HTTP API + static web app."""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import clock, collector, config, db, history, registry
from .model import MODEL, band
from .registry import RouteDir

log = logging.getLogger("smartbus.api")
_collector: collector.Collector | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _collector
    db.init()
    registry.load_from_db()
    task = None
    if config.COLLECT:
        _collector = collector.Collector()
        task = asyncio.create_task(_collector.run())
    yield
    if _collector:
        await _collector.stop()
    if task:
        task.cancel()


app = FastAPI(title="SmartBus", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def no_stale_assets(request, call_next):
    resp = await call_next(request)
    if not request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-cache"  # revalidate (ETag) so updates show up at once
    else:
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ── helpers ──────────────────────────────────────────────────────────────
def _rd(route: str, d: int) -> RouteDir:
    rd = registry.ROUTES.get((route, d)) or registry.ROUTES.get((route.upper(), d))
    if not rd:
        raise HTTPException(404, f"route {route}/{d} not found")
    return rd


def _stop_json(code: str, idx: int | None = None) -> dict:
    s = registry.STOPS.get(code)
    out = {"code": code, "name": s.name if s else code, "lat": s.lat if s else None,
           "lon": s.lon if s else None, "lane": s.lane if s else ""}
    if idx is not None:
        out["idx"] = idx
    return out


def _arrivals(rd: RouteDir, now: float) -> tuple[dict[int, list[dict]], list[dict]]:
    """For every stop: upcoming buses sorted by ETA. Plus bus list with progress."""
    snap = collector.LIVE.get(rd.key)
    per_stop: dict[int, list[dict]] = {}
    buses = []
    if not snap:
        return per_stop, buses
    age = now - snap["ts"]
    for b in snap["buses"]:
        elapsed = (now - b.since) if b.since else None
        chain = MODEL.chain(rd, b.idx, b.at_stop, elapsed, now)
        progress = 0.0
        if not b.at_stop and b.idx + 1 < len(rd.stops):
            run = MODEL.run(rd, b.idx, now).med * MODEL.rt_factor(rd, b.idx, now, 0)
            e = elapsed if elapsed is not None else 0.35 * run
            progress = max(0.08, min(e / max(run, 1), 0.92))
        buses.append({
            "plate": b.plate, "idx": b.idx, "at_stop": b.at_stop, "speed": b.speed,
            "passenger": b.passenger, "progress": round(progress, 3),
            "since": b.since, "next_eta": round(chain[0][1]) if chain else None,
        })
        if b.at_stop:
            per_stop.setdefault(b.idx, []).append({"plate": b.plate, "eta": 0, "lo": 0, "hi": 0,
                                                    "away": 0, "passenger": b.passenger, "here": True})
        for j, eta, sd in chain:
            lo, hi = band(eta, sd)
            per_stop.setdefault(j, []).append({
                "plate": b.plate, "eta": round(eta), "lo": round(lo), "hi": round(hi),
                "away": j - b.idx, "passenger": b.passenger, "here": False,
            })
    for lst in per_stop.values():
        lst.sort(key=lambda x: x["eta"])
    return per_stop, buses


# ── endpoints ────────────────────────────────────────────────────────────
@app.get("/api/routes")
def routes():
    out: dict[str, dict] = {}
    for rd in registry.routes_sorted():
        r = out.setdefault(rd.route, {"route": rd.route, "color": rd.color, "dirs": []})
        snap = collector.LIVE.get(rd.key)
        r["dirs"].append({
            "dir": rd.dir,
            "from": registry.stop_name(rd.stops[0]),
            "to": registry.stop_name(rd.stops[-1]),
            "stops": len(rd.stops),
            "buses": len(snap["buses"]) if snap else 0,
        })
    return {"routes": list(out.values()), "ts": time.time()}


@app.get("/api/route/{route}")
def route_detail(route: str, dir: int = 0):
    rd = _rd(route, dir)
    now = time.time()
    per_stop, buses = _arrivals(rd, now)
    cong = MODEL.congestion(rd, now)
    stops = []
    for i, code in enumerate(rd.stops):
        s = _stop_json(code, i)
        nxt = per_stop.get(i, [])[:2]
        s["next"] = nxt
        s["dist"] = round(rd.dists[i]) if i < len(rd.dists) else None
        s["cong"] = round(cong[i], 2) if i < len(cong) else None
        stops.append(s)
    snap = collector.LIVE.get(rd.key)
    dirs = sorted(d for (r, d) in registry.ROUTES if r == rd.route)
    return {
        "route": rd.route, "dir": rd.dir, "dirs": dirs, "color": rd.color,
        "stops": stops, "buses": buses, "ts": now,
        "updated": snap["ts"] if snap else None,
    }


@app.get("/api/stop")
def stop_detail(route: str, dir: int = 0, idx: int = 0):
    rd = _rd(route, dir)
    if not 0 <= idx < len(rd.stops):
        raise HTTPException(404, "stop index out of range")
    now = time.time()
    code = rd.stops[idx]
    per_stop, _ = _arrivals(rd, now)
    dt = clock.daytype(now)
    hw = history.headway_curve(rd.route, rd.dir, code, dt)
    hw_now = history.headway_now(rd.route, rd.dir, code, now)

    # other routes serving this stop (same physical name)
    name = registry.stop_name(code)
    others = []
    for o in registry.routes_sorted():
        if o.key == rd.key:
            continue
        for j, c in enumerate(o.stops):
            if registry.stop_name(c) == name and j < len(o.stops) - 1:
                ps, _ = _arrivals(o, now)
                nxt = ps.get(j, [])
                others.append({"route": o.route, "dir": o.dir, "idx": j, "color": o.color,
                               "to": registry.stop_name(o.stops[-1]),
                               "eta": nxt[0]["eta"] if nxt else None})
                break
    others.sort(key=lambda x: (x["eta"] is None, x["eta"] or 0))

    since = int(now - 3 * 3600)
    recent = [r[0] for r in db.reader().execute(
        "SELECT t FROM passes WHERE route=? AND dir=? AND stop=? AND t>=? ORDER BY t DESC LIMIT 12",
        (rd.route, rd.dir, code, since)).fetchall()]

    return {
        "route": rd.route, "dir": rd.dir, "color": rd.color, "stop": _stop_json(code, idx),
        "to": registry.stop_name(rd.stops[-1]),
        "arrivals": per_stop.get(idx, [])[:6],
        "headway": hw, "headway_now": hw_now, "daytype": dt,
        "recent": recent, "others": others[:12], "ts": now,
    }


@app.get("/api/plan")
def plan(route: str, dir: int = 0, frm: int = Query(..., alias="from"), to: int = 0,
         dt: int | None = None, tod: int | None = None):
    rd = _rd(route, dir)
    if not (0 <= frm < to < len(rd.stops)):
        raise HTTPException(400, "need 0 <= from < to < number of stops")
    now = time.time()
    live = dt is None and tod is None
    if dt is None:
        dt = clock.daytype(now)
    if tod is None:
        tod = clock.tod(now)
    base = now
    while clock.daytype(base) != dt:
        base -= 86400
    ts = base - clock.tod_f(base) * 60 + tod * 60
    med, sd = MODEL.travel(rd, frm, to, ts if not live else now, live=live)
    lo, hi = band(med, sd)
    curve = history.travel_curve(rd, frm, to, dt)
    hw = history.headway_curve(rd.route, rd.dir, rd.stops[frm], dt)
    out = {
        "route": rd.route, "dir": rd.dir, "color": rd.color, "dt": dt, "tod": tod, "live": live,
        "from": _stop_json(rd.stops[frm], frm), "to": _stop_json(rd.stops[to], to),
        "stops": to - frm,
        "travel": {"med": round(med), "lo": round(lo), "hi": round(hi)},
        "curve": curve, "headway": hw,
    }
    if live:
        per_stop, _ = _arrivals(rd, now)
        out["next"] = per_stop.get(frm, [])[:3]
    return out


@app.get("/api/stops/search")
def stop_search(q: str = "", lat: float | None = None, lon: float | None = None, limit: int = 12):
    q = q.strip().lower()
    groups: dict[str, dict] = {}
    for rd in registry.routes_sorted():
        for i, code in enumerate(rd.stops):
            s = registry.STOPS.get(code)
            name = s.name if s else code
            if q and q not in name.lower() and q not in code.lower():
                continue
            g = groups.setdefault(name, {"name": name, "codes": [], "routes": [], "lat": None, "lon": None})
            if code not in g["codes"]:
                g["codes"].append(code)
            if s and s.lat and g["lat"] is None:
                g["lat"], g["lon"] = s.lat, s.lon
            tag = {"route": rd.route, "dir": rd.dir, "idx": i, "color": rd.color}
            if not any(t["route"] == rd.route and t["dir"] == rd.dir for t in g["routes"]):
                g["routes"].append(tag)
    items = list(groups.values())
    if lat is not None and lon is not None:
        for g in items:
            g["distance"] = (round(registry.haversine(lat, lon, g["lat"], g["lon"]))
                             if g["lat"] else None)
        items = [g for g in items if g["distance"] is not None]
        items.sort(key=lambda g: g["distance"])
    elif q:
        items.sort(key=lambda g: (not g["name"].lower().startswith(q), len(g["name"])))
    return {"stops": items[:limit]}


@app.get("/api/journey")
def journey(frm: str = Query(..., alias="from"), to: str = ""):
    """All direct routes from stop name A to stop name B, ranked by live arrival time."""
    now = time.time()
    options = []
    for rd in registry.routes_sorted():
        names = [registry.stop_name(c) for c in rd.stops]
        if frm not in names or to not in names:
            continue
        i = names.index(frm)
        js = [j for j in range(i + 1, len(names)) if names[j] == to]
        if not js:
            continue
        j = js[0]
        per_stop, _ = _arrivals(rd, now)
        nxt = per_stop.get(i, [])
        wait = nxt[0]["eta"] if nxt else None
        hw = history.headway_now(rd.route, rd.dir, rd.stops[i], now)
        dep_ts = now + (wait or 0)
        med, sd = MODEL.travel(rd, i, j, dep_ts, live=True)
        lo, hi = band(med, sd)
        options.append({
            "route": rd.route, "dir": rd.dir, "color": rd.color, "from_idx": i, "to_idx": j,
            "towards": registry.stop_name(rd.stops[-1]), "stops": j - i,
            "wait": wait, "wait_lo": nxt[0]["lo"] if nxt else None, "wait_hi": nxt[0]["hi"] if nxt else None,
            "headway": hw,
            "ride": {"med": round(med), "lo": round(lo), "hi": round(hi)},
            "arrive": round(dep_ts + med) if wait is not None else None,
            "later": [x["eta"] for x in nxt[1:3]],
        })
    options.sort(key=lambda o: (o["arrive"] is None, o["arrive"] or 0, o["ride"]["med"]))
    return {"from": frm, "to": to, "options": options, "ts": now}


@app.get("/api/insights")
def insights(route: str, dir: int = 0, dt: int | None = None):
    rd = _rd(route, dir)
    if dt is None:
        dt = clock.daytype(time.time())
    cm = history.congestion_map(rd, dt)
    full = history.travel_curve(rd, 0, len(rd.stops) - 1, dt, step=30)
    stops = [_stop_json(c, i) for i, c in enumerate(rd.stops)]
    return {"route": rd.route, "dir": rd.dir, "color": rd.color, "dt": dt, "stops": stops,
            "map": cm["segments"], "full": full}


@app.get("/api/status")
def status():
    st = dict(collector.STATUS)
    st["upstream"] = dict(_collector.client.stats) if _collector else None
    st["collecting"] = bool(_collector)
    st["data"] = history.data_counts()
    st["accuracy"] = history.accuracy(7)
    st["now"] = time.time()
    st["config"] = {"routes": config.ROUTES, "poll_active": config.POLL_ACTIVE_SEC,
                    "poll_idle": config.POLL_IDLE_SEC, "max_rps": config.MAX_RPS,
                    "retention_days": config.RETENTION_DAYS}
    return st


# ── static web app ───────────────────────────────────────────────────────
app.mount("/assets", StaticFiles(directory=config.WEB_DIR / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    f = (config.WEB_DIR / path).resolve()
    if path and f.is_file() and config.WEB_DIR.resolve() in f.parents:
        return FileResponse(f)
    return FileResponse(config.WEB_DIR / "index.html")
