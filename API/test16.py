import time, threading, tempfile, datetime
from flask import Flask, jsonify
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.common.exceptions import StaleElementReferenceException
from webdriver_manager.chrome import ChromeDriverManager

# ---------- Flask ----------
app = Flask(__name__)
vehicle_data = {r: [] for r in ["23", "25", "28B", "25B"]}

# ---------- 常量 ----------
ROUTE_URLS = {
    "23":  "https://bis.dsat.gov.mo:37812/macauweb/routeLine.html?routeName=23&direction=0&language=zh-tw&ver=3.7.3&routeType=2&fromDzzp=false",
    "25":  "https://bis.dsat.gov.mo:37812/macauweb/routeLine.html?routeName=25&direction=0&language=zh-tw&ver=3.7.3&routeType=2&fromDzzp=false",
    "28B": "https://bis.dsat.gov.mo:37812/macauweb/routeLine.html?routeName=28B&direction=0&language=zh-tw&ver=3.7.3&routeType=2&fromDzzp=false",
    "25B": "https://bis.dsat.gov.mo:37812/macauweb/routeLine.html?routeName=25B&direction=1&language=zh-tw&ver=3.7.3&routeType=0&fromDzzp=false"
}
RESTART_SEC = 30 * 60            # 30 分钟重启浏览器一次
SCRAPE_INTERVAL = 10             # 每 10 秒抓一次

# ---------- 启动 selenium ----------
def init_driver():
    print("[Driver] starting new Chrome …")
    opts = Options()
    opts.add_argument("--headless")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-dev-shm-usage")
    user_dir = tempfile.mkdtemp()
    opts.add_argument(f"--user-data-dir={user_dir}")
    drv = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)

    handles = {}                           # route -> window handle
    drv.get("about:blank")
    root = drv.current_window_handle
    for route, url in ROUTE_URLS.items():
        drv.execute_script("window.open(arguments[0]);", url)
        time.sleep(2)
        handle = [h for h in drv.window_handles
                  if h not in handles.values() and h != root][0]
        drv.switch_to.window(handle)
        print(f"[INIT] {route} first load …")
        time.sleep(6)
        handles[route] = handle
    drv.switch_to.window(root)
    return drv, handles

driver, route_handles = init_driver()

# ---------- 采集 ----------
def scrape_one_route(route):
    driver.switch_to.window(route_handles[route])
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        elems = driver.find_elements(
            By.CSS_SELECTOR,
            "div[style*='position: relative;text-align: right;width:50px;']"
        )
        rows = []
        for v in elems:
            try:
                plate = v.find_element(By.CSS_SELECTOR, "p").text
                speed = v.find_element(By.CSS_SELECTOR,
                        "div[style*='text-align: right;']").text
                station = v.find_element(
                    By.XPATH,
                    "./ancestor::div[contains(@class, 'macau-route-station')]//h4"
                ).text
                rows.append({
                    "plate_number": plate,
                    "speed": speed,
                    "station_name": station,
                    "location": station.split("-")[0],
                    "route": route,
                    "timestamp": now_str
                })
            except StaleElementReferenceException:
                continue
        vehicle_data[route] = rows
        print(f"[{route}] {len(rows)} vehicles @ {now_str}")
    except Exception as e:
        print(f"[{route}] scrape failed:", e)

def background_update():
    global driver, route_handles
    last_restart = time.time()
    while True:
        # 重启条件
        if time.time() - last_restart > RESTART_SEC:
            try:
                driver.quit()
            except Exception:
                pass
            driver, route_handles = init_driver()
            last_restart = time.time()

        for r in ROUTE_URLS:
            scrape_one_route(r)
        time.sleep(SCRAPE_INTERVAL)

threading.Thread(target=background_update, daemon=True).start()

# ---------- Flask API ----------
@app.route('/vehicle-info')
def api_vehicle():
    return jsonify(vehicle_data)

# ---------- main ----------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
