import crypto from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new ApiError(status, message);
};
export const now = () => new Date().toISOString();
export const money = (value) => Number.isInteger(value) && value >= 0 && value <= 100000000;
export const asId = (value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) fail(400, '参数无效');
  return id;
};
export const readJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
};
export const productDto = (row) =>
  row && {
    ...row,
    enabled: !!row.enabled,
    featured: !!row.featured,
    options: readJson(row.options),
  };
export const token = (payload, secret, ttl = 86400) => {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttl * 1000 })).toString(
    'base64url',
  );
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
};
export const verifyToken = (value, secret) => {
  if (!value) return null;
  const [data, sig] = value.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
};
export const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
export function validateOptions(options) {
  if (!Array.isArray(options) || options.length > 8) fail(400, '规格组最多 8 组');
  const groupNames = new Set();
  for (const group of options) {
    const name = String(group.name || '').trim();
    if (
      !name ||
      groupNames.has(name) ||
      !Array.isArray(group.choices) ||
      !group.choices.length ||
      group.choices.length > 20
    )
      fail(400, '请检查规格组名称和选项，名称不能重复');
    groupNames.add(name);
    const choiceNames = new Set();
    for (const choice of group.choices) {
      const choiceName = String(choice.name || '').trim();
      if (!choiceName || choiceNames.has(choiceName) || !money(choice.price))
        fail(400, '规格选项或加价无效，选项名称不能重复');
      choiceNames.add(choiceName);
    }
  }
}
export function priceFor(product, selection = {}) {
  let price = product.base_price;
  const labels = [];
  const keys = Object.keys(selection);
  if (keys.some((key) => !product.options.some((group) => group.name === key)))
    fail(400, '存在无效规格');
  for (const group of product.options) {
    const selected = selection[group.name];
    if (!selected && group.required) fail(400, `请选择${group.name}`);
    if (!selected) continue;
    const choice = group.choices.find((item) => item.name === selected);
    if (!choice) fail(400, `${group.name}选项无效`);
    price += choice.price;
    labels.push(`${group.name}：${choice.name}`);
  }
  return { price, label: labels.join(' / ') };
}
