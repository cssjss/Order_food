const { store, absoluteImage, yuan, toast, request } = require('../../utils/api');
const cart = require('../../utils/cart');
Page({
  data: {
    product: null,
    groups: [],
    selection: {},
    quantity: 1,
    total: '',
    liked: false,
    editKey: '',
    accent: '#78b93b',
  },
  onLoad(options) {
    this.productId = Number(options.id);
    this.editKey = options.editKey ? decodeURIComponent(options.editKey) : '';
    this.load();
  },
  async load() {
    try {
      const data = await store(true);
      const product = data.products.find((p) => p.id === this.productId);
      if (!product) throw new Error('菜品已下架');
      const editing = cart.read().find((item) => item.key === this.editKey);
      const selection =
        editing?.selection ||
        Object.fromEntries(
          product.options.filter((g) => g.required).map((g) => [g.name, g.choices[0]?.name]),
        );
      const quantity = editing?.quantity || 1;
      this.setData({
        product: { ...product, imageUrl: absoluteImage(product.image) },
        selection,
        quantity,
        editKey: this.editKey,
        accent: data.page.accent,
      });
      this.recalculate();
      request('/favorites', 'GET', null, true)
        .then((rows) => this.setData({ liked: rows.some((p) => p.id === product.id) }))
        .catch(() => {});
    } catch (e) {
      toast(e.message);
    }
  },
  recalculate() {
    const product = this.data.product;
    if (!product) return;
    let unit = product.base_price;
    const groups = product.options.map((group) => ({
      ...group,
      choices: group.choices.map((choice) => ({
        ...choice,
        priceText: choice.price ? `+${yuan(choice.price)}` : '',
        selected: this.data.selection[group.name] === choice.name,
      })),
    }));
    for (const group of product.options) {
      const choice = group.choices.find((c) => c.name === this.data.selection[group.name]);
      if (choice) unit += choice.price;
    }
    this.setData({ groups, total: yuan(unit * this.data.quantity) });
  },
  choose(e) {
    const { group, choice } = e.currentTarget.dataset;
    const target = this.data.product.options.find((g) => g.name === group);
    const next = { ...this.data.selection };
    if (!target.required && next[group] === choice) delete next[group];
    else next[group] = choice;
    this.setData({ selection: next });
    this.recalculate();
  },
  quantity(e) {
    const next = this.data.quantity + Number(e.currentTarget.dataset.step);
    if (next < 1 || next > this.data.product.stock) return;
    this.setData({ quantity: next });
    this.recalculate();
  },
  add() {
    const product = this.data.product;
    if (!product || product.stock < 1) return;
    for (const group of product.options)
      if (group.required && !this.data.selection[group.name]) return toast(`请选择${group.name}`);
    cart.add(product, this.data.selection, this.data.quantity, this.editKey);
    toast(this.editKey ? '规格已更新' : '已加入购物车');
    setTimeout(() => wx.navigateBack(), 550);
  },
  async favorite() {
    try {
      await request(`/favorites/${this.productId}`, this.data.liked ? 'DELETE' : 'PUT', {}, true);
      this.setData({ liked: !this.data.liked });
    } catch (e) {
      toast(e.message);
    }
  },
});
