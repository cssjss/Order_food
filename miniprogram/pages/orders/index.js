const { request, absoluteImage, yuan, statusText, toast } = require('../../utils/api');

const categories = [
  { id: 'all', name: '全部订单', statuses: null },
  { id: 'pay', name: '待付款', statuses: ['PENDING_PAYMENT'] },
  { id: 'making', name: '待制作', statuses: ['PENDING_ACCEPTANCE', 'PREPARING', 'READY'] },
  { id: 'done', name: '已完成', statuses: ['COMPLETED'] },
  { id: 'cancel', name: '已取消', statuses: ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'] },
];

const matches = (category, order) => !category.statuses || category.statuses.includes(order.status);

Page({
  data: {
    tabs: categories.map(({ id, name }) => ({ id, name, count: 0 })),
    active: 'all',
    orders: [],
    visible: [],
    emptyText: '这里还没有订单',
    loading: true,
  },
  onLoad(options = {}) {
    const active = categories.some((category) => category.id === options.status)
      ? options.status
      : 'all';
    this.setData({ active });
  },
  onShow() {
    this.setData({ loading: true });
    this.filter();
    this.load();
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load() {
    try {
      const rows = await request('/orders', 'GET', null, true);
      this.setData({
        orders: rows.map((row) => ({
          ...row,
          totalText: yuan(row.amount),
          statusLabel: statusText(row.status),
          createdLabel: row.created_at.replace('T', ' ').slice(0, 16),
          summary: row.items.map((item) => `${item.name} ×${item.quantity}`).join('、'),
          imageUrl: absoluteImage(row.items[0]?.image),
        })),
        loading: false,
      });
      this.filter();
    } catch (e) {
      this.setData({ loading: false });
      toast(e.message);
    }
  },
  tab(e) {
    this.setData({ active: e.currentTarget.dataset.id });
    this.filter();
  },
  filter() {
    const selected =
      categories.find((category) => category.id === this.data.active) || categories[0];
    const orders = this.data.orders;
    this.setData({
      tabs: categories.map(({ id, name, statuses }) => ({
        id,
        name,
        count: statuses
          ? orders.filter((order) => statuses.includes(order.status)).length
          : orders.length,
      })),
      visible: orders.filter((order) => matches(selected, order)),
      emptyText: selected.id === 'all' ? '这里还没有订单' : `暂无${selected.name}订单`,
    });
  },
  open(e) {
    wx.navigateTo({ url: `/pages/order/index?id=${e.currentTarget.dataset.id}` });
  },
  menu() {
    wx.switchTab({ url: '/pages/menu/index' });
  },
});
