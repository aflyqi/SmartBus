// 代理请求模块，用于解决CORS跨域问题
import { API_BASE_URL, USE_MOCK_DATA } from '../config/api.config.js';

// 创建一个通过uni.request发送请求的函数
export const proxyRequest = function(options) {
  try {
    // 获取应用实例以访问全局数据
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.loading = true;
    }
    
    // 打印请求信息
    console.log(`请求开始: ${options.url} 方法: ${options.method || 'GET'} 数据:`, options.data);
    
    // 构建完整URL
    let url = options.url;
    if (!url.startsWith('http')) {
      url = `${API_BASE_URL}${url}`;
    }
    
    // 如果是GET请求，将参数添加到URL
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && options.data && Object.keys(options.data).length > 0) {
      const params = [];
      for (const key in options.data) {
        if (options.data.hasOwnProperty(key)) {
          params.push(`${encodeURIComponent(key)}=${encodeURIComponent(options.data[key])}`);
        }
      }
      url = `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`;
    }
    
    console.log('发起请求:', url);
    
    // 使用Promise包装uni.request
    return new Promise((resolve, reject) => {
      uni.request({
        url: url,
        method: method,
        header: options.header || { 'Content-Type': 'application/json' },
        data: method !== 'GET' ? options.data : undefined,
        success: function(res) {
          console.log('请求成功:', res.statusCode, res.data);
          resolve({ data: res.data });
        },
        fail: function(err) {
          console.error('请求失败:', err);
          reject(err);
        },
        complete: function() {
          if (app && app.globalData) {
            app.globalData.loading = false;
          }
        }
      });
    });
  } catch (error) {
    console.error('proxyRequest执行错误:', error);
    return Promise.reject(error);
  }
}; 