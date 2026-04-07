# **`smart_api.py` 调用文档**

本文件是一个用于提供公交相关数据的 API 服务，通过 Flask 框架实现。其主要功能包括获取站点间预计时间、获取最近车辆、获取车辆信息等。以下是如何调用 `smart_api.py` 中的 API 服务的详细说明。

## **API 概述**

### **1. 获取两站之间的预计时间**
#### **接口地址**：`/between-time`
#### **请求方式**：`GET`
#### **参数**：
- `route`：公交路线编号（例如 `"25"`）
- `start`：起始站点编号（例如 `"M1/12"`）
- `end`：目标站点编号（例如 `"M7/3"`）

#### **请求示例**：
```bash
GET http://<smart_api_host>/between-time?route=25&start=M1/12&end=M7/3
```

#### **返回示例**：
```json
{
  "total_avg_sec": 12.5
}
```

#### **返回字段说明**：
- `total_avg_sec`：从 `start` 到 `end` 站点之间的预计时间，单位为秒。

### **2. 获取最近车辆信息**
#### **接口地址**：`/nearest`
#### **请求方式**：`GET`
#### **参数**：
- `route`：公交路线编号（例如 `"25"`）
- `target`：目标站点编号（例如 `"M1/12"`）

#### **请求示例**：
```bash
GET http://<smart_api_host>/nearest?route=25&target=M1/12
```

#### **返回示例**：
```json
{
  "vehicle": {
    "plate_number": "AB4951",
    "location": "M1/12",
    "eta_sec": 120,
    "hops": 3
  },
  "stations": ["M1/12", "M7/3", "M10/1"]
}
```

#### **返回字段说明**：
- `vehicle`：
  - `plate_number`：车辆编号。
  - `location`：车辆当前所在站点。
  - `eta_sec`：预计到达目标站点所需时间，单位为秒。
  - `hops`：从当前车辆所在站点到目标站点的跳跃站数（经过的站点数）。
- `stations`：包含从当前站点到目标站点的所有站点名称。

### **3. 获取车辆信息**
#### **接口地址**：`/vehicle-info`
#### **请求方式**：`GET`
#### **参数**：
- `route`：公交路线编号（例如 `"25"`）

#### **请求示例**：
```bash
GET http://<smart_api_host>/vehicle-info?route=25
```

#### **返回示例**：
```json
{
  "vehicles": [
    {
      "plate_number": "AB4951",
      "status": "active",
      "location": "M1/12",
      "speed_kmh": 40.0
    },
    {
      "plate_number": "CD1023",
      "status": "inactive",
      "location": "M5/1",
      "speed_kmh": 0.0
    }
  ]
}
```

#### **返回字段说明**：
- `vehicles`：包含此路线下所有车辆的信息。
  - `plate_number`：车辆编号。
  - `status`：车辆状态（`active` 或 `inactive`）。
  - `location`：车辆当前所在站点。
  - `speed_kmh`：车辆当前速度，单位为公里每小时（km/h）。

### **4. 获取特定小时的车辆信息**
#### **接口地址**：`/hourly`
#### **请求方式**：`GET`
#### **参数**：
- `route`：公交路线编号（例如 `"25"`）
- `hour`：查询小时（例如 `"2025-04-21T13"`）

#### **请求示例**：
```bash
GET http://<smart_api_host>/hourly?route=25&hour=2025-04-21T13
```

#### **返回示例**：
```json
[
  {
    "start": "M1/12",
    "end": "M7/3",
    "avg_sec": 15.3
  },
  {
    "start": "M7/3",
    "end": "M10/1",
    "avg_sec": 13.5
  }
]
```

#### **返回字段说明**：
- `start`：起始站点名称。
- `end`：目标站点名称。
- `avg_sec`：站点间平均时间，单位为秒。

---

## **如何调用 API**

### **1. 运行 `smart_api.py`**

1. 确保你已经安装了 Python 和相关依赖。执行以下命令安装必要的库：
   ```bash
   pip install flask flask_cors requests apscheduler sqlalchemy
   ```

2. 确保数据库 `smart.db` 存在并且已经初始化。如果没有数据库，`smart_api.py` 会在运行时自动创建。

3. 在终端中运行 `smart_api.py`：
   ```bash
   python smart_api.py
   ```

4. `smart_api.py` 将开始在 `http://0.0.0.0:9000` 上监听请求。

### **2. 配置前端请求**

假设前端应用使用 `JavaScript` 和 `uniapp` 或类似框架，您可以通过 HTTP 请求调用以上 API 服务。

#### **示例调用（JavaScript）**：

```javascript
// 获取两站之间的预计时间
const route = "25";
const start = "M1/12";
const end = "M7/3";
const result = await fetch(`${API_BASE_URL}/between-time?route=${route}&start=${start}&end=${end}`);
const data = await result.json();
console.log(data.total_avg_sec);  // 获取到的预计时间

// 获取最近车辆
const nearestVehicle = await fetch(`${API_BASE_URL}/nearest?route=${route}&target=${start}`);
const nearestData = await nearestVehicle.json();
console.log(nearestData);  // 获取到的最近车辆信息
```

### **3. 跨域支持 (CORS)**

为了避免跨域问题，我们在 `smart_api.py` 中已经添加了 `Flask-CORS`，这使得不同域的前端应用可以访问该 API 服务。默认允许所有域发起请求。

如果需要更细粒度的跨域控制，可以在代码中配置允许特定域名访问：

```python
CORS(app, origins=["http://localhost:5173", "http://example.com"])
```

---

## **错误处理与调试**

在调用 API 时，可能会遇到以下错误：

### **1. 网络请求失败**
如果 API 请求失败，服务器会返回 500 错误，并且会在日志中记录详细信息。例如：
```json
{
  "error": "Internal Server Error"
}
```

### **2. 参数错误**
如果请求中缺少必要参数（如 `route`、`start` 或 `end`），API 会返回 400 错误，并在响应中包含错误信息：
```json
{
  "error": "need route,start,end"
}
```

### **3. 数据不可用**
如果请求的站点数据无法计算（例如，数据缺失），API 会返回一个默认值，并在响应中标明错误：
```json
{
  "avg_sec": null,
  "error": "insufficient data"
}
```

---

## **结论**

这个 `smart_api.py` 服务通过 Flask 提供了多种公交数据的查询功能，支持获取站点间预计时间、获取最近车辆、获取车辆信息等。通过添加 CORS 支持，确保跨域请求不会被浏览器拦截。只需要正确调用相应的 API 路径和参数，便可获得所需的公交数据。

如果在使用过程中遇到任何问题，您可以通过查看返回的错误信息进行排查，或者查看服务器端日志。