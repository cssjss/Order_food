const { store, absoluteImage, yuan, toast } = require('../../utils/api');

Page({
  data: {
    shop: {},
    page: {},
    featured: [],
    loading: true,
    imageBase: require('../../config').apiBase,
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const data = await store(true);
      const featured = data.products
        .filter((product) => product.featured && product.stock > 0)
        .slice(0, 6)
        .map((product) => ({
          ...product,
          imageUrl: absoluteImage(product.image),
          priceText: yuan(product.base_price),
        }));
      this.setData({
        shop: data.shop,
        page: data.page,
        featured,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      toast(error.message);
    }
  },
  openProduct(event) {
    wx.navigateTo({ url: '/pages/product/index?id=' + event.currentTarget.dataset.id });
  },
  goMenu() {
    wx.switchTab({ url: '/pages/menu/index' });
  },
});
