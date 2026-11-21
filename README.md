# SmartBus · 澳门巴士到站预测

澳门官方“巴士报站”只告诉你车在哪个站，不告诉你**几时到**。SmartBus 持续记录全澳每辆巴士的行驶轨迹，
用历史行车时间 + 实时路况，预测巴士到达每个站的时间（连同可信范围）。

这是旧版（`Old/`，uni-app + Selenium + 三层 Flask）的完全重写。

## 特点

- **纯 HTTP 采集，不用浏览器**：逆向了 DSAT 网页接口的签名（MD5 + 时间戳），直接请求 JSON。
  资源占用比 Selenium 低几个数量级，预设覆盖**全部路线**。
- **自适应轮询 + 全局限速**：有车的路线约每 10 秒一次，没车的降到 90 秒；总请求数不超过 8 次/秒。
- **里程碑追踪**：每辆车的进度拆成“到达 / 离开”交替的里程碑，两次轮询间跨越多个站时按预期时长分配时间。
  模拟测试中，10 秒轮询下站间时间的平均误差约 3 秒。
- **分段、分时段、分日子类型的历史模型**：停站时间与行驶时间分开建模；相同两站之间的数据跨路线共享；
  14 分钟高斯核平滑、近期加权、加权分位数（抗异常值）、数据不足时收缩到先验。
- **实时路况修正**：最近 45 分钟的实际行驶比历史快/慢，会修正前方路段，并随预测距离衰减。
- **带范围的预测 + 在线回测**：每分钟记录预测，车到站后自动对比，在“数据”页面显示真实准确度。
- **Web 前端**：零依赖原生 JS，手机 / 电脑自适应，深浅色模式，可“加到主画面”。

## 功能

| 页面 | 内容 |
| --- | --- |
| 首页 | 搜寻路线 / 站点、收藏（含实时到站）、附近站点（定位）、全部路线 |
| 路线 | 实时站点时间线（车辆动画、每站下两班车 ETA、路况着色）、路线示意地图 |
| 站点详情 | 未来几班车 + 可信范围、出门提醒（按步行时间）、班次密度、此站其他路线 |
| 行程 | A 站 → B 站所有直达路线，按实时预计到达时间排序 |
| 行程规划 | 现在出发的候车 + 乘车 + 到达时间；**按历史时间**查询任意日子类型 / 时刻的乘车时间曲线；“要在 X 点前到达，最晚几点上车” |
| 洞察 | 全程行车时间随时段变化、逐段 × 逐小时挤塞热图 |
| 数据 | 采集状态、样本量、预测准确度、算法说明 |

## 运行

需要 Python 3.10+。

```bash
pip install -r requirements.txt
cd server
python -m smartbus
```

打开 <http://localhost:8080>。首次启动会先下载全部路线与站点（约 1 分钟），之后开始采集。
**预测质素随数据累积提升**：刚开始只有按距离推算的先验，运行一两天后历史模型就会生效，跑满一周后工作日 / 周末的分别也会出来。

采集器与网页在同一个进程里；要长期累积数据，请放在一台长开的服务器上。

### 设定（环境变量）

| 变量 | 预设 | 说明 |
| --- | --- | --- |
| `SMARTBUS_PORT` | `8080` | 监听端口 |
| `SMARTBUS_ROUTES` | `all` | 采集哪些路线，例如 `25,25B,23,28B` |
| `SMARTBUS_POLL_ACTIVE_SEC` | `10` | 有车路线的轮询间隔 |
| `SMARTBUS_POLL_IDLE_SEC` | `90` | 无车路线的轮询间隔 |
| `SMARTBUS_MAX_RPS` | `8` | 对 DSAT 的最大请求速率 |
| `SMARTBUS_RETENTION_DAYS` | `60` | 数据保留日数（自动清理） |
| `SMARTBUS_DATA_DIR` | `./data` | SQLite 数据库位置 |
| `SMARTBUS_COLLECT` | `true` | 设为 `false` 则只提供查询 |

### Linux 长期运行（systemd 范例）

```ini
[Unit]
Description=SmartBus
After=network-online.target

[Service]
WorkingDirectory=/opt/SmartBus/server
ExecStart=/usr/bin/python3 -m smartbus
Restart=always
Environment=SMARTBUS_PORT=8080

[Install]
WantedBy=multi-user.target
```

## 结构

```
server/smartbus/
  dsat.py       DSAT 接口客户端（签名、限速）
  collector.py  轮询、车辆追踪、到站 / 离站事件、在线回测
  model.py      行车时间模型与 ETA 链式预测
  history.py    班次密度、挤塞热图、统计
  api.py        HTTP API（/api/docs 有自动文档）+ 静态网页
  db.py         SQLite（WAL）
web/            前端（原生 ES modules，无需构建）
Old/            旧版代码（仅供参考）
```

数据来源：澳门交通事务局 巴士报站。本项目为个人学习用途，请合理控制请求频率。
