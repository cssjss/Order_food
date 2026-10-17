const { store, request, yuan, toast, paymentError } = require('../../utils/api');
const cart = require('../../utils/cart');
Page({
  data: {
    shop: {},
    lines: [],
    total: '¥0.00',
    totalCents: 0,
    balanceText: '¥0.00',
    balanceEnough: false,
    payMethod: 'wechat',
    remark: '',
    busy: false,
    payment: 'unavailable',
  },
  onLoad() {
    this.clientRequestId = `${Date.now()}-${Math.floor(Math.random() * 1000000000)}`;
    this.load();
  },
  onShow() {
    if (this.data.lines.length) this.load();
  },
  async load() {
    try {
      const data = await store(true);
      const products = new Map(data.products.map((p) => [p.id, p]));
      const selected = cart.read().filter((item) => item.selected);
      if (!selected.length) return wx.navigateBack();
      let amount = 0;
      const lines = selected.map((item) => {
        const p = products.get(item.productId);
        if (!p) throw new Error('部分菜品已下架，请返回购物车刷新');
        let price = p.base_price;
        const specs = [];
        for (const group of p.options) {
          const choice = group.choices.find((c) => c.name === item.selection[group.name]);
          if (choice) {
            price += choice.price;
            specs.push(choice.name);
          }
        }
        amount += price * item.quantity;
        return {
          ...item,
          name: p.name,
          label: specs.join(' / ') || '标准规格',
          priceText: yuan(price * item.quantity),
        };
      });
      const wallet = await request('/wallet', 'GET', null, true);
      this.setData({
        shop: data.shop,
        lines,
        total: yuan(amount),
        totalCents: amount,
        payment: data.payment,
        balanceEnough: wallet.balance >= amount,
        balanceText: yuan(wallet.balance),
        payMethod:
          data.payment === 'unavailable' && wallet.balance >= amount ? 'balance' : 'wechat',
      });
    } catch (e) {
      toast(e.message);
    }
  },
  remark(e) {
    this.setData({ remark: e.detail.value });
  },
  choosePayment(e) {
    this.setData({ payMethod: e.currentTarget.dataset.method });
  },
  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/index' });
  },
  async submit() {
    if (this.data.busy || !this.data.lines.length) return;
    this.setData({ busy: true });
    let order;
    try {
      order = await request(
        '/orders',
        'POST',
        {
          items: this.data.lines.map((item) => ({
            productId: item.productId,
            selection: item.selection,
            quantity: item.quantity,
          })),
          remark: this.data.remark,
          clientRequestId: this.clientRequestId,
        },
        true,
      );
      if (this.data.payMethod === 'balance') {
        await request(`/orders/${order.id}/balance-pay`, 'POST', {}, true);
      } else {
        const payment = await request(`/orders/${order.id}/pay`, 'POST', {}, true);
        if (payment.mock) await request(`/orders/${order.id}/mock-pay`, 'POST', {}, true);
        else
          await new Promise((resolve, reject) =>
            wx.requestPayment({ ...payment, success: resolve, fail: reject }),
          );
      }
      cart.clearSelected();
      wx.redirectTo({ url: `/pages/order/index?id=${order.id}` });
    } catch (e) {
      if (e.errMsg) await paymentError(e);
      else toast(order ? `${e.message || '支付未完成'}，请在订单详情继续处理` : e.message);
      if (order)
        setTimeout(() => wx.redirectTo({ url: `/pages/order/index?id=${order.id}` }), 1200);
      else this.setData({ busy: false });
    }
  },
});
