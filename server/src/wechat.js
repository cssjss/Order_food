import crypto from 'node:crypto';
import { fail } from './lib.js';
import { paymentConfig, paymentReady } from './payment-config.js';

const sign = (config, message) =>
  crypto.sign('RSA-SHA256', Buffer.from(message), config.mchPrivateKey).toString('base64');
const nonce = () => crypto.randomBytes(16).toString('hex');
export function wechatLoginError(code, detail = '') {
  if (code === 40164) {
    const ip = /invalid ip\s+((?:\d{1,3}\.){3}\d{1,3})/i.exec(detail)?.[1];
    return `微信登录受限：请在微信公众平台将服务器出口 IP${ip ? ` ${ip}` : ''} 加入接口 IP 白名单`;
  }
  if (code === 40001 || code === 40125) return '微信登录配置有误：请检查小程序 AppSecret';
  if (code === 40013) return '微信登录配置有误：请检查小程序 AppID';
  if (code === 40029 || code === 40163) return '微信登录凭证已失效，请重试';
  return '微信登录失败，请重试';
}
export const paymentMode = (db) =>
  process.env.NODE_ENV !== 'production' && process.env.MOCK_PAYMENT === 'true'
    ? 'mock'
    : paymentReady(paymentConfig(db))
      ? 'wechat'
      : 'unavailable';

export async function loginWithCode(db, code) {
  if (process.env.NODE_ENV !== 'production' && String(code).startsWith('dev:'))
    return `dev-${code.slice(4)}`;
  const config = paymentConfig(db);
  if (!config.appId || !config.appSecret) fail(503, '微信登录尚未配置');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', config.appId);
  url.searchParams.set('secret', config.appSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  const result = await fetch(url).then((response) => response.json());
  if (!result.openid) {
    console.warn('微信登录接口返回错误', { errcode: result.errcode });
    fail(401, wechatLoginError(result.errcode, result.errmsg));
  }
  return result.openid;
}

async function request(config, method, pathname, data) {
  const body = data ? JSON.stringify(data) : '';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const random = nonce();
  const signature = sign(config, `${method}\n${pathname}\n${timestamp}\n${random}\n${body}\n`);
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${random}",timestamp="${timestamp}",serial_no="${config.mchSerialNo}",signature="${signature}"`;
  const response = await fetch(`https://api.mch.weixin.qq.com${pathname}`, {
    method,
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'pickup-ordering/1.0',
    },
    body: body || undefined,
  });
  if (response.status === 204) return {};
  const raw = await response.text();
  const json = JSON.parse(raw || '{}');
  if (!response.ok) {
    const error = new Error(`微信支付请求失败：${json.message || response.status}`);
    error.status = 502;
    error.code = json.code;
    throw error;
  }
  const payTime = response.headers.get('wechatpay-timestamp');
  const payNonce = response.headers.get('wechatpay-nonce');
  const paySignature = response.headers.get('wechatpay-signature');
  const paySerial = response.headers.get('wechatpay-serial');
  if (
    !payTime ||
    !payNonce ||
    !paySignature ||
    (config.platformSerialNo && paySerial !== config.platformSerialNo) ||
    !crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${payTime}\n${payNonce}\n${raw}\n`),
      config.platformCert,
      Buffer.from(paySignature || '', 'base64'),
    )
  )
    fail(502, '微信支付响应签名校验失败');
  return json;
}

export async function createPrepay(db, order, openid, description = '到店自取餐食') {
  const config = paymentConfig(db);
  if (!paymentReady(config)) fail(503, '微信支付尚未配置');
  const result = await request(config, 'POST', '/v3/pay/transactions/jsapi', {
    appid: config.appId,
    mchid: config.mchId,
    description,
    time_expire: order.expires_at,
    out_trade_no: order.order_no,
    notify_url: `${config.publicBaseUrl.replace(/\/$/, '')}/api/pay/notify`,
    amount: { total: order.amount, currency: 'CNY' },
    payer: { openid },
  });
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = nonce();
  const packageValue = `prepay_id=${result.prepay_id}`;
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign: sign(config, `${config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`),
  };
}
export async function closePayment(db, orderNo) {
  if (paymentMode(db) !== 'wechat') return;
  const config = paymentConfig(db);
  try {
    await request(
      config,
      'POST',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}/close`,
      { mchid: config.mchId },
    );
  } catch (error) {
    if (['ORDER_NOT_EXIST', 'ORDER_CLOSED'].includes(error.code)) return;
    throw error;
  }
}
export async function lookupPayment(db, orderNo) {
  const config = paymentConfig(db);
  return request(
    config,
    'GET',
    `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(config.mchId)}`,
  );
}
export function verifyNotification(db, headers, rawBody) {
  const config = paymentConfig(db);
  if (!paymentReady(config)) fail(503, '支付通知未配置');
  const timestamp = headers['wechatpay-timestamp'];
  const random = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  if (!timestamp || !random || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    fail(401, '支付通知签名无效');
  if (config.platformSerialNo && headers['wechatpay-serial'] !== config.platformSerialNo)
    fail(401, '支付平台证书不匹配');
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${random}\n${rawBody}\n`),
    config.platformCert,
    Buffer.from(signature, 'base64'),
  );
  if (!valid) fail(401, '支付通知签名无效');
  const notification = JSON.parse(rawBody);
  const resource = notification.resource;
  const encrypted = Buffer.from(resource.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.apiV3Key),
    Buffer.from(resource.nonce),
  );
  decipher.setAAD(Buffer.from(resource.associated_data || ''));
  decipher.setAuthTag(encrypted.subarray(-16));
  const decrypted = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  return JSON.parse(decrypted.toString());
}
