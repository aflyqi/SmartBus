"""In-memory catalogue of routes and stops (backed by the routes/stops tables)."""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field

from . import db


@dataclass
class Stop:
    code: str
    name: str
    lat: float | None = None
    lon: float | None = None
    lane: str = ""


@dataclass
class RouteDir:
    route: str
    dir: int
    code: str
    color: str
    stops: list[str]
    dists: list[float] = field(default_factory=list)  # metres, stops[i] -> stops[i+1]

    @property
    def key(self) -> tuple[str, int]:
        return (self.route, self.dir)

    def compute_dists(self, stops: dict[str, Stop]):
        out = []
        for a, b in zip(self.stops, self.stops[1:]):
            sa, sb = stops.get(a), stops.get(b)
            if sa and sb and sa.lat and sb.lat:
                # Road distance ≈ 1.3 × great-circle distance in a dense city.
                out.append(1.3 * haversine(sa.lat, sa.lon, sb.lat, sb.lon))
            else:
                out.append(500.0)
        self.dists = out


def haversine(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


ROUTES: dict[tuple[str, int], RouteDir] = {}
LAST_UPDATED: float = 0.0
STOPS: dict[str, Stop] = {}


def route_sort_key(name: str):
    m = re.match(r"([A-Za-z]*)(\d*)(.*)", name)
    prefix, num, rest = m.groups() if m else ("", "", name)
    return (prefix != "", prefix, int(num) if num else 0, rest)


def load_from_db():
    conn = db.reader()
    STOPS.clear()
    for r in conn.execute("SELECT * FROM stops"):
        STOPS[r["code"]] = Stop(r["code"], r["name"] or r["code"], r["lat"], r["lon"], r["lane"] or "")
    ROUTES.clear()
    global LAST_UPDATED
    LAST_UPDATED = conn.execute("SELECT COALESCE(MAX(updated), 0) FROM routes").fetchone()[0]
    for r in conn.execute("SELECT * FROM routes"):
        rd = RouteDir(r["route"], r["dir"], r["code"], r["color"] or "", json.loads(r["stops"]))
        rd.compute_dists(STOPS)
        ROUTES[rd.key] = rd


def save_route(rd: RouteDir, stops: list[Stop], updated: float):
    def _do(c):
        c.execute(
            "INSERT OR REPLACE INTO routes(route,dir,code,color,stops,updated) VALUES (?,?,?,?,?,?)",
            (rd.route, rd.dir, rd.code, rd.color, json.dumps(rd.stops), updated),
        )
        for s in stops:
            c.execute(
                "INSERT INTO stops(code,name,lat,lon,lane) VALUES (?,?,?,?,?) "
                "ON CONFLICT(code) DO UPDATE SET name=excluded.name, "
                "lat=COALESCE(excluded.lat, stops.lat), lon=COALESCE(excluded.lon, stops.lon), "
                "lane=excluded.lane",
                (s.code, s.name, s.lat, s.lon, s.lane),
            )

    db.write(_do)
    for s in stops:
        old = STOPS.get(s.code)
        if old and s.lat is None:
            s.lat, s.lon = old.lat, old.lon
        STOPS[s.code] = s
    rd.compute_dists(STOPS)
    ROUTES[rd.key] = rd


def stop_name(code: str) -> str:
    s = STOPS.get(code)
    return s.name if s else code


def routes_sorted() -> list[RouteDir]:
    return sorted(ROUTES.values(), key=lambda r: (route_sort_key(r.route), r.dir))
