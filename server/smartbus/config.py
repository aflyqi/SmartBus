"""Runtime configuration. Every value can be overridden by an environment variable
of the same name prefixed with ``SMARTBUS_`` (e.g. ``SMARTBUS_PORT=9000``)."""
from __future__ import annotations

import os
from datetime import timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default):
    raw = os.environ.get(f"SMARTBUS_{name}")
    if raw is None:
        return default
    if isinstance(default, bool):
        return raw.lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        return int(raw)
    if isinstance(default, float):
        return float(raw)
    return raw


# ── Server ────────────────────────────────────────────────────────────────
HOST: str = _env("HOST", "0.0.0.0")
PORT: int = _env("PORT", 8080)
WEB_DIR: Path = ROOT / "web"
DATA_DIR: Path = Path(_env("DATA_DIR", str(ROOT / "data")))
DB_PATH: Path = DATA_DIR / "smartbus.db"

# ── Upstream (DSAT 巴士報站) ───────────────────────────────────────────────
DSAT_BASE: str = _env("DSAT_BASE", "https://bis.dsat.gov.mo:37812/macauweb")
LANG: str = _env("LANG", "zh-cn")  # zh-cn (简体) / zh-tw (繁體) / en / pt

# Which routes to collect: "all" or a comma separated list such as "25,25B,23,28B".
ROUTES: str = _env("ROUTES", "all")

# Adaptive polling: a route-direction with buses on it is polled every ACTIVE
# seconds; an empty one (night, suspended) is polled every IDLE seconds.
POLL_ACTIVE_SEC: float = _env("POLL_ACTIVE_SEC", 10.0)
POLL_IDLE_SEC: float = _env("POLL_IDLE_SEC", 90.0)
# Hard cap on requests per second sent upstream – be a good citizen.
MAX_RPS: float = _env("MAX_RPS", 8.0)
CONCURRENCY: int = _env("CONCURRENCY", 6)
# Static route/stop data is refreshed this often.
STATIC_REFRESH_SEC: int = _env("STATIC_REFRESH_SEC", 6 * 3600)

# Turn the collector off (serve-only mode, e.g. for a read replica).
COLLECT: bool = _env("COLLECT", True)

# ── Storage ───────────────────────────────────────────────────────────────
RETENTION_DAYS: int = _env("RETENTION_DAYS", 60)

# ── Time ──────────────────────────────────────────────────────────────────
TZ = timezone(timedelta(hours=8))  # Macau, no DST
