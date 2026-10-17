const config = require('../config');
function request(path, method = 'GET', data, auth = false) {
  const app = getApp();
  const ready = auth ? app.ensureLogin() : Promise.resolve('');
  return ready.then(
    (token) =>
      new Promise((resolve, reject) =>
        wx.request({
          url: `${config.apiBase}/api${path}`,
          method,
          data,
          header: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          success: (response) => {
            if (response.statusCode === 401 && auth) {
              app.globalData.token = '';
              wx.removeStorageSync('userToken');
            }
            response.statusCode < 300
              ? resolve(response.data)
              : reject(new Error(response.data?.error || '请求失败，请重试'));
          },
          fail: () => reject(new Error('网络连接失败，请检查网络')),
        }),
      ),
  );
}
const absoluteImage = (url) => (url ? `${config.apiBase}${url}` : '');
const yuan = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
const statusText = (status) =>
  ({
    PENDING_PAYMENT: '待付款',
    PENDING_ACCEPTANCE: '待接单',
    PREPARING: '制作中',
    READY: '待取餐',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    REFUND_PENDING: '待退款',
    REFUNDED: '已退款',
  })[status] || status;
function toast(message) {
  wx.showToast({ title: message, icon: 'none', duration: 2500 });
}
function paymentError(error, fallback = '支付失败，请重试') {
  const detail = String(error?.errMsg || '');
  if (!detail) {
    toast(error?.message || fallback);
    return Promise.resolve();
  }
  if (/cancel/i.test(detail)) {
    toast('已取消支付');
    return Promise.resolve();
  }
  const code = error.errCode ?? error.err_code;
  console.warn('微信支付调用失败', { errMsg: detail, errCode: code });
  return new Promise((resolve) =>
    wx.showModal({
      title: '微信支付未能打开',
      content: `${detail}${code == null ? '' : `\n错误码：${code}`}\n请截图联系商家。`,
      showCancel: false,
      success: resolve,
      fail: resolve,
    }),
  );
}
async function store(force = false) {
  const app = getApp();
  if (!force && app.globalData.store) return app.globalData.store;
  const value = await request('/store');
  app.globalData.store = value;
  return value;
}
module.exports = { request, absoluteImage, yuan, statusText, toast, paymentError, store };
