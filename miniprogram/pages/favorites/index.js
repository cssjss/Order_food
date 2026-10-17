const { request, absoluteImage, yuan, toast } = require('../../utils/api');
Page({
  data: { items: [], loading: true },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const rows = await request('/favorites', 'GET', null, true);
      this.setData({
        items: rows.map((p) => ({
          ...p,
          imageUrl: absoluteImage(p.image),
          priceText: yuan(p.base_price),
          soldOut: p.stock < 1,
        })),
        loading: false,
      });
    } catch (e) {
      toast(e.message);
      this.setData({ loading: false });
    }
  },
  open(e) {
    wx.navigateTo({ url: `/pages/product/index?id=${e.currentTarget.dataset.id}` });
  },
  async remove(e) {
    try {
      await request(`/favorites/${e.currentTarget.dataset.id}`, 'DELETE', {}, true);
      this.load();
    } catch (error) {
      toast(error.message);
    }
  },
});
