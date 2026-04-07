// 公交API服务模块
import { API_BASE_URL, ROUTE_STATIONS, USE_MOCK_DATA } from '../config/api.config.js';
import { proxyRequest } from '@/utils/proxy.js';


/**
 * 获取路线的所有站点
 */
export const getRouteStations = async function(route) {
  // 直接从配置中获取站点数据
  if (ROUTE_STATIONS[route]) {
    return ROUTE_STATIONS[route];
  }
  // 如果配置中没有，返回空数组
  return [];
};

/**
 * 获取两站之间的预计时间
 * API文档: /between-time?route=25&start=M1/12&end=M7/3
 */
export const getBetweenTime = async function(route, start, end) {
  try {
    console.log(`获取站点间隔: ${route} 从 ${start} 到 ${end}`);
    const url = `${API_BASE_URL}/between-time`;

    try {
      // 根据API文档构建请求
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: {
          route,
          start,
          end
        },
        header: {
          'content-type': 'application/json'
        }
      });

      if (res && res.data) {
        // API响应直接包含total_avg_sec
        console.log('获取到站间时间数据:', res.data);
        
        const app = getApp();
        if (app && app.globalData) {
          // 缓存结果
          if (!app.globalData.cache.segmentTimes[route]) {
            app.globalData.cache.segmentTimes[route] = {};
          }
          app.globalData.cache.segmentTimes[route][`${start}-${end}`] = res.data;
        }
        
        // 检查API错误信息
        if (res.data.error) {
          console.warn('API警告:', res.data.error);
          // 如果数据不足，返回默认值
          return { total_avg_sec: 60 };
        }
        
        // 正常返回数据
        return { total_avg_sec: res.data.total_avg_sec || 60 };
      } else {
        console.error('获取站间时间失败: 无效响应数据', res);
        return { total_avg_sec: 60 };  // 默认60秒
      }
    } catch (apiError) {
      console.error('获取站间时间请求失败:', apiError);
      return { total_avg_sec: 60 };  // 默认60秒
    }
  } catch (error) {
    console.error('getBetweenTime函数执行错误:', error);
    return { total_avg_sec: 60 };  // 默认60秒
  }
};

/**
 * 获取最近车辆
 * API文档: /nearest?route=25&target=M1/12
 */
export const getNearestVehicle = async function(route, target) {
  try {
    console.log(`获取最近车辆信息, 路线: ${route}, 目标站点: ${target}`);
    const url = `${API_BASE_URL}/nearest`;
    
    try {
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: {
          route,
          target
        },
        header: {
          'content-type': 'application/json'
        }
      });
      
      if (res && res.data) {
        console.log('API返回最近车辆数据:', res.data);
        
        // 检查API是否返回了错误信息
        if (res.data.error) {
          console.warn('API返回错误:', res.data.error);
          // 标记为无可用车辆，而不是使用模拟数据
          return { 
            no_vehicle: true,
            error: res.data.error,
            message: "暂无合适车辆"
          };
        }
        
        // API可能直接返回车辆数据，而不是嵌套在vehicle属性中
        if (res.data.vehicle) {
          return res.data.vehicle;
        } else if (res.data.eta_sec !== undefined) {
          // 数据直接在顶层
          return res.data;
        } else if (typeof res.data === 'object' && Object.keys(res.data).length > 0) {
          // 其他格式的有效数据
          console.log('使用备选格式解析车辆数据');
          return res.data;
        }
        
        // 如果返回格式不匹配，标记为无可用车辆
        console.warn('API返回数据格式无法识别', res.data);
        return { 
          no_vehicle: true,
          message: "暂无合适车辆" 
        };
      } else {
        console.error('获取最近车辆失败: 无效响应数据', res);
        return { 
          no_vehicle: true,
          message: "暂无合适车辆" 
        };
      }
    } catch (apiError) {
      console.error('获取最近车辆请求失败:', apiError);
      return { 
        no_vehicle: true,
        message: "暂无合适车辆" 
      };
    }
  } catch (error) {
    console.error('getNearestVehicle函数执行错误:', error);
    return { 
      no_vehicle: true,
      message: "暂无合适车辆" 
    };
  }
};

/**
 * 获取车辆信息
 * API端点: http://123.207.198.208:9000/live
 */
export const getVehicleInfo = async function(route) {
  try {
    console.log(`开始获取车辆信息，路线: ${route}`);
    const url = `${API_BASE_URL}/live`;
    
    try {
      // 使用proxyRequest替代fetch
      const res = await proxyRequest({
        url,
        method: 'GET',
        header: {
          'content-type': 'application/json'
        }
      });
      
      if (res && res.data) {
        const allRoutesData = res.data;
        console.log('获取到所有路线车辆信息:', allRoutesData);
        
        // 从响应中提取特定路线的车辆数据
        if (allRoutesData && allRoutesData[route] && Array.isArray(allRoutesData[route])) {
          const vehicles = allRoutesData[route];
          console.log(`获取到${route}路线的车辆信息:`, vehicles);
          
          // 将API返回的数据格式转换为应用需要的格式
          return vehicles.map(vehicle => ({
            plate_number: vehicle.plate_number || "未知车辆",
            location: vehicle.location || "",
            // 解析速度值，可能是"xx km/h"或"即將發車"等格式
            speed: vehicle.speed ? (
              isNaN(parseInt(vehicle.speed)) ? 
              vehicle.speed : 
              parseInt(vehicle.speed)
            ) : 0,
            // 从station_name中提取站点名称
            station_name: vehicle.station_name || "",
            timestamp: vehicle.timestamp || "",
            status: vehicle.speed === "即將發車" ? "inactive" : "active"
          }));
        } else {
          console.error('返回数据中没有找到路线信息:', route);
          return { error: true, message: `无法获取路线${route}的车辆数据` };
        }
      } else {
        console.error('获取车辆信息失败, 无效响应数据');
        return { error: true, message: `API请求返回无效数据` };
      }
    } catch (apiError) {
      console.error('获取车辆信息请求失败:', apiError);
      return { error: true, message: '网络请求失败，请检查网络连接' };
    }
  } catch (error) {
    console.error('getVehicleInfo函数执行错误:', error);
    return { error: true, message: '获取车辆数据时发生错误' };
  }
};

/**
 * 获取特定小时的车辆
 * API文档: /hourly?route=25&hour=2025-04-21T13
 */
export const getHourlyVehicles = async function(route, hour) {
  try {
    const url = `${API_BASE_URL}/hourly`;
    
    // 格式化hour参数为API需要的格式 (YYYY-MM-DDThh)
    const now = new Date();
    const formattedHour = hour || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}`;
    
    try {
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: {
          route,
          hour: formattedHour
        },
        header: {
          'content-type': 'application/json'
        }
      });
      
      if (res && res.data) {
        // API返回值是包含站点间平均时间的数组
        console.log('获取到小时车辆数据:', res.data);
        return res.data; // 数组，每项包含start、end和avg_sec
      } else {
        console.error('获取特定小时的车辆失败: 无效响应数据', res);
        return [];
      }
    } catch (apiError) {
      console.error('获取特定小时的车辆请求失败:', apiError);
      return [];
    }
  } catch (error) {
    console.error('getHourlyVehicles函数执行错误:', error);
    return [];
  }
};

/**
 * 获取整个路线所有相邻站点之间的预计时间
 * API端点: http://123.207.198.208:9000/getInformation?route=25
 */
export const getRouteInformation = async function(route) {
  try {
    console.log(`获取整个路线信息: ${route}`);
    const url = `${API_BASE_URL}/getInformation`;
    
    try {
      // 使用proxyRequest替代fetch
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: { route },
        header: {
          'content-type': 'application/json'
        }
      });
      
      if (res && res.data) {
        const segmentTimes = res.data;
        console.log(`获取到${route}路线的全部站点间隔信息:`, segmentTimes);
        
        // 返回包含所有站点间隔时间的数组
        return segmentTimes;
      } else {
        console.error('获取路线信息失败, 无效响应数据');
        return [];
      }
    } catch (apiError) {
      console.error('获取路线信息请求失败:', apiError);
      return [];
    }
  } catch (error) {
    console.error('getRouteInformation函数执行错误:', error);
    return [];
  }
}; 