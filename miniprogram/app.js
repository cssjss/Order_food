const config = require('./config');
App({
  globalData: {
    store: null,
    token: wx.getStorageSync('userToken') || '',
    isMerchant: false,
    viewMode: 'merchant',
    config,
  },
  async onLaunch() {
    const { request } = require('./utils/api');
    try {
      let profile;
      const hadToken = !!this.globalData.token;
      try {
        profile = await request('/me', 'GET', null, true);
      } catch (error) {
        if (!hadToken || this.globalData.token) throw error;
        profile = await request('/me', 'GET', null, true);
      }
      this.globalData.isMerchant = !!profile.isMerchant;
      if (profile.isMerchant && this.globalData.viewMode === 'merchant')
        wx.reLaunch({ url: '/pages/merchant/index' });
    } catch (_) {
      // 登录失败时保留普通点餐首页，受保护页面会提示具体错误。
    }
  },
  async ensureLogin() {
    if (this.globalData.token) return this.globalData.token;
    if (!this.loginPromise)
      this.loginPromise = (async () => {
        const code = config.devLogin
          ? 'dev:local-customer'
          : await new Promise((resolve, reject) =>
              wx.login({ success: (result) => resolve(result.code), fail: reject }),
            );
        const result = await new Promise((resolve, reject) =>
          wx.request({
            url: `${config.apiBase}/api/auth/wechat`,
            method: 'POST',
            data: { code },
            success: (response) =>
              response.statusCode < 300
                ? resolve(response.data)
                : reject(new Error(response.data?.error || '登录失败')),
            fail: reject,
          }),
        );
        this.globalData.token = result.token;
        this.globalData.isMerchant = !!result.profile?.isMerchant;
        wx.setStorageSync('userToken', result.token);
        return result.token;
      })().finally(() => {
        this.loginPromise = null;
      });
    return this.loginPromise;
  },
});
