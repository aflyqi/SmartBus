<script>
export default {
  globalData: {
    selectedRoute: null,
    loading: false,
    // 缓存数据
    cache: {
      vehicles: {},
      stationNames: {},
      segmentTimes: {}
    }
  },
  onLaunch: function () {
    console.log('App Launch')
    
    // 初始化请求拦截器
    const app = this;
    uni.addInterceptor('request', {
      invoke(args) {
        // 请求开始
        app.globalData.loading = true;
        console.log('请求开始:', args.url);
      },
      success(args) {
        // 请求成功
        console.log('请求成功:', args.statusCode);
      },
      fail(err) {
        // 请求失败
        console.error('请求失败:', err);
        uni.showToast({
          title: '网络请求失败',
          icon: 'none'
        });
      },
      complete(res) {
        // 请求完成
        app.globalData.loading = false;
      }
    });
  },
  onShow: function () {
    console.log('App Show')
  },
  onHide: function () {
    console.log('App Hide')
  },
}
</script>

<style>
/*每个页面公共css */
@import './static/iconfont.css';

page {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  box-sizing: border-box;
  background-color: #f5f7fa;
  font-size: 28rpx;
  color: #333;
}

.animate-pop {
  animation: pop 0.3s ease-out;
}

@keyframes pop {
  0% {
    transform: scale(0.95);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
