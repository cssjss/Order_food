const { store, absoluteImage, yuan, toast } = require('../../utils/api');
const cart = require('../../utils/cart');

Page({
  data: {
    page: {},
    categories: [],
    products: [],
    visible: [],
    activeCategory: 0,
    query: '',
    history: [],
    searchOpen: false,
    cartCount: 0,
    loading: true,
  },
  onShow() {
    this.setData({
      cartCount: cart.read().reduce((sum, item) => sum + item.quantity, 0),
      history: wx.getStorageSync('searchHistory') || [],
    });
    this.load();
  },
  async load() {
    try {
      const data = await store(true);
      const products = data.products.map((product) => ({
        ...product,
        imageUrl: absoluteImage(product.image),
        priceText: yuan(product.base_price),
        soldOut: product.stock < 1,
      }));
      this.setData({
        page: data.page,
        categories: data.categories,
        products,
        loading: false,
      });
      this.filter();
    } catch (error) {
      this.setData({ loading: false });
      toast(error.message);
    }
  },
  filter() {
    const { products, activeCategory, query } = this.data;
    const word = query.trim().toLowerCase();
    this.setData({
      visible: products.filter(
        (product) =>
          (!activeCategory || product.category_id === activeCategory) &&
          (!word ||
            (product.name + ' ' + (product.description || '')).toLowerCase().includes(word)),
      ),
    });
  },
  category(event) {
    this.setData({ activeCategory: Number(event.currentTarget.dataset.id) });
    this.filter();
  },
  search(event) {
    this.setData({ query: event.detail.value });
    this.filter();
  },
  focus() {
    this.setData({ searchOpen: true });
  },
  submitSearch() {
    const word = this.data.query.trim();
    if (!word) return;
    const history = [word, ...this.data.history.filter((value) => value !== word)].slice(0, 8);
    wx.setStorageSync('searchHistory', history);
    this.setData({ history, searchOpen: false });
  },
  historySearch(event) {
    this.setData({ query: event.currentTarget.dataset.word, searchOpen: false });
    this.filter();
  },
  clearHistory() {
    wx.removeStorageSync('searchHistory');
    this.setData({ history: [] });
  },
  resetFilters() {
    this.setData({ activeCategory: 0, query: '', searchOpen: false });
    this.filter();
  },
  openProduct(event) {
    wx.navigateTo({ url: '/pages/product/index?id=' + event.currentTarget.dataset.id });
  },
  openCart() {
    wx.switchTab({ url: '/pages/cart/index' });
  },
});
