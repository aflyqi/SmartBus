<template>
  <view class="bus-assistant">
    <!-- 顶部标题和搜索框 -->
    <view class="header">
      <view class="title">公交助手</view>
      <view class="search-box">
        <view class="search-input">
          <text class="iconfont icon-search"></text>
          <input type="text" placeholder="搜索公交线路、站点" placeholder-class="placeholder" />
        </view>
      </view>
    </view>

    <!-- 收藏线路部分 -->
    <view class="section favorite-routes">
      <view class="section-title">
        <text class="iconfont icon-star"></text>
        <text class="title-text">收藏线路</text>
      </view>
      <view class="route-grid">
        <view 
          class="route-item animate-item" 
          v-for="(route, index) in favoriteRoutes" 
          :key="route.id" 
          @tap="selectRoute(route)"
          :style="{ animationDelay: index * 0.05 + 's' }"
        >
          <text>{{ route.name }}</text>
        </view>
      </view>
    </view>

    <!-- 其他线路部分，只有当存在其他线路时才显示 -->
    <view class="section other-routes" v-if="otherRoutes.length > 0">
      <view class="section-title">
        <text class="iconfont icon-bus"></text>
        <text class="title-text">其他线路</text>
      </view>
      <view class="route-grid">
        <view 
          class="route-item animate-item" 
          v-for="(route, index) in otherRoutes" 
          :key="route.id" 
          @tap="selectRoute(route)"
          :style="{ animationDelay: index * 0.05 + 's' }"
        >
          <text>{{ route.name }}</text>
        </view>
      </view>
    </view>

    

    <!-- 南成和青茂之间的路线框 -->
    <view class="route-direction-box">
      <view class="direction-card">
        <view class="direction-left">南成 → 青茂</view>
        <view class="direction-middle">{{ bestRouteToQingmao }}</view>
        <view class="direction-right">{{ etaToQingmao }}</view>
      </view>
      <view class="direction-card">
        <view class="direction-left">青茂 → 南成</view>
        <view class="direction-middle">{{ bestRouteToNancheng }}</view>
        <view class="direction-right">{{ etaToNancheng }}</view>
      </view>
    </view>
    <!-- 开发者便利贴说明 -->
    <view class="sticky-note">
      <view class="sticky-note-content">
        <view class="sticky-note-title">开发者说明</view>
        <view class="sticky-note-title">正式版1.0.3</view>
        <view class="sticky-note-text">主要功能已经开发，由于服务器性能较差，暂不添加更多线路</view>
        <view class="sticky-note-text">期末考试结束应该会接着开发</view>
      </view>
    </view>
    <!--<view class="sticky-note">
      <view class="sticky-note-content">
        <view class="sticky-note-title">注意</view>
        <view class="sticky-note-text">应用的打包出现问题，很多功能无法正常使用</view>
        
      </view>
    </view>

     底部导航
    <view class="tab-bar">
      <view class="tab-item active">
        <text class="iconfont icon-bus"></text>
        <text class="tab-text">巴士</text>
      </view>
      <view class="tab-item">
        <text class="iconfont icon-tool"></text>
        <text class="tab-text">工具</text>
      </view>
      <view class="tab-item">
        <text class="iconfont icon-more"></text>
        <text class="tab-text">其他</text>
      </view>
    </view> 
    -->
    
    <!-- 图标版权信息 -->
    <view class="icons-credits">
      Icons by Icons8
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { AVAILABLE_ROUTES } from '../../config/api.config.js';
import { getNearestVehicle } from '../../services/busApi.js';

// 收藏线路数据
const favoriteRoutes = ref([]);
// 其他线路数据 (现在暂无其他线路，所以为空数组)
const otherRoutes = ref([]);

// 南成-青茂和青茂-南成的最佳路线和到达时间
const bestRouteToQingmao = ref('获取中...');
const etaToQingmao = ref('--');
const bestRouteToNancheng = ref('获取中...');
const etaToNancheng = ref('--');

// 记录上一次有效数据
const lastValidQingmaoRoute = ref(null);
const lastValidQingmaoEta = ref(null);
const lastValidNanchengRoute = ref(null);
const lastValidNanchengEta = ref(null);

// 初始化数据
const initRouteData = () => {
  favoriteRoutes.value = AVAILABLE_ROUTES.map((route, index) => {
    return {
      id: index + 1,
      code: route.code,
      name: route.name
    };
  });
};

const selectRoute = (route) => {
  console.log('选择了线路:', route);

  // 1. 拼绝对路径（小程序和 H5 都可用）
  const url = '/pages/routeDetail/index?route=' + route.code + '&id=' + route.id;
  console.log('➡️ 即将跳转的 url =', url);

  // 2. 发起跳转，打印 success / fail
  uni.navigateTo({
    url,
    success: () => console.log('✅ navigateTo 成功'),
    fail: (err) => console.error('❌ navigateTo 失败', err)
  });
};

// 获取南成-青茂的最佳路线
const fetchBestRouteToQingmao = async () => {
  try {
    // 检查23路从M243到M273的最近车辆
    const route23Data = await getNearestVehicle('23', 'M243');
    console.log('23路从南成到青茂的数据:', route23Data);
    
    // 检查25路从M243到M4/2的最近车辆
    const route25Data = await getNearestVehicle('25', 'M243');
    console.log('25路从南成到青茂的数据:', route25Data);
    
    // 检查是否有错误响应，两个都为错误时才保持上次结果
    const route23Error = route23Data && (route23Data.error || route23Data.no_vehicle);
    const route25Error = route25Data && (route25Data.error || route25Data.no_vehicle);
    
    if (route23Error && route25Error) {
      console.log('两个路线查询都返回错误，保持上一次的有效数据');
      if (lastValidQingmaoRoute.value && lastValidQingmaoEta.value) {
        console.log('使用上次有效数据:', lastValidQingmaoRoute.value, lastValidQingmaoEta.value);
        return; // 保持当前显示，不更新
      }
    }
    
    // 比较哪个路线到达时间更短
    let route23Time = route23Error ? Infinity : (route23Data && route23Data.eta_sec ? route23Data.eta_sec : Infinity);
    let route25Time = route25Error ? Infinity : (route25Data && route25Data.eta_sec ? route25Data.eta_sec : Infinity);
    
    if (route23Time < route25Time && route23Time !== Infinity) {
      bestRouteToQingmao.value = '23路';
      etaToQingmao.value = formatTime(route23Time);
      // 保存有效数据
      lastValidQingmaoRoute.value = bestRouteToQingmao.value;
      lastValidQingmaoEta.value = etaToQingmao.value;
    } else if (route25Time !== Infinity) {
      bestRouteToQingmao.value = '25路';
      etaToQingmao.value = formatTime(route25Time);
      // 保存有效数据
      lastValidQingmaoRoute.value = bestRouteToQingmao.value;
      lastValidQingmaoEta.value = etaToQingmao.value;
    } else if (!lastValidQingmaoRoute.value) {
      // 只有在没有上次有效数据时才显示"暂无车辆"
      bestRouteToQingmao.value = '暂无车辆';
      etaToQingmao.value = '--';
    }
  } catch (error) {
    console.error('获取南成-青茂路线失败:', error);
    // 出现错误时，如果有上次有效数据则保持显示
    if (!lastValidQingmaoRoute.value) {
      bestRouteToQingmao.value = '查询失败';
      etaToQingmao.value = '--';
    }
  }
};

// 获取青茂-南成的最佳路线
const fetchBestRouteToNancheng = async () => {
  try {
    // 检查28B路从M22到M157的最近车辆
    const route28BData = await getNearestVehicle('28B', 'M22');
    console.log('28B路从青茂到南成的数据:', route28BData);
    
    // 检查23路从M22到M243的最近车辆
    const route23Data = await getNearestVehicle('23', 'M22');
    console.log('23路从青茂到南成的数据:', route23Data);
    
    // 检查是否有错误响应，两个都为错误时才保持上次结果
    const route28BError = route28BData && (route28BData.error || route28BData.no_vehicle);
    const route23Error = route23Data && (route23Data.error || route23Data.no_vehicle);
    
    if (route28BError && route23Error) {
      console.log('两个路线查询都返回错误，保持上一次的有效数据');
      if (lastValidNanchengRoute.value && lastValidNanchengEta.value) {
        console.log('使用上次有效数据:', lastValidNanchengRoute.value, lastValidNanchengEta.value);
        return; // 保持当前显示，不更新
      }
    }
    
    // 比较哪个路线到达时间更短
    let route28BTime = route28BError ? Infinity : (route28BData && route28BData.eta_sec ? route28BData.eta_sec : Infinity);
    let route23Time = route23Error ? Infinity : (route23Data && route23Data.eta_sec ? route23Data.eta_sec : Infinity);
    
    if (route28BTime < route23Time && route28BTime !== Infinity) {
      bestRouteToNancheng.value = '28B路';
      etaToNancheng.value = formatTime(route28BTime);
      // 保存有效数据
      lastValidNanchengRoute.value = bestRouteToNancheng.value;
      lastValidNanchengEta.value = etaToNancheng.value;
    } else if (route23Time !== Infinity) {
      bestRouteToNancheng.value = '23路';
      etaToNancheng.value = formatTime(route23Time);
      // 保存有效数据
      lastValidNanchengRoute.value = bestRouteToNancheng.value;
      lastValidNanchengEta.value = etaToNancheng.value;
    } else if (!lastValidNanchengRoute.value) {
      // 只有在没有上次有效数据时才显示"暂无车辆"
      bestRouteToNancheng.value = '暂无车辆';
      etaToNancheng.value = '--';
    }
  } catch (error) {
    console.error('获取青茂-南成路线失败:', error);
    // 出现错误时，如果有上次有效数据则保持显示
    if (!lastValidNanchengRoute.value) {
      bestRouteToNancheng.value = '查询失败';
      etaToNancheng.value = '--';
    }
  }
};

// 格式化时间显示
const formatTime = (seconds) => {
  if (!seconds) return '--';
  
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

onMounted(() => {
  // 页面加载完成后的处理
  console.log('公交助手页面加载完成');
  initRouteData();
  
  // 获取南成和青茂之间的最佳路线
  fetchBestRouteToQingmao();
  fetchBestRouteToNancheng();
  
  // 每隔60秒刷新一次路线数据
  const refreshInterval = setInterval(() => {
    fetchBestRouteToQingmao();
    fetchBestRouteToNancheng();
  }, 10000);
  
  // 组件销毁时清除定时器
  return () => clearInterval(refreshInterval);
});
</script>

<style lang="scss">
.bus-assistant {
  min-height: 100vh;
  background-color: #f5f7fa;
  padding-bottom: 100rpx;
  display: flex;
  flex-direction: column;
}

.bus-assistant::after {
  display: none; /* 隐藏遮罩层 */
}

.header {
  background: linear-gradient(to right, #4a89dc, #5e9de6);
  padding: 30rpx 30rpx 50rpx;
  border-radius: 0 0 30rpx 30rpx;
  position: relative;
  z-index: 1;
}

.title {
  color: #ffffff;
  font-size: 48rpx;
  font-weight: bold;
  margin-bottom: 30rpx;
}

.search-box {
  width: 100%;
  margin-bottom: 1px; /* 补充边距 */
}

.search-input {
  display: flex;
  align-items: center;
  background-color: #ffffff;
  border-radius: 40rpx;
  padding: 15rpx 30rpx;
  box-shadow: 0 4rpx 8rpx rgba(74, 137, 220, 0.2); /* 更改阴影颜色，减少黑色痕迹 */
}

.icon-search {
  margin-right: 10rpx;
  color: #999;
}

.placeholder {
  color: #999;
  font-size: 28rpx;
}

.section {
  margin: 0 30rpx 20rpx;
  background-color: #ffffff;
  border-radius: 20rpx;
  padding: 20rpx;
  position: relative;
  z-index: 1;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.section-title {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
  color: #333;
  font-size: 32rpx;
  font-weight: bold;
}

.icon-star {
  color: #ffb400;
  margin-right: 10rpx;
  font-size: 36rpx;
}

.icon-bus {
  color: #4a89dc;
  margin-right: 10rpx;
  font-size: 36rpx;
}

.route-grid {
  display: flex;
  flex-wrap: wrap;
  margin: 0 -10rpx;
}

.route-item {
  width: calc(25% - 20rpx);
  margin: 10rpx;
  height: 100rpx;
  background-color: #edf2f9;
  border-radius: 15rpx;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 32rpx;
  color: #333;
  font-weight: 500;
  transition: all 0.3s;
}

.route-item:active {
  transform: scale(0.95);
  background-color: #d6e4f7;
}

.animate-item {
  animation: fadeInUp 0.5s ease-out forwards;
  opacity: 0;
  transform: translateY(20rpx);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 110rpx;
  background-color: #ffffff;
  display: flex;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #999;
  font-size: 24rpx;
  transition: all 0.2s;
}

.tab-item.active {
  color: #4a89dc;
  transform: translateY(-5rpx);
}

.tab-item .iconfont {
  font-size: 48rpx;
  margin-bottom: 5rpx;
}

.tab-item:active {
  transform: scale(0.9);
}

.icons-credits {
  text-align: center;
  color: #999;
  opacity: 0.7;
  font-size: 24rpx;
  padding: 20rpx 0;
  margin-bottom: 110rpx; /* 为底部导航留出空间 */
}

.favorite-routes {
  margin-top: 0; /* 恢复正常边距 */
}

.sticky-note {
  margin: 30rpx;
  padding: 10rpx;
  background-color: #d9f4ff; /* 淡黄色背景，便利贴风格 */
  border-radius: 8rpx;
  box-shadow: 2rpx 2rpx 10rpx rgba(0, 0, 0, 0.1);
  position: relative;
  transform: rotate(-1deg); /* 轻微倾斜 */
}

.sticky-note::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 30rpx;
  background: linear-gradient(to right, rgba(201, 248, 255, 0.3), rgba(201, 248, 255, 0.3));
  border-radius: 8rpx 8rpx 0 0;
}

.sticky-note-content {
  padding: 20rpx;
}

.sticky-note-title {
  font-weight: bold;
  font-size: 32rpx;
  margin-bottom: 15rpx;
  color: #5d4037; /* 棕色标题 */
}

.sticky-note-text {
  font-size: 28rpx;
  line-height: 1.5;
  margin-bottom: 10rpx;
  color: #5d4037; /* 棕色文字 */
  font-family: 'Courier New', Courier, monospace; /* 手写风格字体 */
}

/* 新增方向路线框的样式 */
.route-direction-box {
  margin: 30rpx;
  background-color: #ffffff;
  border-radius: 15rpx;
  box-shadow: 0 4rpx 10rpx rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.direction-card {
  display: flex;
  padding: 20rpx;
  border-bottom: 1rpx solid #eee;
  
  &:last-child {
    border-bottom: none;
  }
}

.direction-left {
  flex: 1;
  font-weight: bold;
  color: #333;
  font-size: 28rpx;
}

.direction-middle {
  flex: 1;
  text-align: center;
  color: #4a89dc;
  font-weight: bold;
  font-size: 28rpx;
}

.direction-right {
  flex: 1;
  text-align: right;
  color: #ff6b6b;
  font-weight: bold;
  font-size: 28rpx;
}
</style> 