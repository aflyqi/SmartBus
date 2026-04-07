<template>
  <view class="route-detail">
    <!-- 主体内容 -->
    <view class="main-content">
      <!-- 左侧功能区 -->
      <view class="left-panel">
        <view class="function-button" :class="{ active: isLocationSet }" @tap="setCurrentLocation">
          <text>当前位置</text>
        </view>
        <view class="function-button" :class="{ active: isAlarmActive }" @tap="toggleAlarm">
          <text>到站提醒</text>
        </view>
      </view>

      <!-- 右侧路线图 -->
      <view class="route-map">
        <view class="route-line">
          <view class="station-container" v-for="(station, index) in stations" :key="station.id">
            <!-- 站点连接线 -->
            <view class="connecting-line" v-if="index > 0 && index < stations.length">
              <text class="time-label">{{ stations[index-1].time_to_next || '--' }}s</text>
              <!-- 公交车图标(如果当前在这个区间) -->
              <image 
                v-if="station.has_bus" 
                class="bus-icon" 
                src="/static/images/bus.png" 
                mode="aspectFit"
              />
            </view>
            
            <!-- 站点圆点 -->
            <view class="station-dot" 
              :class="{ 
                'current-location': station.id === currentStationId,
                'has-vehicle': station.has_bus
              }"
            >
              <view class="inner-dot"></view>
            </view>
            
            <!-- 站点名称和ETA -->
            <view class="station-info">
              <text class="station-name">{{ extractStationName(station.station_name) || station.name || station.id }}</text>
              <view class="station-right-info">
                <text class="eta" v-if="station.eta">{{ formatTime(station.eta) }}</text>
                <text class="eta no-vehicle" v-if="station.no_vehicle">{{ station.message || '暂无合适车辆' }}</text>
                <text class="vehicle-info" v-if="station.has_bus">
                  {{ station.plate_number }} 
                  <text v-if="station.speed" class="speed-info">
                    {{ typeof station.speed === 'string' ? station.speed : `${station.speed} km/h` }}
                  </text>
                </text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted, computed, watch, onUnmounted } from 'vue';
import { getRouteStations, getNearestVehicle, getVehicleInfo, getBetweenTime, getRouteInformation } from '../../services/busApi.js';

// 获取页面参数
const routeCode = ref('');
const stations = ref([]);
const isLocationSet = ref(false);
const isAlarmActive = ref(false);
const currentStationId = ref(null);
const loadingData = ref(false);
const refreshInterval = ref(null);

// 获取URL参数
const getUrlParam = (paramName) => {
  if (typeof location !== 'undefined') {
    const urlParams = new URLSearchParams(location.search);
    return urlParams.get(paramName);
  }
  return null;
};

// 从页面参数获取路线代码
onMounted(() => {
  console.log('路线详情页加载');
  
  let routeFound = false;
  
  // 方法1：尝试从URL获取参数
  if (typeof location !== 'undefined') {
    // 从hash中获取参数
    const hashMatch = location.hash.match(/route=([^&]*)/);
    if (hashMatch && hashMatch[1]) {
      routeCode.value = decodeURIComponent(hashMatch[1]);
      console.log('从URL hash获取到路线:', routeCode.value);
      routeFound = true;
    }
    
    // 从search中获取参数
    const searchParam = getUrlParam('route');
    if (!routeFound && searchParam) {
      routeCode.value = searchParam;
      console.log('从URL search获取到路线:', routeCode.value);
      routeFound = true;
    }
  }
  
  // 方法2：尝试从uni-app页面参数获取
  if (!routeFound) {
    try {
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      const options = currentPage ? (currentPage.options || {}) : {};
      
      console.log('获取到的页面参数:', options);
      
      if (options.route) {
        routeCode.value = options.route;
        console.log('从页面参数获取到路线:', routeCode.value);
        routeFound = true;
      }
    } catch (e) {
      console.error('获取页面参数出错:', e);
    }
  }
  
  // 方法3：尝试从全局变量获取
  if (!routeFound && typeof getApp !== 'undefined') {
    try {
      const app = getApp();
      if (app && app.globalData && app.globalData.selectedRoute) {
        routeCode.value = app.globalData.selectedRoute.name;
        console.log('从全局变量获取到路线:', routeCode.value);
        routeFound = true;
      }
    } catch (e) {
      console.error('获取全局变量出错:', e);
    }
  }
  
  // 如果仍未获取到路线代码，使用默认值
  if (!routeFound || !routeCode.value) {
    routeCode.value = '23';
    console.log('使用默认路线:', routeCode.value);
  }
  
  // 设置页面标题
  uni.setNavigationBarTitle({
    title: `${routeCode.value}路公交`
  });
  
  // 获取路线数据
  fetchRouteData(routeCode.value);
  
  // 设置定时刷新，每60秒刷新一次数据
  refreshInterval.value = setInterval(() => {
    fetchRouteData(routeCode.value, true);
  }, 60000);
});

// 组件销毁时清除定时器
onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
    refreshInterval.value = null;
  }
});

// 获取路线数据
const fetchRouteData = async (route, silent = false) => {
  if (!route) {
    console.error('未提供路线代码');
    return;
  }
  
  console.log('获取路线数据:', route);
  
  if (!silent) {
    loadingData.value = true;
  }
  
  try {
    // 使用API获取站点数据
    const apiStations = await getRouteStations(route);
    
    if (apiStations && apiStations.length > 0) {
      console.log('获取到站点数据:', apiStations.length);
      stations.value = apiStations;
      
      // 获取站点之间的时间间隔
      await updateSegmentTimes(route);
      
      // 如果已设置当前位置，获取最近车辆信息
      if (currentStationId.value) {
        updateNearestVehicle(route, currentStationId.value);
      }
    } else {
      // 如果API获取失败，使用模拟数据
      console.warn('API获取站点数据失败，使用模拟数据');
      const mockStations = [
        { id: 'M205', name: 'M205', time_to_next: 15, eta: null, has_bus: false },
        { id: 'M206', name: 'M206', time_to_next: 23, eta: null, has_bus: true },
        { id: 'M207', name: 'M207', time_to_next: 15, eta: null, has_bus: false },
        { id: 'M208', name: 'M208', time_to_next: 23, eta: null, has_bus: false },
        { id: 'M209', name: 'M209', time_to_next: 15, eta: null, has_bus: false }
      ];
      stations.value = mockStations;
    }
    
    // 更新公交车位置
    await updateBusPositions(route);
    
  } catch (error) {
    console.error('获取路线数据失败:', error);
    if (!silent) {
      uni.showToast({
        title: '获取路线数据失败',
        icon: 'none'
      });
    }
  } finally {
    loadingData.value = false;
  }
};

// 更新站点之间的时间间隔
const updateSegmentTimes = async (route) => {
  try {
    if (!stations.value || stations.value.length < 2) {
      console.warn('站点数据不完整，无法更新线段时间');
      return;
    }
    
    // 首先尝试使用批量API获取所有站点间隔时间
    console.log(`尝试批量获取路线${route}的站点间隔时间`);
    const segmentTimes = await getRouteInformation(route);
    
    if (segmentTimes && Array.isArray(segmentTimes) && segmentTimes.length > 0) {
      console.log('成功获取到站点间隔时间数据:', segmentTimes.length);
      
      // 创建站点ID到索引的映射，方便查找
      const stationIndexMap = {};
      stations.value.forEach((station, index) => {
        stationIndexMap[station.id] = index;
      });
      
      // 遍历所有时间段，更新对应站点的time_to_next值
      segmentTimes.forEach(segment => {
        const { start, end, avg_sec } = segment;
        const startIndex = stationIndexMap[start];
        
        // 确保找到起始站点，更新该站点到下一个站点的时间
        if (startIndex !== undefined && avg_sec !== undefined) {
          stations.value[startIndex].time_to_next = avg_sec;
          console.log(`设置站点间隔: ${start} -> ${end}, 时间: ${avg_sec}秒`);
        }
      });
      
      // 批量获取成功，提前返回
      return;
    } else {
      console.warn('批量获取站点间隔时间失败，回退到逐个查询');
      
      // 初始化默认时间值
      stations.value.forEach(station => {
        station.time_to_next = '--';
      });
      
      // 回退到逐个查询
      await fallbackToIndividualQueries(route);
    }
  } catch (error) {
    console.error('批量获取站点间隔失败:', error);
    
    // 出错时回退到逐个查询
    try {
      await fallbackToIndividualQueries(route);
    } catch (fallbackError) {
      console.error('逐个查询站点间隔也失败:', fallbackError);
      
      // 两种方式都失败，清空所有站点时间
      stations.value.forEach(station => {
        station.time_to_next = '--';
      });
      
      // 显示错误信息
      uni.showToast({
        title: '无法获取站点间隔时间',
        icon: 'none',
        duration: 2000
      });
    }
  }
};

// 回退到逐个查询站点间隔时间
const fallbackToIndividualQueries = async (route) => {
  console.log('执行逐个查询站点间隔时间');
  
  // 遍历相邻站点
  for (let i = 0; i < stations.value.length - 1; i++) {
    const start = stations.value[i].id;
    const end = stations.value[i+1].id;
    
    if (!start || !end) {
      console.warn(`站点ID不完整: ${start} -> ${end}`);
      continue;
    }
    
    console.log(`查询站点间隔: ${route} 从 ${start} 到 ${end}`);
    
    try {
      // 调用API获取时间间隔
      const data = await getBetweenTime(route, start, end);
      
      if (data && data.total_avg_sec) {
        // 将时间设置在当前站点，表示从当前到下一站的时间
        stations.value[i].time_to_next = data.total_avg_sec;
        console.log(`获取到站点${start}到${end}的运行时间: ${data.total_avg_sec}秒`);
      } else {
        console.warn(`无法获取站点${start}到${end}的运行时间`);
        stations.value[i].time_to_next = '--';
      }
    } catch (err) {
      console.error(`获取站点间隔失败: ${start}-${end}`, err);
      stations.value[i].time_to_next = '--';
    }
  }
};

// 查询最近的车辆
const updateNearestVehicle = async (route, target) => {
  try {
    console.log(`开始查询最近车辆, 路线: ${route}, 目标站点: ${target}`);
    
    // 尝试从API获取最近车辆
    let vehicleData = null;
    
    try {
      vehicleData = await getNearestVehicle(route, target);
      console.log('获取到最近车辆数据:', vehicleData);
      
      // 更新目标站点信息
      const targetStationIndex = stations.value.findIndex(s => s.id === target);
      if (targetStationIndex >= 0) {
        // 检查是否返回了无车辆标记
        if (vehicleData && vehicleData.no_vehicle) {
          // 标记为无合适车辆
          const station = stations.value[targetStationIndex];
          station.eta = null;
          station.no_vehicle = true;
          station.message = vehicleData.message || "暂无合适车辆";
          console.log(`站点${target}暂无合适车辆`);
          return;
        }
        
        // 确保返回数据有效
        if (vehicleData && vehicleData.eta_sec !== undefined) {
          const station = stations.value[targetStationIndex];
          station.eta = vehicleData.eta_sec;
          station.no_vehicle = false; // 确保清除无车辆标记
          
          // 如果API返回了hops（经过的站数），也记录下来
          if (vehicleData.hops) {
            station.hops = vehicleData.hops;
          }
          
          console.log(`更新站点${target}的到站时间: ${vehicleData.eta_sec}秒`);
          
          // 如果开启了提醒，并且到站时间小于5分钟，显示提醒
          if (isAlarmActive.value && vehicleData.eta_sec <= 300) {
            uni.showModal({
              title: '到站提醒',
              content: `公交车将在约${Math.floor(vehicleData.eta_sec / 60)}分钟后到达，请做好准备！`,
              showCancel: false
            });
          }
          
          return; // 成功更新，提前返回
        } else {
          console.warn('API返回数据无效:', vehicleData);
          // 标记为无合适车辆
          const station = stations.value[targetStationIndex];
          station.eta = null;
          station.no_vehicle = true;
          station.message = "暂无合适车辆";
        }
      }
    } catch (error) {
      console.error('API获取最近车辆失败:', error);
      // 标记为无合适车辆
      const targetStationIndex = stations.value.findIndex(s => s.id === target);
      if (targetStationIndex >= 0) {
        const station = stations.value[targetStationIndex];
        station.eta = null;
        station.no_vehicle = true;
        station.message = "暂无合适车辆";
      }
    }
  } catch (error) {
    console.error('获取最近车辆数据失败:', error);
  }
};

// 设置当前位置
const setCurrentLocation = () => {
  isLocationSet.value = !isLocationSet.value;
  
  if (isLocationSet.value) {
    // 弹出选择当前站点的列表
    uni.showActionSheet({
      itemList: stations.value.map(station => station.name),
      success: function (res) {
        const index = res.tapIndex;
        currentStationId.value = stations.value[index].id;
        
        uni.showToast({
          title: `已设置当前位置: ${stations.value[index].name}`,
          icon: 'none'
        });
        
        // 立即更新最近车辆信息
        updateNearestVehicle(routeCode.value, currentStationId.value);
      }
    });
  } else {
    currentStationId.value = null;
    // 重置所有站点的eta
    stations.value.forEach(station => {
      station.eta = null;
    });
    
    uni.showToast({
      title: '已取消当前位置设置',
      icon: 'none'
    });
  }
};

// 开启/关闭到站提醒
const toggleAlarm = () => {
  if (!isLocationSet.value) {
    uni.showModal({
      title: '提示',
      content: '请先设置您的当前位置，再开启到站提醒',
      showCancel: false
    });
    return;
  }
  
  isAlarmActive.value = !isAlarmActive.value;
  
  if (isAlarmActive.value) {
    uni.showToast({
      title: '到站提醒已开启',
      icon: 'success'
    });
    
    // 立即更新一次车辆信息
    updateNearestVehicle(routeCode.value, currentStationId.value);
  } else {
    uni.showToast({
      title: '到站提醒已关闭',
      icon: 'none'
    });
  }
};

// 返回上一页
const goBack = () => {
  uni.navigateBack({
    delta: 1,
    fail: function() {
      // 如果没有上一页，则导航到首页
      uni.redirectTo({
        url: '/pages/busAssistant/index'
      });
    }
  });
};

// 格式化时间显示
const formatTime = (seconds) => {
  if (!seconds) return '';
  
  // 处理小数点，最多保留2位小数
  const roundedSeconds = Math.round(seconds * 100) / 100;
  
  if (roundedSeconds < 60) {
    return `${roundedSeconds}秒`;
  } else if (roundedSeconds < 3600) {
    const minutes = Math.floor(roundedSeconds / 60);
    const remainSeconds = Math.round((roundedSeconds % 60) * 100) / 100;
    return remainSeconds > 0 ? `${minutes}分${remainSeconds}秒` : `${minutes}分钟`;
  } else {
    const hours = Math.floor(roundedSeconds / 3600);
    const minutes = Math.floor((roundedSeconds % 3600) / 60);
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  }
};

// 提取站点名称
const extractStationName = (stationName) => {
  if (!stationName) return '';
  
  // 检查是否包含"-"符号，如API返回的"M22-青洲/聖德蘭學校"
  const parts = stationName.split('-');
  if (parts.length > 1) {
    return parts[1]; // 返回"-"后面的部分
  }
  
  return stationName;
};

// 修复错误，添加缺失的updateBusPositions函数
const updateBusPositions = async (route) => {
  try {
    // 先重置所有车辆位置
    stations.value.forEach(station => {
      station.has_bus = false;
      station.plate_number = null;
      station.speed = null;
      station.station_name = null;
      station.timestamp = null;
    });
    
    // 获取真实车辆位置数据
    const response = await getVehicleInfo(route);
    console.log('API返回车辆数据:', response);
    
    // 检查是否返回错误
    if (response && response.error) {
      console.error('获取车辆数据失败:', response.message);
      
      // 显示错误信息
      uni.showToast({
        title: response.message || '获取车辆数据失败',
        icon: 'none',
        duration: 3000
      });
      
      return; // 退出函数，不做进一步处理
    }
    
    // 确保返回的是有效的车辆数组
    const vehicles = Array.isArray(response) ? response : [];
    
    if (vehicles.length > 0) {
      console.log('获取到车辆数量:', vehicles.length);
      
      // 创建站点ID到索引的映射，方便查找
      const stationIndexMap = {};
      stations.value.forEach((station, index) => {
        stationIndexMap[station.id] = index;
      });
      
      // 处理每个车辆
      vehicles.forEach(vehicle => {
        if (!vehicle.location) return;
        
        // 查找对应站点索引
        const stationIndex = stationIndexMap[vehicle.location];
        if (stationIndex !== undefined) {
          // 标记车辆位置
          const station = stations.value[stationIndex];
          station.has_bus = true;
          station.plate_number = vehicle.plate_number;
          station.speed = vehicle.speed;
          station.station_name = vehicle.station_name;
          station.timestamp = vehicle.timestamp;
          
          // 如果有状态，则记录
          if (vehicle.status) {
            station.vehicle_status = vehicle.status;
          }
          
          console.log(`车辆${vehicle.plate_number}位于站点${vehicle.location}，站名：${vehicle.station_name}`);
        } else {
          console.warn(`找不到站点索引: ${vehicle.location}`);
        }
      });
    } else {
      console.warn('当前路线没有运行中的车辆');
      
      // 可以显示提示信息
      uni.showToast({
        title: '当前路线没有运行中的车辆',
        icon: 'none',
        duration: 2000
      });
    }
    
    // 如果有当前位置，但只在第一次加载时更新最近车辆信息，避免重复请求
    // 注：当设置/更改当前位置时，会单独调用updateNearestVehicle
    if (currentStationId.value && !loadingData.value) {
      // 不再每次更新车辆位置时都查询最近车辆
      // 仅在首次加载或用户主动请求时更新
    }
  } catch (error) {
    console.error('更新车辆位置失败:', error);
    
    // 显示错误信息
    uni.showToast({
      title: '更新车辆位置失败',
      icon: 'none',
      duration: 2000
    });
  }
};
</script>

<style lang="scss">
.route-detail {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: #f5f7fa;
}

.main-content {
  flex: 1;
  display: flex;
  padding: 30rpx;
}

.left-panel {
  width: 170rpx;
  margin-right: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.function-button {
  height: 120rpx;
  background-color: #ffffff;
  border-radius: 10rpx;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 28rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
  transition: all 0.3s;

  &.active {
    background-color: #4a89dc;
    color: #ffffff;
  }

  &:active {
    transform: scale(0.95);
  }
}

.route-map {
  flex: 1;
  background-color: #ffffff;
  border-radius: 10rpx;
  padding: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
  overflow-y: auto;
  max-height: calc(100vh - 200rpx);
}

.route-line {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.station-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.connecting-line {
  width: 8rpx;
  height: 80rpx;
  background-color: #a6d0ff;
  position: relative;
  display: flex;
  justify-content: center;
}

.time-label {
  position: absolute;
  right: 20rpx;
  top: 50%;
  transform: translateY(-50%);
  background-color: #f0f7ff;
  padding: 4rpx 10rpx;
  border-radius: 6rpx;
  font-size: 24rpx;
  color: #666;
}

.bus-icon {
  position: absolute;
  width: 60rpx;
  height: 36rpx;
  left: -26rpx;
  top: 50%;
  transform: translateY(-50%);
}

.station-dot {
  width: 30rpx;
  height: 30rpx;
  background-color: #c8e1ff;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  z-index: 1;
  
  &.current-location {
    background-color: #4a89dc;
    box-shadow: 0 0 0 8rpx rgba(74, 137, 220, 0.2);
  }

  &.has-vehicle {
    background-color: #4a89dc;
    box-shadow: 0 0 0 8rpx rgba(74, 137, 220, 0.2);
  }
}

.inner-dot {
  width: 16rpx;
  height: 16rpx;
  background-color: #fff;
  border-radius: 50%;
}

.station-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-top: 5rpx;
  margin-bottom: 10rpx;
  padding: 0 20rpx;
}

.station-name {
  font-size: 28rpx;
  color: #333;
}

.station-right-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.eta {
  font-size: 24rpx;
  color: #4a89dc;
  font-weight: bold;
}

.eta.no-vehicle {
  font-size: 24rpx;
  color: #ff9800;
  font-weight: bold;
}

.vehicle-info {
  font-size: 24rpx;
  color: #4a89dc;
  font-weight: bold;
}

.speed-info {
  font-size: 24rpx;
  color: #4a89dc;
  font-weight: bold;
}
</style> 