const { request, absoluteImage, yuan, statusText, toast } = require('../../utils/api');

const tabs = [
  { id: 'pending', name: '待接单', statuses: ['PENDING_ACCEPTANCE'] },
  { id: 'making', name: '制作中', statuses: ['PREPARING'] },
  { id: 'ready', name: '待取餐', statuses: ['READY'] },
  { id: 'refund', name: '待退款', statuses: ['REFUND_PENDING'] },
  { id: 'all', name: '全部', statuses: null },
];

Page({
  data: {
    tabs: tabs.map(({ id, name }) => ({ id, name, count: 0 })),
    active: 'pending',
    orders: [],
    visible: [],
    loading: true,
    error: '',
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
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load() {
    try {
      const rows = await request('/merchant/orders', 'GET', null, true);
      this.setData({
        orders: rows.map((order) => ({
          ...order,
          amountText: yuan(order.amount),
          statusLabel: statusText(order.status),
          timeLabel: order.created_at.replace('T', ' ').slice(0, 16),
          summary: order.items.map((item) => `${item.name} ×${item.quantity}`).join('、'),
          imageUrl: absoluteImage(order.items[0]?.image),
        })),
        loading: false,
        error: '',
      });
      this.filter();
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
  filter() {
    const active = tabs.find((tab) => tab.id === this.data.active) || tabs[0];
    const orders = this.data.orders;
    this.setData({
      tabs: tabs.map(({ id, name, statuses }) => ({
        id,
        name,
        count: statuses ? orders.filter((order) => statuses.includes(order.status)).length : orders.length,
      })),
      visible: orders.filter((order) => !active.statuses || active.statuses.includes(order.status)),
    });
  },
  tab(event) {
    this.setData({ active: event.currentTarget.dataset.id });
    this.filter();
  },
  open(event) {
    wx.navigateTo({ url: `/pages/merchant/order?id=${event.currentTarget.dataset.id}` });
  },
  profile() {
    wx.navigateTo({ url: '/pages/merchant/profile' });
  },
  retry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },
});
