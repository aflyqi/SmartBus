"""Plain-HTTP client for the DSAT 巴士報站 web API.

The web page signs every request with a ``token`` header:

    md5(querystring)  with the current Macau time ``yyyyMMddHHmm`` spliced in at
    positions 4 (yyyy), 12 (MMdd) and 24 (HHmm)

where ``querystring`` is ``k1=v1&k2=v2...`` in the same key order as the form
body. No browser required.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from datetime import datetime

import httpx

from . import config

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)


def make_token(params: dict[str, str]) -> str:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    digest = list(hashlib.md5(query.encode()).hexdigest())
    stamp = datetime.now(config.TZ).strftime("%Y%m%d%H%M")
    digest[24:24] = [stamp[8:]]
    digest[12:12] = [stamp[4:8]]
    digest[4:4] = [stamp[:4]]
    return "".join(digest)


class DsatError(RuntimeError):
    pass


@dataclass
class BusPos:
    plate: str
    stop_idx: int
    at_stop: bool  # True: arrived / dwelling at stop_idx; False: left stop_idx
    speed: float | None
    passenger: int | None  # crowding 0..5 as reported, None if unknown


class RateLimiter:
    """Simple async token bucket."""

    def __init__(self, rps: float):
        self.interval = 1.0 / rps
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self):
        async with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self.interval
        if delay > 0:
            await asyncio.sleep(delay)


class DsatClient:
    def __init__(self):
        self.http = httpx.AsyncClient(
            base_url=config.DSAT_BASE,
            timeout=12,
            headers={"User-Agent": UA, "Referer": config.DSAT_BASE + "/routeLine.html"},
            http2=False,
        )
        self.limiter = RateLimiter(config.MAX_RPS)
        self.sem = asyncio.Semaphore(config.CONCURRENCY)
        self.stats = {"ok": 0, "fail": 0, "last_error": None, "last_ok": None}

    async def close(self):
        await self.http.aclose()

    async def _post(self, path: str, params: dict[str, str]) -> dict:
        params = {**params, "device": "web"}
        async with self.sem:
            await self.limiter.wait()
            try:
                r = await self.http.post(path, data=params, headers={"token": make_token(params)})
                r.raise_for_status()
                body = r.json()
            except Exception as e:  # network / JSON error
                self.stats["fail"] += 1
                self.stats["last_error"] = f"{path}: {e!r}"[:300]
                raise DsatError(str(e)) from e
        if body.get("header") == "003":  # "no data" – e.g. a direction that does not exist
            raise DsatError("no data")
        if body.get("header") != "000":
            self.stats["fail"] += 1
            self.stats["last_error"] = f"{path}: header={body.get('header')} {str(body.get('data'))[:120]}"
            raise DsatError(f"header {body.get('header')}")
        self.stats["ok"] += 1
        self.stats["last_ok"] = time.time()
        return body["data"]

    # ── endpoints ─────────────────────────────────────────────────────────
    async def route_list(self) -> list[dict]:
        data = await self._post("/getRouteAndCompanyList.html", {"lang": config.LANG})
        return data.get("routeList", [])

    async def route_static(self, route: str, direction: int) -> dict | None:
        """Stops of one route direction, or None if that direction does not exist."""
        try:
            data = await self._post(
                "/getRouteData.html",
                {"action": "sd", "routeName": route, "dir": str(direction), "lang": config.LANG},
            )
        except DsatError:
            return None
        if not data.get("routeInfo"):
            return None
        return data

    async def stop_locations(self, route: str, direction: int, route_code: str) -> list[dict]:
        data = await self._post(
            "/routestation/location",
            {"routeName": route, "dir": str(direction), "lang": config.LANG, "routeCode": route_code},
        )
        return data.get("stationInfoList", [])

    async def live(self, route: str, direction: int, route_code: str) -> tuple[list[str], list[BusPos]]:
        """Returns (stop codes as the live feed lists them, buses)."""
        data = await self._post(
            "/routestation/bus",
            {
                "action": "dy",
                "routeName": route,
                "dir": str(direction),
                "lang": config.LANG,
                "routeCode": route_code,
            },
        )
        out: list[BusPos] = []
        info = data.get("routeInfo", []) or []
        codes = [s.get("staCode", "") for s in info]
        for idx, stop in enumerate(info):
            for b in stop.get("busInfo", []) or []:
                plate = (b.get("busPlate") or "").strip()
                if not plate:
                    continue
                out.append(
                    BusPos(
                        plate=plate,
                        stop_idx=idx,
                        at_stop=str(b.get("status")) == "1",
                        speed=_num(b.get("speed")),
                        passenger=_int(b.get("passengerFlow")),
                    )
                )
        return codes, out


def _num(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _int(x) -> int | None:
    try:
        v = int(x)
        return v if v >= 0 else None
    except (TypeError, ValueError):
        return None
