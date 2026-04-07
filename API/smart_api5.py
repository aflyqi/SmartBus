#!/usr/bin/env python3
# ============================================================
#  smart_api.py —— 二层逻辑服务
#  pip install Flask flask-cors requests APScheduler SQLAlchemy
# ============================================================

import datetime, logging, requests, time
from flask import Flask, jsonify, request
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import (create_engine, Column, Integer, Float, String,
                        DateTime, func)
from sqlalchemy.orm import declarative_base, sessionmaker

# ---------------- 基础配置 ----------------
UPSTREAM        = "http://127.0.0.1:8000"          # data1.py 所在服务
#UPSTREAM        = "http://123.207.198.208:8000"          # data1.py 所在服务
FETCH_INTERVAL  = 600                              # 10 min 抓一次相邻段
ROUTE_STATIONS = {
    "23": [
        "M209/1","M205","M211","M25","M22","M31","M271","M105","M104","M46/1",
        "M61/2","M117","M241","M71","M156","M253","M250","M263","M172/5",
        "M187","M199","M178","M177","M176","M181","M179","M69/1","M159",
        "M262","M251","M243","M84/2","M99","M94","M19","M21/1","M273","M210",
        "M267"
    ],
    "25": [
        "M1/12","M7/3","M271","M105","M272","M61/2","M73/1","M270/1","M153",
        "M173","M172/14","T403","T402","T309","T313","T315","T375","T380",
        "T379","T359","T355/1","C688/1","C691","C652","C655","C657","C686",
        "C656","C654/3","C653/2","C692","C689/1","T360","T376/2","T363/2",
        "T306","T314/2","T311/1","T308/1","T300","T330/1","M172/16","M160/1",
        "M144/2","M76/2","M84/1","M91","M14","M8/1","M1/12"
    ],
    "25B": [
        "T560/2", "T372", "T360", "T376/2", "T363/2", "T367", "T365/1", "T361",
        "T325/1", "T339/1", "T311/1", "T308/1", "T300", "T330/1", "M172/16",
        "M160/1", "M158/1", "M243", "M157", "M144/2", "M76/2", "M84/1", "M91",
        "M19", "M4/2", "M1/16"
    ],
    "28B": [
        "M209/1","M205","M211","M25","M22","M10","M27","M29","M36","M48","M52",
        "M239/2","M254","M241","M71","M155","M157","M162","M187","M180","M191",
        "M174","M203/2","M277","M197","M195","M192","M181","M179","M167","M168",
        "M163","M160/2","M158/2","M161","M70","M118","M53","M49","M35/1",
        "M28/2","M11","M12","M21/1","M24","M208"
    ]
}
# ---------------- DB 定义 ----------------
Base    = declarative_base()
engine  = create_engine("sqlite:///smart.db", echo=False, future=True)
Session = sessionmaker(bind=engine, expire_on_commit=False)

class SegSnapshot(Base):
    __tablename__ = "segment_snapshot"
    id       = Column(Integer, primary_key=True)
    ts       = Column(DateTime, index=True)
    route    = Column(String)
    start    = Column(String)
    end      = Column(String)
    avg_sec  = Column(Float)
    samples  = Column(Integer)

class HourlyCong(Base):
    __tablename__ = "hourly_congestion"
    id         = Column(Integer, primary_key=True)
    hour_start = Column(DateTime, index=True)
    route      = Column(String)
    start      = Column(String)
    end        = Column(String)
    avg_sec    = Column(Float)

Base.metadata.create_all(engine)

# ---------------- 内存 cache ----------------
seg_cache = {}     # {(route,start,end): avg_sec}

# ---------------- 辅助函数 ----------------
def cached_or_live(route, start, end):
    key = (route, start, end)
    if key not in seg_cache:
        try:
            r = requests.get(f"{UPSTREAM}/segment-time",
                             params={"route": route, "start": start, "end": end},
                             timeout=5).json()
            if r.get("samples"):
                seg_cache[key] = r["avg_sec"]
        except Exception as e:
            logging.warning(f"segment-time fetch {key} failed: {e}")
    return seg_cache.get(key)

def total_between(route, start, end):
    stops = ROUTE_STATIONS.get(route)
    if not stops or start not in stops or end not in stops:
        return None
    i1, i2 = stops.index(start), stops.index(end)
    if i1 == i2:
        return 0
    if i2 < i1:                                # 环线回绕
        i2 += len(stops)
    total = 0.0
    for i in range(i1, i2):
        s, e = stops[i % len(stops)], stops[(i+1) % len(stops)]
        seg  = cached_or_live(route, s, e)
        if seg is None:
            return None
        total += seg
    return total

# ---------------- 修正版：找最近车辆 ----------------
def find_nearest_vehicle(route, target):
    try:
        resp = requests.get(f"{UPSTREAM}/live", timeout=5)
        resp.raise_for_status()
        raw = resp.json()  # 上游返回的是 {"23":[...], "25":[...], ...}
    except Exception as e:
        logging.warning(f"/live fetch failed: {e}")
        return None

    # 扁平化所有车辆数据
    vehicles = []
    for lst in raw.values():
        if isinstance(lst, list):
            vehicles.extend(lst)

    stops = ROUTE_STATIONS.get(route, [])
    if target not in stops:
        return None
    tidx = stops.index(target)

    best, best_dist = None, len(stops) + 1
    for v in vehicles:
        if v.get("route") != route or v.get("location") not in stops:
            continue
        dist = (tidx - stops.index(v["location"])) % len(stops)
        if dist < best_dist:
            best, best_dist = v, dist

    if not best:
        return None

    best["eta_sec"] = total_between(route, best["location"], target)
    best["hops"]    = best_dist
    return best

# ---------------- 后台定时任务 ----------------
def fetch_adjacent_segments():
    """每 10 min 把所有相邻段最新平均时间存快照 & 填充 cache"""
    ts_now = datetime.datetime.utcnow()
    db = Session()
    try:
        for route, stops in ROUTE_STATIONS.items():
            pairs = list(zip(stops, stops[1:])) + [(stops[-1], stops[0])]
            for s, e in pairs:
                try:
                    r = requests.get(f"{UPSTREAM}/segment-time",
                                     params={"route": route, "start": s, "end": e},
                                     timeout=5)
                    if r.status_code == 200:
                        js = r.json()
                        if js.get("samples"):
                            seg_cache[(route,s,e)] = js["avg_sec"]
                            db.add(SegSnapshot(ts=ts_now, route=route,
                                               start=s, end=e,
                                               avg_sec=js["avg_sec"],
                                               samples=js["samples"]))
                except Exception as exc:
                    logging.warning(f"fetch {route} {s}->{e} err: {exc}")
        db.commit()
    finally:
        db.close()

def rollup_last_hour():
    """整点把上一个小时 5 次快照求平均写入 hourly_congestion"""
    to_hour = datetime.datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    from_ts = to_hour - datetime.timedelta(hours=1)
    db = Session()
    try:
        rows = (db.query(SegSnapshot.route, SegSnapshot.start, SegSnapshot.end,
                         func.avg(SegSnapshot.avg_sec))
                  .filter(SegSnapshot.ts >= from_ts, SegSnapshot.ts < to_hour)
                  .group_by(SegSnapshot.route, SegSnapshot.start, SegSnapshot.end)
                  .all())
        for r in rows:
            db.add(HourlyCong(hour_start=from_ts, route=r[0],
                              start=r[1], end=r[2], avg_sec=r[3]))
        db.commit()
        print(f"[Rollup] {from_ts:%H:%M} stored {len(rows)} rows")
    finally:
        db.close()

sched = BackgroundScheduler()
sched.add_job(fetch_adjacent_segments, "interval", seconds=FETCH_INTERVAL,
              next_run_time=datetime.datetime.utcnow())
sched.add_job(rollup_last_hour, "cron", minute=0)
sched.start()

# ---------------- Flask API ----------------
app = Flask(__name__)
CORS(app)      # 允许所有域跨域

@app.route("/between-time")
def api_between():
    route = request.args.get("route")
    start = request.args.get("start")
    end   = request.args.get("end")
    if not (route and start and end):
        return jsonify({"error":"need route,start,end"}), 400
    tot = total_between(route, start, end)
    if tot is None:
        return jsonify({"avg_sec":None, "error":"insufficient data"}), 200
    return jsonify({"total_avg_sec": round(tot,1)})

@app.route("/nearest")
def api_nearest():
    route  = request.args.get("route")
    target = request.args.get("target")
    if not (route and target):
        return jsonify({"error":"need route,target"}), 400
    res = find_nearest_vehicle(route, target)
    if res is None:
        return jsonify({"error":"no vehicle or data"}), 200
    return jsonify(res)

@app.route("/hourly")
def api_hourly():
    route = request.args.get("route")
    hour  = request.args.get("hour")          # e.g. 2025-04-22T13
    try:
        h = datetime.datetime.fromisoformat(hour).replace(minute=0,second=0,microsecond=0)
    except Exception:
        return jsonify({"error":"bad hour param"}), 400
    db = Session()
    try:
        rows = (db.query(HourlyCong)
                  .filter_by(route=route, hour_start=h).all())
        return jsonify([{"start":r.start, "end":r.end, "avg_sec":r.avg_sec}
                        for r in rows])
    finally:
        db.close()

@app.route("/live")
def api_live():
    """简单转发 data1.py 的 /vehicle-info"""
    try:
        r = requests.get("http://127.0.0.1:5000/vehicle-info", timeout=5)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/getInformation")
def api_get_information():
    """
    GET /getInformation?route=<routeCode>
    返回该线路当前所有相邻站段最新平均行驶时间。
    如果某段还没有样本，则该段不会出现在返回列表中。
    """
    route = request.args.get("route")
    if not route or route not in ROUTE_STATIONS:
        return jsonify({"error":"unknown or missing route"}), 400

    stops = ROUTE_STATIONS[route]
    pairs = list(zip(stops, stops[1:])) + [(stops[-1], stops[0])]
    result = []
    for s, e in pairs:
        avg = cached_or_live(route, s, e)
        if avg is not None:
            result.append({"start": s, "end": e, "avg_sec": round(avg, 1)})

    if not result:
        return jsonify({"error":"insufficient data"}), 200
    return jsonify(result), 200

# -----------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9000, debug=False)