// 公交API服务模块
import { API_BASE_URL, ROUTE_STATIONS } from '../config/api.config.js';
import { proxyRequest } from '@/utils/proxy.js';

/**
 * 获取两站之间的预计时间
 */
export const getBetweenTime = async function(route, start, end) {
  try {
    console.log(`获取站点间隔: ${route} 从 ${start} 到 ${end}`);
    const url = `${API_BASE_URL}/between-time`;

    try {
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: {
          route: route,
          start: start,
          end: end
        },
        header: {
          'content-type': 'application/json'
        }
      });

      if (res && res.data && res.data.total_avg_sec) {
        const app = getApp();
        if (app && app.globalData) {
          // 缓存结果
          if (!app.globalData.cache.segmentTimes[route]) {
            app.globalData.cache.segmentTimes[route] = {};
          }
          app.globalData.cache.segmentTimes[route][`${start}-${end}`] = res.data.total_avg_sec;
        }
        return res.data.total_avg_sec;
      } else {
        console.error('获取站间时间失败: 无效响应数据', res);
        return 15;  // 默认15秒
      }
    } catch (apiError) {
      console.error('获取站间时间请求失败:', apiError);
      return 15;  // 默认15秒
    }
  } catch (error) {
    console.error('getBetweenTime函数执行错误:', error);
    return 15;  // 默认15秒
  }
};

/**
 * 获取最近车辆
 */
export const getNearestVehicle = async function(route, stationId) {
  try {
    const url = `${API_BASE_URL}/nearest`;
    
    try {
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: {
          route: route,
          target: stationId
        },
        header: {
          'content-type': 'application/json'
        }
      });
      
      if (res && res.data && res.data.location) {
        const app = getApp();
        if (app && app.globalData) {
          // 缓存结果
          if (!app.globalData.cache.vehicles[route]) {
            app.globalData.cache.vehicles[route] = {};
          }
          app.globalData.cache.vehicles[route][stationId] = res.data;
        }
        return res.data;
      } else {
        console.error('获取最近车辆失败: 无效响应数据', res);
        return { vehicle: [], stations: [] };
      }
    } catch (apiError) {
      console.error('获取最近车辆请求失败:', apiError);
      return { vehicle: [], stations: [] };
    }
  } catch (error) {
    console.error('getNearestVehicle函数执行错误:', error);
    return { vehicle: [], stations: [] };
  }
};

/**
 * 获取车辆信息
 */
export const getVehicleInfo = async function(route) {
  try {
    const url = `${API_BASE_URL}/vehicle-info`;
    
    try {
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: {
          route
        },
        header: {
          'content-type': 'application/json'
        }
      });
      
      if (res && res.data && res.data.data) {
        return res.data.data;
      } else {
        console.error('获取车辆信息失败: 无效响应数据', res);
        return {};
      }
    } catch (apiError) {
      console.error('获取车辆信息请求失败:', apiError);
      return {};
    }
  } catch (error) {
    console.error('getVehicleInfo函数执行错误:', error);
    return {};
  }
};

/**
 * 获取特定小时的车辆
 */
export const getHourlyVehicles = async function(route, hour) {
  try {
    const url = `${API_BASE_URL}/hourly`;
    
    try {
      const res = await proxyRequest({
        url,
        method: 'GET',
        data: {
          route,
          hour
        },
        header: {
          'content-type': 'application/json'
        }
      });
      
      if (res && res.data && res.data.data) {
        return res.data.data;
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
