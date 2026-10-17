const { request, yuan, statusText, toast, paymentError, store } = require('../../utils/api');
const cart = require('../../utils/cart');
Page({
  data: {
    order: null,
    items: [],
    statusLabel: '',
    amountText: '',
    createdLabel: '',
    expiresLabel: '',
    guide: '',
    balanceText: '¥0.00',
    balanceEnough: false,
    balanceAvailable: false,
    payMethod: 'wechat',
    payment: 'unavailable',
    paymentMethodLabel: '',
    busy: false,
  },
  onLoad(options) {
    this.orderId = Number(options.id);
  },
  onShow() {
    if (this.orderId) {
      this.load();
      this.refreshTimer = setInterval(() => this.load(), 5000);
    }
  },
  onHide() {
    clearInterval(this.refreshTimer);
  },
  onUnload() {
    clearInterval(this.refreshTimer);
  },
  async load() {
    try {
      const [order, data] = await Promise.all([
        request(`/orders/${this.orderId}`, 'GET', null, true),
        store(),
      ]);
      const wallet =
        order.status === 'PENDING_PAYMENT' ? await request('/wallet', 'GET', null, true) : null;
      const balanceEnough = wallet ? wallet.balance >= order.amount : false;
      const balanceAvailable = order.payment_method === 'none';
      this.setData({
        order,
        items: order.items.map((item) => ({
          ...item,
          priceText: yuan(item.unit_price * item.quantity),
        })),
        statusLabel: statusText(order.status),
        amountText: yuan(order.amount),
        createdLabel: order.created_at.replace('T', ' ').slice(0, 19),
        expiresLabel: order.expires_at.replace('T', ' ').slice(0, 19),
        guide: data.shop.pickupGuide,
        balanceText: yuan(wallet?.balance || 0),
        balanceEnough,
        balanceAvailable,
        payment: data.payment,
        payMethod: !balanceAvailable
          ? 'wechat'
          : data.payment === 'unavailable' && balanceEnough
            ? 'balance'
            : this.data.payMethod,
        paymentMethodLabel:
          order.payment_method === 'balance'
            ? '余额支付'
            : order.payment_method === 'mock'
              ? '模拟支付'
              : '微信支付',
      });
    } catch (e) {
      toast(e.message);
    }
  },
  choosePayment(e) {
    if (e.currentTarget.dataset.method === 'balance' && !this.data.balanceAvailable)
      return toast('已发起微信支付，请继续支付或取消后重新下单');
    this.setData({ payMethod: e.currentTarget.dataset.method });
  },
  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/index' });
  },
  async pay() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (this.data.payMethod === 'balance') {
        await request(`/orders/${this.orderId}/balance-pay`, 'POST', {}, true);
      } else {
        const payment = await request(`/orders/${this.orderId}/pay`, 'POST', {}, true);
        if (payment.mock) await request(`/orders/${this.orderId}/mock-pay`, 'POST', {}, true);
        else
          await new Promise((resolve, reject) =>
            wx.requestPayment({ ...payment, success: resolve, fail: reject }),
          );
      }
      cart.clearSelected();
      toast('支付完成');
      setTimeout(() => this.load(), 800);
    } catch (e) {
      await paymentError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  cancel() {
    wx.showModal({
      title: '取消订单',
      content: '确定取消这笔待付款订单吗？',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await request(`/orders/${this.orderId}/cancel`, 'POST', {}, true);
          toast('订单已取消');
          this.load();
        } catch (e) {
          toast(e.message);
        }
      },
    });
  },
  async reorder() {
    try {
      const data = await store(true);
      const available = new Map(data.products.map((p) => [p.id, p]));
      let count = 0;
      for (const item of this.data.order.items) {
        const product = available.get(item.product_id);
        if (!product || product.stock < item.quantity) continue;
        const selection = item.selection || {};
        if (
          product.options.some(
            (group) =>
              group.required &&
              !group.choices.some((choice) => choice.name === selection[group.name]),
          )
        )
          continue;
        cart.add(product, selection, item.quantity);
        count++;
      }
      if (!count) return toast('原订单菜品已下架或库存不足');
      toast(`已加入购物车 ${count} 道菜品`);
      setTimeout(() => wx.switchTab({ url: '/pages/cart/index' }), 550);
    } catch (e) {
      toast(e.message);
    }
  },
});
