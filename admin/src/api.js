export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {}
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  return response.json();
}
export const json = (method, path, body) => api(path, { method, body: JSON.stringify(body) });
export const yuan = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—';
export const statuses = {
  PENDING_PAYMENT: '待付款',
  PENDING_ACCEPTANCE: '待接单',
  PREPARING: '制作中',
  READY: '待取餐',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUND_PENDING: '待退款',
  REFUNDED: '已退款',
};
