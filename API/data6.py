import re, time, threading, datetime, requests
from flask import Flask, jsonify, request
from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Float, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.sql import func

# ─── 基本配置 ──────────────────────────────────
DATABASE_URI = "sqlite:///bus.db"              # 若用 Postgres 改成 postgres://...
POLL_SEC     = 10                              # 轮询 /vehicle-info 间隔
#SRC_API      = "http://127.0.0.1:5000/vehicle-info"
SRC_API      = "http://123.207.198.208:5000/vehicle-info"

# ─── 线路 → 站点顺序（首尾环线已包含） ───────────
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

# ─── ORM + 数据库初始化 ─────────────────────────
Base = declarative_base()
engine = create_engine(DATABASE_URI, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

class Route(Base):
    __tablename__ = "routes"
    id   = Column(Integer, primary_key=True)
    code = Column(String, unique=True, nullable=False)

class Station(Base):
    __tablename__ = "stations"
    id   = Column(Integer, primary_key=True)
    code = Column(String, unique=True, nullable=False)

class RouteStation(Base):
    __tablename__ = "route_stations"
    id         = Column(Integer, primary_key=True)
    route_id   = Column(Integer, ForeignKey("routes.id"))
    station_id = Column(Integer, ForeignKey("stations.id"))
    seq        = Column(Integer)
    UniqueConstraint("route_id", "seq")

class Vehicle(Base):
    __tablename__ = "vehicles"
    id    = Column(Integer, primary_key=True)
    plate = Column(String, unique=True, nullable=False)

class VehiclePos(Base):
    __tablename__ = "vehicle_positions"
    id          = Column(Integer, primary_key=True)
    ts          = Column(DateTime, index=True)
    vehicle_id  = Column(Integer, ForeignKey("vehicles.id"))
    route_id    = Column(Integer, ForeignKey("routes.id"))
    station_id  = Column(Integer, ForeignKey("stations.id"))
    speed_kmh   = Column(Float, nullable=True)
    location    = Column(String)

class StationTrip(Base):
    __tablename__ = "station_trips"
    id            = Column(Integer, primary_key=True)
    route_id      = Column(Integer, ForeignKey("routes.id"))
    vehicle_id    = Column(Integer, ForeignKey("vehicles.id"))
    from_station  = Column(Integer, ForeignKey("stations.id"))
    to_station    = Column(Integer, ForeignKey("stations.id"))
    ts_start      = Column(DateTime)
    ts_end        = Column(DateTime)
    travel_sec    = Column(Integer)

Base.metadata.create_all(engine)

def init_static():
    db = SessionLocal()
    try:
        for rc, seqs in ROUTE_STATIONS.items():
            route = db.query(Route).filter_by(code=rc).first() or Route(code=rc)
            db.add(route); db.flush()
            for idx, s in enumerate(seqs):
                st = db.query(Station).filter_by(code=s).first() or Station(code=s)
                db.add(st); db.flush()
                if not db.query(RouteStation)\
                        .filter_by(route_id=route.id, seq=idx).first():
                    db.add(RouteStation(route_id=route.id, station_id=st.id, seq=idx))
        db.commit()
    finally:
        db.close()
init_static()

# ─── 工具函数 ──────────────────────────────────
_speed_re = re.compile(r"\d+(?:\.\d+)?")
def parse_speed(raw: str):
    m = _speed_re.search(raw)
    return float(m.group()) if m else None

def norm_code(raw: str) -> str:
    """M61/2-二龍喉公園 → M61/2"""
    m = re.match(r"[A-Za-z0-9/\.]+", raw.strip())
    return m.group(0) if m else raw.strip()

# ─── 后台轮询线程 ──────────────────────────────
last_station = {}          # vehicle_id -> (station_id, ts)
MAX_TRAVEL_TIME = 20 * 60  # 20 分钟，单位为秒。你可以根据需要修改此值

def process_batch(records):
    db = SessionLocal()
    try:
        for r in records:
            veh = db.query(Vehicle).filter_by(plate=r["plate_number"]).first()
            if not veh:
                veh = Vehicle(plate=r["plate_number"]); db.add(veh); db.flush()

            route = db.query(Route).filter_by(code=r["route"]).first()
            code  = norm_code(r["station_name"])
            st = db.query(Station).filter_by(code=code).first()
            if not st:
                st = Station(code=code); db.add(st); db.flush()

            ts = datetime.datetime.strptime(r["timestamp"], "%Y-%m-%d %H:%M:%S")

            db.add(VehiclePos(
                ts=ts, vehicle_id=veh.id, route_id=route.id,
                station_id=st.id, speed_kmh=parse_speed(r["speed"]),
                location=r["location"]
            ))

            last = last_station.get(veh.id)
            if last and last[0] != st.id:
                travel_sec = int((ts - last[1]).total_seconds())

                # 如果 travel_sec 大于阈值（20分钟），跳过当前的写入
                if travel_sec > MAX_TRAVEL_TIME:
                    print(f"Skipping trip due to high travel time: {travel_sec} seconds")
                    continue  # 跳过本次记录

                db.add(StationTrip(
                    route_id=route.id, vehicle_id=veh.id,
                    from_station=last[0], to_station=st.id,
                    ts_start=last[1], ts_end=ts,
                    travel_sec=travel_sec
                ))
            last_station[veh.id] = (st.id, ts)
        db.commit()
    finally:
        db.close()

def poll_loop():
    while True:
        try:
            resp = requests.get(SRC_API, timeout=5); resp.raise_for_status()
            all_records = [x for sub in resp.json().values() for x in sub]
            process_batch(all_records)
            print(f"[{datetime.datetime.now():%H:%M:%S}] inserted {len(all_records)} recs")
        except Exception as e:
            print("poll error:", e)
        time.sleep(POLL_SEC)

threading.Thread(target=poll_loop, daemon=True).start()

# ─── Flask APIs ────────────────────────────────
app = Flask(__name__)

@app.route("/live")
def live():
    """
    转发 Bus API 的 /vehicle-info 接口，
    返回每条线路下当前所有车辆的详情，包括：
      - location
      - plate_number
      - route
      - speed
      - station_name
      - timestamp
    """
    try:
        resp = requests.get(SRC_API, timeout=5)
        resp.raise_for_status()
        # 直接把上游返回的 JSON 结构原样透传
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/segment-time")
def segment_time():
    route_code = request.args.get("route")
    start_code = norm_code(request.args.get("start",""))
    end_code   = norm_code(request.args.get("end",""))
    if not (route_code and start_code and end_code):
        return jsonify({"error":"need route,start,end"}), 400

    db = SessionLocal()
    try:
        route   = db.query(Route).filter_by(code=route_code).first()
        start_s = db.query(Station).filter_by(code=start_code).first()
        end_s   = db.query(Station).filter_by(code=end_code).first()
        if not (route and start_s and end_s):
            return jsonify({"error":"invalid code"}), 400

        trips = (db.query(StationTrip.travel_sec)
                   .filter_by(route_id=route.id,
                              from_station=start_s.id,
                              to_station=end_s.id)
                   .order_by(StationTrip.ts_end.desc())
                   .limit(4).all())
        if not trips:
            return jsonify({"avg_sec": None, "samples": 0})

        avg = sum(t.travel_sec for t in trips) / len(trips)
        return jsonify({"avg_sec": round(avg, 1), "samples": len(trips)})
    finally:
        db.close()

# ─── 启动服务器 ──────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)
