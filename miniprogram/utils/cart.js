const KEY = 'pickupCart';
const read = () => wx.getStorageSync(KEY) || [];
const write = (items) => {
  wx.setStorageSync(KEY, items);
  return items;
};
const itemKey = (productId, selection) => `${productId}:${JSON.stringify(selection || {})}`;
function add(product, selection, quantity = 1, replaceKey) {
  const cart = read().filter((item) => item.key !== replaceKey);
  const key = itemKey(product.id, selection);
  const existing = cart.find((item) => item.key === key);
  if (existing) existing.quantity += quantity;
  else cart.push({ key, productId: product.id, selection, quantity, selected: true });
  return write(cart);
}
const remove = (key) => write(read().filter((item) => item.key !== key));
const patch = (key, values) =>
  write(read().map((item) => (item.key === key ? { ...item, ...values } : item)));
const clearSelected = () => write(read().filter((item) => !item.selected));
module.exports = { read, write, add, remove, patch, clearSelected, itemKey };
