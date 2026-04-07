## SmartBus（智能公交助手）

一个基于 **uni-app** 的多端公交信息展示应用，配套 **Python/Flask** 后端提供实时车辆与站点间耗时等 API。

这是很久之前的一个练手项目，最近又翻出来，于是发在GitHub上面保存一下。也希望可以给大家提供一些思路。
在澳门，官方的公交车软件只能看到车在哪里，但是无法看到具体的时间。所以我们很难规划出门时间，尤其是高峰期时候，提前出门意味着需要在公交站等待更多的时间。所以我做了这个服务，用来计算公交车走过每一站需要的时间。
这个本来是要做微信小程序的，所以我前端使用了 **uni-app** 做开发，这个可以很方便的把写好的代码转换成微信小程序或者h5页面。

后端部分主要是 **Python/Flask** ，这个flask是之前学长给我推荐的，很方便，我很喜欢，所以在这之后我就一直使用这个框架作为后端。
数据库写的很乱，并且没有按时清除过期数据，所以如果使用时间长了数据库会很大，所以建议加一个定期删除无用数据的功能。
整个后端写的比较乱，我把服务拆分成了很多部分。一些是使用 **selenium** 用来从网页获取公交数据的，我尝试过直接request获取，尝试了很多方法但是失败了，所以用这个最普通的方法。也是由于我使用了 **selenium** ，导致需要获取的公交线路一多，资源占用就会很高。这个API跑在5000端口。然后从第一个API轮询获取数据，存入数据库，并且计算segment-time，并且开放端口给下一个后端。然后SmartAPI是从第二个API获取数据，计算其他信息（比如任意两站之间的时间，最近车辆等），并且提供服务给前端。
把后端拆成很多部分的原因
1.数据库太乱了，导致存数据库的哪个服务容易炸，分开每次只用修一部分
2.我无法成功使用request获取数据，所以使用了selenium，但是这样的资源占用很高，线路多了容易炸，分开每次只用修一部分

这几个后端的命名比较乱，是我在开发的时候，不断备份的结果，我在这里做出简单的解释：
1.第一个服务 API/test16.py ，跑在端口5000，抓取公交数据，提供 GET /vehicle-info 给下一个服务
2.第二个服务 API/data6.py ，跑在端口8000， 从第一个服务获取数据存入数据库，做一些简单的计算，提供服务给下一个服务
3.第三个服务 API/smart_api5.py ，跑在端口9000， 这是业务层，直接与前端交互。


## 技术栈

### 前端
- **uni-app + Vue 3**
- **Vite**
- 请求：`uni.request`（项目内做了简单封装）

### 后端（Python / Flask，三层 API 递进）
后端在 `API/` 目录下，分为三层服务（从底到顶）：

- **采集层（5000）**：`API/test16.py`
  - 技术：Selenium + Headless Chrome
  - 功能：抓取上游网页公交数据，提供 `GET /vehicle-info`

- **数据层（8000）**：`API/data6.py`
  - 技术：Flask + Requests + SQLAlchemy + SQLite（`bus.db`）
  - 功能：轮询采集层数据并落库；提供 `GET /live`（透传）与 `GET /segment-time`（相邻站段平均耗时）

- **业务层（9000）**：`API/smart_api5.py`
  - 技术：Flask + Flask-CORS + Requests + APScheduler + SQLAlchemy + SQLite（`smart.db`）
  - 功能：聚合数据层能力，对前端提供：
    - `GET /between-time`（任意两站预计时间）
    - `GET /nearest`（最近车辆与 ETA）
    - `GET /hourly`（小时级拥堵/耗时聚合）
    - `GET /getInformation`（整条线路相邻站段信息）

## 目录结构（简要）
```
SmartBus/
  src/                 前端代码
  API/                 后端三层服务
  index.html
  package.json
```

## 本地运行（简要）

### 前端
```bash
npm install
npm run dev:h5
```

### 后端
按层启动（建议从下到上）：
```bash
python API/test16.py     # 5000
python API/data6.py      # 8000
python API/smart_api5.py # 9000
```

> 提示：后端依赖可按需安装，例如 `Flask`、`requests`、`SQLAlchemy`、`flask-cors`、`APScheduler`、`selenium` 等。

---

## SmartBus (English)

SmartBus is a **uni-app** based, multi-platform bus information app. It comes with a **Python/Flask** backend that provides APIs for real-time vehicles and estimated travel time between stops.

This was an old practice project that I recently found again, so I’m uploading it to GitHub for archiving. Hopefully it can also give others some ideas.

In Macau, the official bus app can only show where the bus is, but not the **actual time**. That makes it hard to plan when to leave, especially during rush hours—leaving early often means waiting at the stop for longer. So I built this service to estimate how long a bus takes to travel **from stop to stop**.

I originally planned to make a WeChat Mini Program, so the frontend is developed with **uni-app**, which makes it easy to compile the same codebase to a Mini Program or an H5 web page.

The backend is mainly **Python/Flask**. Flask was recommended to me by a senior and I really like it, so I’ve kept using it as my backend framework ever since.

The database part is messy, and I didn’t regularly purge expired data. If you run it for a long time, the database can grow very large, so it’s recommended to add a scheduled cleanup job to remove unnecessary data.

Overall, the backend code is also quite messy. I split the service into multiple parts. Some of them use **Selenium** to fetch bus data from a webpage. I tried many ways to fetch it with plain HTTP requests but failed, so I ended up using the most straightforward approach. Because it relies on Selenium, if you add more routes, resource usage can become high. This collector API runs on port **5000**. Then a second API polls data from the first one, stores it into a database, computes `segment-time`, and exposes endpoints for the next backend layer. Finally, the Smart API fetches from the second API, computes higher-level results (e.g., time between any two stops, nearest vehicle), and serves the frontend.

Why I split the backend into multiple parts:
1. The database design is messy; the service that writes to the DB is the easiest to break, so splitting it makes it easier to fix one part at a time.
2. I couldn’t successfully fetch the data with plain requests, so I used Selenium. This uses a lot of resources and can easily break when you track more routes—splitting it still makes it easier to fix one part at a time.

The backend filenames are a bit confusing because I kept backing up files during development. Here’s a simple mapping:
1. **Service 1**: `API/test16.py` (port **5000**) — collects bus data and provides `GET /vehicle-info` to the next service.
2. **Service 2**: `API/data6.py` (port **8000**) — polls Service 1, stores data into the database, does some basic computations, and provides APIs to the next service.
3. **Service 3**: `API/smart_api5.py` (port **9000**) — the business layer that interacts directly with the frontend.

## Tech Stack

### Frontend
- **uni-app + Vue 3**
- **Vite**
- Networking: `uni.request` (a small wrapper is included in this project)

### Backend (Python / Flask, 3-layer APIs)
Backend services live in `API/`, organized as three layers (bottom to top):

- **Collector layer (5000)**: `API/test16.py`
  - Tech: Selenium + Headless Chrome
  - What it does: scrapes upstream bus data and exposes `GET /vehicle-info`

- **Data layer (8000)**: `API/data6.py`
  - Tech: Flask + Requests + SQLAlchemy + SQLite (`bus.db`)
  - What it does: polls the collector and stores data; provides `GET /live` (proxy) and `GET /segment-time` (average travel time for adjacent stop segments)

- **Business layer (9000)**: `API/smart_api5.py`
  - Tech: Flask + Flask-CORS + Requests + APScheduler + SQLAlchemy + SQLite (`smart.db`)
  - What it does: aggregates data-layer capabilities and provides:
    - `GET /between-time` (ETA between any two stops)
    - `GET /nearest` (nearest vehicle and ETA)
    - `GET /hourly` (hourly aggregated congestion / travel time)
    - `GET /getInformation` (adjacent segment info for a whole route)

## Project Structure (brief)
```
SmartBus/
  src/                 frontend code
  API/                 backend (3 layers)
  index.html
  package.json
```

## Run Locally (brief)

### Frontend
```bash
npm install
npm run dev:h5
```

### Backend
Start services layer by layer (recommended order: bottom to top):
```bash
python API/test16.py     # 5000
python API/data6.py      # 8000
python API/smart_api5.py # 9000
```

> Note: Install backend dependencies as needed, e.g. `Flask`, `requests`, `SQLAlchemy`, `flask-cors`, `APScheduler`, `selenium`, etc.
