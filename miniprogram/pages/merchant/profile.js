const { request, absoluteImage, toast } = require('../../utils/api');

Page({
  data: { nickname: '', avatarUrl: '', loading: true },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const profile = await request('/me', 'GET', null, true);
      if (!profile.isMerchant) {
        getApp().globalData.isMerchant = false;
        getApp().globalData.viewMode = 'buyer';
        wx.switchTab({ url: '/pages/profile/index' });
        return;
      }
      this.setData({
        nickname: profile.nickname || '商家账号',
        avatarUrl: absoluteImage(profile.avatar),
        loading: false,
      });
    } catch (error) {
      toast(error.message);
    }
  },
  orders() {
    wx.navigateBack();
  },
  buyer() {
    getApp().globalData.viewMode = 'buyer';
    wx.switchTab({ url: '/pages/profile/index' });
  },
});
