"""SQLite storage (WAL mode: one writer, many concurrent readers)."""
from __future__ import annotations

import sqlite3
import threading
import time

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS routes (
    route   TEXT NOT NULL,
    dir     INTEGER NOT NULL,
    code    TEXT NOT NULL,
    color   TEXT,
    stops   TEXT NOT NULL,          -- JSON array of stop codes, in order
    updated REAL NOT NULL,
    PRIMARY KEY (route, dir)
);
CREATE TABLE IF NOT EXISTS stops (
    code TEXT PRIMARY KEY,
    name TEXT,
    lat  REAL,
    lon  REAL,
    lane TEXT
);
-- One row per observed traversal of a stop pair a -> b.
--   t0    epoch seconds the bus left a
--   run   seconds from leaving a to arriving at b
--   dwell seconds spent at b (NULL if the bus never reported leaving b)
--   unc   timing uncertainty in seconds (half the polling gap it was inferred from)
CREATE TABLE IF NOT EXISTS segs (
    id    INTEGER PRIMARY KEY,
    route TEXT NOT NULL,
    dir   INTEGER NOT NULL,
    a     TEXT NOT NULL,
    b     TEXT NOT NULL,
    t0    INTEGER NOT NULL,
    run   REAL NOT NULL,
    dwell REAL,
    unc   REAL NOT NULL,
    tod   INTEGER NOT NULL,         -- minute of day (Macau) of t0
    dt    INTEGER NOT NULL          -- day type 0=weekday 1=Saturday 2=Sunday
);
CREATE INDEX IF NOT EXISTS segs_ab_tod ON segs (a, b, tod);
CREATE INDEX IF NOT EXISTS segs_t0 ON segs (t0);
CREATE INDEX IF NOT EXISTS segs_route ON segs (route, dir, t0);

-- One row per bus passing a stop (for headways / "when do buses come here").
CREATE TABLE IF NOT EXISTS passes (
    route TEXT NOT NULL,
    dir   INTEGER NOT NULL,
    stop  TEXT NOT NULL,
    plate TEXT NOT NULL,
    t     INTEGER NOT NULL,         -- arrival epoch seconds
    tod   INTEGER NOT NULL,
    dt    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS passes_rs ON passes (route, dir, stop, t);
CREATE INDEX IF NOT EXISTS passes_t ON passes (t);

-- Online back-test of live ETA predictions, aggregated per day and horizon bucket.
CREATE TABLE IF NOT EXISTS accuracy (
    day      TEXT NOT NULL,
    horizon  INTEGER NOT NULL,      -- bucket lower bound in minutes
    n        INTEGER NOT NULL,
    abs_err  REAL NOT NULL,
    bias     REAL NOT NULL,
    in_band  INTEGER NOT NULL,
    PRIMARY KEY (day, horizon)
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""

_local = threading.local()
_write_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-32000")
    return conn


def init():
    conn = _connect()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def reader() -> sqlite3.Connection:
    """Per-thread read connection."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


_writer: sqlite3.Connection | None = None


def write(fn):
    """Run ``fn(conn)`` inside a transaction on the single writer connection."""
    global _writer
    with _write_lock:
        if _writer is None:
            _writer = _connect()
        try:
            res = fn(_writer)
            _writer.commit()
            return res
        except Exception:
            _writer.rollback()
            raise


def purge_old():
    cutoff = int(time.time() - config.RETENTION_DAYS * 86400)

    def _do(c):
        c.execute("DELETE FROM segs WHERE t0 < ?", (cutoff,))
        c.execute("DELETE FROM passes WHERE t < ?", (cutoff,))

    write(_do)


def get_meta(k: str) -> str | None:
    row = reader().execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return row[0] if row else None


def set_meta(k: str, v: str):
    write(lambda c: c.execute("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)", (k, v)))
