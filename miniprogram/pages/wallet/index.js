const { request, yuan, toast, paymentError } = require('../../utils/api');

const requestId = () => `${Date.now()}-${Math.floor(Math.random() * 1000000000)}`;
const kinds = {
  TOPUP: '微信充值',
  ORDER_PAYMENT: '余额支付订单',
  ORDER_REFUND: '订单退款',
  ADMIN_CREDIT: '商家增加',
  ADMIN_DEBIT: '商家扣减',
};

Page({
  data: {
    balanceText: '¥0.00',
    presets: [20, 50, 100, 200],
    selectedPreset: 50,
    customAmount: '',
    entries: [],
    pendingTopups: [],
    busy: false,
    loading: true,
  },
  onLoad() {
    this.clientRequestId = requestId();
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const wallet = await request('/wallet', 'GET', null, true);
      this.setData({
        balanceText: yuan(wallet.balance),
        entries: wallet.entries.map((entry) => ({
          ...entry,
          label: kinds[entry.kind] || '余额变动',
          amountText: `${entry.amount > 0 ? '+' : '−'}${yuan(Math.abs(entry.amount))}`,
          createdLabel: entry.created_at.replace('T', ' ').slice(0, 19),
        })),
        pendingTopups: wallet.topups
          .filter((topup) => topup.status !== 'PAID')
          .map((topup) => ({
            ...topup,
            amountText: yuan(topup.amount),
            expired: topup.expires_at <= new Date().toISOString(),
          })),
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      toast(error.message);
    }
  },
  chooseAmount(event) {
    this.clientRequestId = requestId();
    this.setData({ selectedPreset: Number(event.currentTarget.dataset.amount), customAmount: '' });
  },
  customAmount(event) {
    this.clientRequestId = requestId();
    this.setData({ selectedPreset: 0, customAmount: event.detail.value });
  },
  async recharge() {
    if (this.data.busy) return;
    const value = String(this.data.selectedPreset || this.data.customAmount).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return toast('请输入正确的充值金额');
    const amount = Math.round(Number(value) * 100);
    if (amount < 100 || amount > 100000) return toast('单次可充值 1 至 1000 元');
    this.setData({ busy: true });
    try {
      const topup = await request(
        '/wallet/topups',
        'POST',
        {
          amount,
          clientRequestId: this.clientRequestId,
        },
        true,
      );
      const payment = await request(`/wallet/topups/${topup.id}/pay`, 'POST', {}, true);
      if (payment.mock) {
        await request(`/wallet/topups/${topup.id}/mock-pay`, 'POST', {}, true);
      } else {
        await new Promise((resolve, reject) =>
          wx.requestPayment({ ...payment, success: resolve, fail: reject }),
        );
      }
      let paid = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const checked = await request(`/wallet/topups/${topup.id}/refresh`, 'POST', {}, true);
        if (checked.topup.status === 'PAID') {
          paid = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      toast(paid ? '充值已到账' : '支付结果确认中，请稍后查询');
      if (paid) this.clientRequestId = requestId();
      await this.load();
    } catch (error) {
      await paymentError(error, '充值失败，请重试');
      await this.load();
    } finally {
      this.setData({ busy: false });
    }
  },
  async refreshTopup(event) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result = await request(
        `/wallet/topups/${event.currentTarget.dataset.id}/refresh`,
        'POST',
        {},
        true,
      );
      toast(result.topup.status === 'PAID' ? '充值已到账' : '暂未查到付款，请稍后再试');
      await this.load();
    } catch (error) {
      toast(error.message);
    } finally {
      this.setData({ busy: false });
    }
  },
});
