const { store, absoluteImage, yuan, toast } = require('../../utils/api');
const cart = require('../../utils/cart');
Page({
  data: { lines: [], total: '¥0.00', count: 0, allSelected: false, loading: true },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const data = await store(true);
      const products = new Map(data.products.map((p) => [p.id, p]));
      const raw = cart.read();
      const valid = raw.filter((item) => products.has(item.productId));
      if (valid.length !== raw.length) cart.write(valid);
      const lines = valid.map((item) => {
        const p = products.get(item.productId);
        let unit = p.base_price;
        const labels = [];
        for (const group of p.options) {
          const choice = group.choices.find((c) => c.name === item.selection[group.name]);
          if (choice) {
            unit += choice.price;
            labels.push(choice.name);
          }
        }
        return {
          ...item,
          product: p,
          imageUrl: absoluteImage(p.image),
          name: p.name,
          label: labels.join(' / ') || '标准规格',
          unit,
          priceText: yuan(unit * item.quantity),
          soldOut: p.stock < item.quantity,
        };
      });
      const selected = lines.filter((item) => item.selected && !item.soldOut);
      const total = selected.reduce((sum, item) => sum + item.unit * item.quantity, 0);
      this.setData({
        lines,
        total: yuan(total),
        count: selected.reduce((sum, item) => sum + item.quantity, 0),
        allSelected: lines.length > 0 && lines.every((item) => item.selected),
        loading: false,
      });
    } catch (e) {
      toast(e.message);
    }
  },
  toggle(e) {
    const item = cart.read().find((v) => v.key === e.currentTarget.dataset.key);
    cart.patch(item.key, { selected: !item.selected });
    this.load();
  },
  toggleAll() {
    cart.write(cart.read().map((item) => ({ ...item, selected: !this.data.allSelected })));
    this.load();
  },
  quantity(e) {
    const key = e.currentTarget.dataset.key,
      step = Number(e.currentTarget.dataset.step);
    const line = this.data.lines.find((v) => v.key === key);
    const next = line.quantity + step;
    if (next < 1 || next > line.product.stock) return;
    cart.patch(key, { quantity: next });
    this.load();
  },
  edit(e) {
    const line = this.data.lines.find((v) => v.key === e.currentTarget.dataset.key);
    wx.navigateTo({
      url: `/pages/product/index?id=${line.productId}&editKey=${encodeURIComponent(line.key)}`,
    });
  },
  remove(e) {
    cart.remove(e.currentTarget.dataset.key);
    this.load();
  },
  clear() {
    wx.showModal({
      title: '清空购物车',
      content: '确定移除全部菜品吗？',
      success: (result) => {
        if (result.confirm) {
          cart.write([]);
          this.load();
        }
      },
    });
  },
  checkout() {
    if (!this.data.count) return toast('请选择要结算的菜品');
    if (this.data.lines.some((line) => line.selected && line.soldOut))
      return toast('所选菜品库存不足，请调整数量');
    wx.navigateTo({ url: '/pages/checkout/index' });
  },
  goMenu() {
    wx.switchTab({ url: '/pages/menu/index' });
  },
});
