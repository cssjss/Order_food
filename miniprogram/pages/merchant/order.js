const { request, yuan, statusText, toast } = require('../../utils/api');

const actionLabels = {
  accept: '接单并开始制作',
  ready: '标记制作完成',
  complete: '确认订单完结',
  reject: '拒绝订单',
  refunded: '确认已退款',
};

Page({
  data: {
    order: null,
    items: [],
    amountText: '',
    statusLabel: '',
    createdLabel: '',
    reason: '',
    loading: true,
    busy: false,
    error: '',
  },
  onLoad(options) {
    this.orderId = Number(options.id);
  },
  onShow() {
    this.load();
    this.timer = setInterval(() => this.load(), 15000);
  },
  onHide() {
    clearInterval(this.timer);
  },
  onUnload() {
    clearInterval(this.timer);
  },
  async load(force = false) {
    if (!this.orderId || (this.data.busy && !force)) return;
    try {
      const order = await request(`/merchant/orders/${this.orderId}`, 'GET', null, true);
      this.setData({
        order,
        items: order.items.map((item, lineKey) => ({
          ...item,
          lineKey,
          amountText: yuan(item.unit_price * item.quantity),
        })),
        amountText: yuan(order.amount),
        statusLabel: statusText(order.status),
        createdLabel: order.created_at.replace('T', ' ').slice(0, 19),
        loading: false,
        error: '',
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message });
      if (error.message === '当前账号没有商家权限') {
        getApp().globalData.isMerchant = false;
        getApp().globalData.viewMode = 'buyer';
        toast(error.message);
        wx.switchTab({ url: '/pages/profile/index' });
      }
    }
  },
  reason(event) {
    this.setData({ reason: event.detail.value });
  },
  async act(event) {
    if (this.data.busy) return;
    const action = event.currentTarget.dataset.action;
    const reason = this.data.reason.trim();
    if (['reject', 'refunded'].includes(action) && !reason)
      return toast(action === 'reject' ? '请填写拒单原因' : '请填写退款凭证或说明');
    const detail =
      action === 'reject'
        ? this.data.order.payment_method === 'balance'
          ? '余额将立即退回买家。'
          : '拒单后仍需在微信商户平台手工退款。'
        : action === 'refunded'
          ? '请先确认已在微信商户平台完成退款。'
          : '';
    const confirmed = await new Promise((resolve) =>
      wx.showModal({
        title: actionLabels[action],
        content: `确定${actionLabels[action]}吗？${detail}`,
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false),
      }),
    );
    if (!confirmed) return;
    this.setData({ busy: true });
    try {
      await request(`/merchant/orders/${this.orderId}/action`, 'POST', { action, reason }, true);
      this.setData({ reason: '' });
      toast('订单状态已更新');
      await this.load(true);
    } catch (error) {
      toast(error.message);
      await this.load(true);
    } finally {
      this.setData({ busy: false });
    }
  },
  async print() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result = await request(`/merchant/orders/${this.orderId}/print`, 'POST', {}, true);
      toast(result.configured ? '小票已发送到打印服务' : '商家尚未配置打印服务');
    } catch (error) {
      toast(error.message);
    } finally {
      this.setData({ busy: false });
    }
  },
});
