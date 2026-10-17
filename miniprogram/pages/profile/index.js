const { request, store, toast, absoluteImage, yuan } = require('../../utils/api');
const config = require('../../config');
Page({
  data: {
    shop: {},
    page: {},
    nickname: '',
    avatar: '',
    avatarUrl: '',
    savedName: '',
    balanceText: '¥0.00',
    isMerchant: false,
    loading: true,
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const data = await store(true);
      this.setData({
        shop: data.shop,
        page: data.page,
        loading: false,
      });
      const profile = await request('/me', 'GET', null, true);
      this.setData({
        nickname: profile.nickname || '',
        avatar: profile.avatar || '',
        avatarUrl: absoluteImage(profile.avatar),
        savedName: profile.nickname || '',
        balanceText: yuan(profile.balance),
        isMerchant: !!profile.isMerchant,
      });
      getApp().globalData.isMerchant = !!profile.isMerchant;
    } catch (e) {
      this.setData({ loading: false });
      toast(e.message);
    }
  },
  name(e) {
    this.setData({ nickname: e.detail.value });
  },
  async avatar(e) {
    try {
      const token = await getApp().ensureLogin();
      const uploaded = await new Promise((resolve, reject) =>
        wx.uploadFile({
          url: `${config.apiBase}/api/me/avatar`,
          filePath: e.detail.avatarUrl,
          name: 'image',
          header: { Authorization: `Bearer ${token}` },
          success: (response) =>
            response.statusCode < 300
              ? resolve(JSON.parse(response.data))
              : reject(new Error('头像上传失败')),
          fail: reject,
        }),
      );
      this.setData({ avatar: uploaded.url, avatarUrl: absoluteImage(uploaded.url) });
      await this.save();
    } catch (error) {
      toast(error.message);
    }
  },
  blurName() {
    if (this.data.nickname !== this.data.savedName) this.save();
  },
  async save() {
    try {
      const { avatar, nickname } = this.data;
      await request('/me', 'PUT', { avatar, nickname }, true);
      this.setData({ savedName: nickname });
      toast('资料已保存');
    } catch (e) {
      toast(e.message);
    }
  },
  orders() {
    wx.switchTab({ url: '/pages/orders/index' });
  },
  favorites() {
    wx.navigateTo({ url: '/pages/favorites/index' });
  },
  wallet() {
    wx.navigateTo({ url: '/pages/wallet/index' });
  },
  merchant() {
    getApp().globalData.viewMode = 'merchant';
    wx.navigateTo({ url: '/pages/merchant/index' });
  },
  phone() {
    if (!this.data.shop.phone) return toast('商家暂未设置联系电话');
    wx.makePhoneCall({ phoneNumber: this.data.shop.phone });
  },
});
