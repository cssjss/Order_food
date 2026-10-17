const { store, absoluteImage, yuan, toast, request } = require('../../utils/api');
const cart = require('../../utils/cart');
Page({
  data: {
    shop: {},
    page: {},
    categories: [],
    products: [],
    visible: [],
    featured: [],
    activeCategory: 0,
    query: '',
    history: [],
    searchOpen: false,
    cartCount: 0,
    favorites: [],
    loading: true,
    imageBase: require('../../config').apiBase,
  },
  onShow() {
    this.load();
    this.setData({
      cartCount: cart.read().reduce((sum, item) => sum + item.quantity, 0),
      history: wx.getStorageSync('searchHistory') || [],
    });
  },
  async load() {
    try {
      const data = await store(true);
      const products = data.products.map((p) => ({
        ...p,
        imageUrl: absoluteImage(p.image),
        priceText: yuan(p.base_price),
        soldOut: p.stock < 1,
      }));
      this.setData({
        shop: data.shop,
        page: data.page,
        categories: data.categories,
        products,
        featured: products.filter((p) => p.featured && !p.soldOut).slice(0, 6),
        loading: false,
      });
      this.filter();
      request('/favorites', 'GET', null, true)
        .then((rows) => this.setData({ favorites: rows.map((p) => p.id) }))
        .catch(() => {});
    } catch (e) {
      this.setData({ loading: false });
      toast(e.message);
    }
  },
  filter() {
    const { products, activeCategory, query } = this.data;
    const word = query.trim().toLowerCase();
    this.setData({
      visible: products.filter(
        (p) =>
          (!activeCategory || p.category_id === activeCategory) &&
          (!word || `${p.name} ${p.description}`.toLowerCase().includes(word)),
      ),
    });
  },
  category(e) {
    this.setData({ activeCategory: Number(e.currentTarget.dataset.id) });
    this.filter();
  },
  search(e) {
    this.setData({ query: e.detail.value });
    this.filter();
  },
  focus() {
    this.setData({ searchOpen: true });
  },
  submitSearch() {
    const word = this.data.query.trim();
    if (word) {
      const history = [word, ...this.data.history.filter((v) => v !== word)].slice(0, 8);
      wx.setStorageSync('searchHistory', history);
      this.setData({ history, searchOpen: false });
    }
  },
  historySearch(e) {
    this.setData({ query: e.currentTarget.dataset.word, searchOpen: false });
    this.filter();
  },
  clearHistory() {
    wx.removeStorageSync('searchHistory');
    this.setData({ history: [] });
  },
  openProduct(e) {
    wx.navigateTo({ url: `/pages/product/index?id=${e.currentTarget.dataset.id}` });
  },
  openCart() {
    wx.switchTab({ url: '/pages/cart/index' });
  },
  async favorite(e) {
    const id = Number(e.currentTarget.dataset.id),
      liked = this.data.favorites.includes(id);
    try {
      await request(`/favorites/${id}`, liked ? 'DELETE' : 'PUT', {}, true);
      this.setData({
        favorites: liked
          ? this.data.favorites.filter((v) => v !== id)
          : [...this.data.favorites, id],
      });
    } catch (error) {
      toast(error.message);
    }
  },
});
