import fs from 'node:fs';
import crypto from 'node:crypto';
import { fail } from './lib.js';
import { audit } from './db.js';

const keys = [
  'appId',
  'appSecret',
  'mchId',
  'mchSerialNo',
  'mchPrivateKey',
  'platformSerialNo',
  'platformCert',
  'apiV3Key',
  'publicBaseUrl',
];
const secrets = ['appSecret', 'mchPrivateKey', 'platformCert', 'apiV3Key'];
const appIdPattern = /^wx[a-zA-Z0-9]{16}$/;
export function serviceOrigin(value) {
  if (typeof value !== 'string' || !/^https:\/\/[a-zA-Z0-9.-]+\/?$/i.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(
      url.hostname,
    )
  )
    return null;
  return url.origin;
}
const file = (env) => {
  try {
    return env && fs.readFileSync(env, 'utf8');
  } catch {
    return '';
  }
};
const envConfig = () => ({
  appId: process.env.WECHAT_APP_ID || '',
  appSecret: process.env.WECHAT_APP_SECRET || '',
  mchId: process.env.WECHAT_MCH_ID || '',
  mchSerialNo: process.env.WECHAT_MCH_SERIAL_NO || '',
  mchPrivateKey: file(process.env.WECHAT_MCH_PRIVATE_KEY_PATH),
  platformSerialNo: process.env.WECHAT_PLATFORM_SERIAL_NO || '',
  platformCert: file(process.env.WECHAT_PLATFORM_CERT_PATH),
  apiV3Key: process.env.WECHAT_API_V3_KEY || '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
});
const encryptionKey = () => {
  const value = process.env.CONFIG_ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) fail(503, '服务器尚未配置支付设置加密密钥');
  return Buffer.from(value, 'hex');
};
function decrypt(value) {
  const data = JSON.parse(value);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(data.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(data.ciphertext, 'base64')),
      decipher.final(),
    ]).toString(),
  );
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}
export function paymentConfig(db) {
  const saved = db.prepare("SELECT value FROM settings WHERE key='paymentConfig'").get()?.value;
  return saved ? decrypt(saved) : envConfig();
}
export const paymentReady = (config) =>
  [
    'appId',
    'appSecret',
    'mchId',
    'mchSerialNo',
    'mchPrivateKey',
    'platformCert',
    'apiV3Key',
    'publicBaseUrl',
  ].every((key) => !!config[key]);
export const paymentPublic = (config) => ({
  ...Object.fromEntries(
    keys.filter((key) => !secrets.includes(key)).map((key) => [key, config[key] || '']),
  ),
  ...Object.fromEntries(
    secrets.map((key) => [`has${key[0].toUpperCase()}${key.slice(1)}`, !!config[key]]),
  ),
  miniProgramReady: !!(appIdPattern.test(config.appId || '') && config.appSecret),
  releaseReady: !!(appIdPattern.test(config.appId || '') && serviceOrigin(config.publicBaseUrl)),
  ready: paymentReady(config),
});
export function savePaymentConfig(db, input, actor) {
  const current = paymentConfig(db);
  const next = Object.fromEntries(
    keys.map((key) => [
      key,
      typeof input?.[key] === 'string'
        ? input[key].trim() || (secrets.includes(key) ? current[key] : '')
        : current[key],
    ]),
  );
  // AppSecret belongs to one AppID. Reusing it after an AppID change would report a false ready state.
  if (
    next.appId !== current.appId &&
    !(typeof input?.appSecret === 'string' && input.appSecret.trim())
  )
    next.appSecret = '';
  if (next.appId && !appIdPattern.test(next.appId)) fail(400, '小程序 AppID 格式无效');
  if (next.apiV3Key && Buffer.byteLength(next.apiV3Key) !== 32)
    fail(400, 'API v3 密钥必须是 32 字节');
  if (next.publicBaseUrl) {
    const origin = serviceOrigin(next.publicBaseUrl);
    if (!origin) fail(400, '服务域名必须是 HTTPS 域名，不带端口、路径或参数');
    next.publicBaseUrl = origin;
  }
  if (next.mchPrivateKey) {
    try {
      crypto.createPrivateKey(next.mchPrivateKey);
    } catch {
      fail(400, '商户私钥格式无效，请粘贴完整 PEM 内容');
    }
  }
  if (next.platformCert) {
    try {
      crypto.createPublicKey(next.platformCert);
    } catch {
      fail(400, '微信支付平台证书格式无效，请粘贴完整 PEM 内容');
    }
  }
  db.prepare(
    "INSERT INTO settings(key,value) VALUES ('paymentConfig',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(encrypt(next));
  audit(db, actor, '更新小程序与支付配置', 'settings', 'payment');
  return paymentPublic(next);
}
