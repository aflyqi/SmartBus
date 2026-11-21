from __future__ import annotations

import time
from datetime import datetime

from . import config

WEEKDAY, SATURDAY, SUNDAY = 0, 1, 2
DAYTYPE_NAMES = {WEEKDAY: "工作日", SATURDAY: "周六", SUNDAY: "周日/假日"}

# Similarity between day types (row = target, col = sample).
DT_SIM = (
    (1.00, 0.30, 0.18),
    (0.30, 1.00, 0.55),
    (0.18, 0.55, 1.00),
)


def now() -> float:
    return time.time()


def local(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, config.TZ)


def daytype(ts: float) -> int:
    wd = local(ts).weekday()
    return WEEKDAY if wd < 5 else (SATURDAY if wd == 5 else SUNDAY)


def tod(ts: float) -> int:
    d = local(ts)
    return d.hour * 60 + d.minute


def tod_f(ts: float) -> float:
    d = local(ts)
    return d.hour * 60 + d.minute + d.second / 60


def day_str(ts: float) -> str:
    return local(ts).strftime("%Y-%m-%d")


def circ_diff(a: float, b: float) -> float:
    """Shortest distance in minutes between two times of day."""
    d = abs(a - b) % 1440
    return min(d, 1440 - d)
