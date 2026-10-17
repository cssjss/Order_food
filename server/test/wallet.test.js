import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { savePaymentConfig } from '../src/payment-config.js';

test('现有订单库升级后保留订单并建立余额流水表', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-wallet-'));
  const filename = path.join(directory, 'orders.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, openid TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL, amount INTEGER NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, paid_at TEXT, updated_at TEXT NOT NULL, refund_note TEXT NOT NULL DEFAULT '', stock_released INTEGER NOT NULL DEFAULT 0, client_request_id TEXT);
    INSERT INTO users(id,openid) VALUES (1,'old-user');
    INSERT INTO orders(id,order_no,user_id,status,amount,created_at,expires_at,updated_at) VALUES (1,'old-order',1,'COMPLETED',1200,'2026-01-01','2026-01-01','2026-01-01');
  `);
  legacy.close();
  try {
    const db = createDb(filename);
    assert.equal(
      db.prepare('SELECT payment_method FROM orders WHERE id=1').get().payment_method,
      'wechat',
    );
    assert.equal(db.prepare('SELECT amount FROM orders WHERE id=1').get().amount, 1200);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM wallet_entries').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM wallet_topups').get().count, 0);
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function setup(mock = true) {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_PAYMENT = mock ? 'true' : 'false';
  process.env.SESSION_SECRET = 'wallet-test-secret-with-enough-length';
  process.env.CONFIG_ENCRYPTION_KEY = 'b'.repeat(64);
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'test-password';
  const db = createDb(':memory:');
  const { app } = createApp(db);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (pathname, method = 'GET', body, headers = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };
  return { db, base, call, close };
}

test('余额充值、支付、退款及商家增减保持余额和流水一致', async () => {
  const { db, call, close } = setup();
  try {
    const login = await call('/auth/wechat', 'POST', { code: 'dev:wallet-a' });
    const user = { Authorization: `Bearer ${login.data.token}` };
    const otherLogin = await call('/auth/wechat', 'POST', { code: 'dev:wallet-b' });
    const other = { Authorization: `Bearer ${otherLogin.data.token}` };
    const adminLogin = await call('/admin/login', 'POST', {
      username: 'admin',
      password: 'test-password',
    });
    const admin = { Cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
    assert.equal(
      (
        await call(
          '/wallet/topups',
          'POST',
          { amount: 50, clientRequestId: 'wallet-request-1' },
          user,
        )
      ).status,
      400,
    );
    const payload = { amount: 5000, clientRequestId: 'wallet-request-1' };
    const topup = await call('/wallet/topups', 'POST', payload, user);
    assert.equal(topup.status, 201);
    assert.equal((await call('/wallet/topups', 'POST', payload, user)).data.id, topup.data.id);
    assert.equal(
      (await call('/wallet/topups', 'POST', { ...payload, amount: 6000 }, user)).status,
      409,
    );
    assert.equal(
      (await call(`/wallet/topups/${topup.data.id}/pay`, 'POST', {}, other)).status,
      404,
    );
    assert.equal(
      (await call(`/wallet/topups/${topup.data.id}/pay`, 'POST', {}, user)).data.mock,
      true,
    );
    assert.equal(
      (await call(`/wallet/topups/${topup.data.id}/mock-pay`, 'POST', {}, user)).data.balance,
      5000,
    );
    assert.equal(
      (await call(`/wallet/topups/${topup.data.id}/mock-pay`, 'POST', {}, user)).data.balance,
      5000,
    );
    const customerId = db.prepare('SELECT id FROM users WHERE openid=?').get('dev-wallet-a').id;
    assert.equal(
      (await call(`/admin/customers/${customerId}`, 'GET', undefined, admin)).data.customer.balance,
      5000,
    );

    const first = await call(
      '/orders',
      'POST',
      { items: [{ productId: 2, quantity: 1, selection: {} }] },
      user,
    );
    const second = await call(
      '/orders',
      'POST',
      { items: [{ productId: 2, quantity: 1, selection: {} }] },
      user,
    );
    const results = await Promise.all([
      call(`/orders/${first.data.id}/balance-pay`, 'POST', {}, user),
      call(`/orders/${second.data.id}/balance-pay`, 'POST', {}, user),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const paid = results[0].status === 200 ? first.data : second.data;
    const unpaid = results[0].status === 200 ? second.data : first.data;
    assert.equal((await call('/wallet', 'GET', undefined, user)).data.balance, 1720);
    assert.equal((await call(`/orders/${paid.id}/balance-pay`, 'POST', {}, user)).status, 409);
    assert.equal(
      (await call(`/orders/${unpaid.id}/cancel`, 'POST', {}, user)).data.status,
      'CANCELLED',
    );
    const refund = await call(
      `/admin/orders/${paid.id}/action`,
      'POST',
      { action: 'reject', reason: '无法制作' },
      admin,
    );
    assert.equal(refund.data.status, 'REFUNDED');
    assert.equal((await call('/wallet', 'GET', undefined, user)).data.balance, 5000);
    assert.equal(
      (
        await call(
          `/admin/orders/${paid.id}/action`,
          'POST',
          { action: 'reject', reason: '重复' },
          admin,
        )
      ).status,
      409,
    );

    assert.equal(
      (
        await call(
          `/admin/customers/${customerId}/wallet/debit`,
          'POST',
          { amount: 1200, reason: '客服协商调整', clientRequestId: 'admin-wallet-1' },
          other,
        )
      ).status,
      401,
    );
    const debit = { amount: 1200, reason: '客服协商调整', clientRequestId: 'admin-wallet-1' };
    assert.equal(
      (await call(`/admin/customers/${customerId}/wallet/debit`, 'POST', debit, admin)).data
        .balance,
      3800,
    );
    assert.equal(
      (await call(`/admin/customers/${customerId}/wallet/debit`, 'POST', debit, admin)).data
        .balance,
      3800,
    );
    assert.equal(
      (
        await call(
          `/admin/customers/${customerId}/wallet/debit`,
          'POST',
          { ...debit, amount: 1300 },
          admin,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          `/admin/customers/${customerId}/wallet/debit`,
          'POST',
          { amount: 5000, reason: '超额', clientRequestId: 'admin-wallet-2' },
          admin,
        )
      ).status,
      409,
    );
    const wallet = await call('/wallet', 'GET', undefined, user);
    assert.deepEqual(wallet.data.entries.map((entry) => entry.kind).sort(), [
      'ADMIN_DEBIT',
      'ORDER_PAYMENT',
      'ORDER_REFUND',
      'TOPUP',
    ]);
    assert.equal(wallet.data.balance, 3800);
    assert.equal((await call('/me', 'GET', undefined, user)).data.balance, 3800);

    const creditPath = `/admin/customers/${customerId}/wallet/credit`;
    const credit = { amount: 2500, reason: '活动补偿', clientRequestId: 'admin-credit-1' };
    assert.equal((await call(creditPath, 'POST', credit, other)).status, 401);
    assert.equal((await call(creditPath, 'POST', { ...credit, amount: 0 }, admin)).status, 400);
    assert.equal((await call(creditPath, 'POST', { ...credit, reason: '' }, admin)).status, 400);
    assert.equal(
      (await call(creditPath, 'POST', { ...credit, clientRequestId: 'bad' }, admin)).status,
      400,
    );
    assert.equal((await call(creditPath, 'POST', credit, admin)).data.balance, 6300);
    assert.equal((await call(creditPath, 'POST', credit, admin)).data.balance, 6300);
    assert.equal((await call(creditPath, 'POST', { ...credit, amount: 2600 }, admin)).status, 409);
    assert.equal(
      (await call(creditPath, 'POST', { ...credit, reason: '不同原因' }, admin)).status,
      409,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM wallet_entries WHERE kind='ADMIN_CREDIT'").get()
        .count,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM audits WHERE action='增加顾客余额'").get().count,
      1,
    );
    const creditedWallet = await call('/wallet', 'GET', undefined, user);
    assert.equal(creditedWallet.data.balance, 6300);
    assert.equal(
      creditedWallet.data.entries.find((entry) => entry.kind === 'ADMIN_CREDIT').detail,
      '活动补偿',
    );
    assert.equal((await call('/me', 'GET', undefined, user)).data.balance, 6300);

    const initiated = await call(
      '/orders',
      'POST',
      { items: [{ productId: 2, quantity: 1, selection: {} }] },
      user,
    );
    assert.equal(
      (await call(`/orders/${initiated.data.id}/pay`, 'POST', {}, user)).data.mock,
      true,
    );
    assert.equal(
      (await call(`/orders/${initiated.data.id}/balance-pay`, 'POST', {}, user)).status,
      409,
    );
    assert.equal(
      (await call(`/orders/${initiated.data.id}/mock-pay`, 'POST', {}, user)).data.payment_method,
      'mock',
    );
    assert.equal((await call('/wallet', 'GET', undefined, user)).data.balance, 6300);
  } finally {
    await close();
  }
});

test('已签名的微信充值通知只入账一次，错误金额不能入账', async () => {
  const { db, base, call, close } = setup(false);
  try {
    const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const platform = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const appId = 'wx1234567890abcdef';
    const mchId = '1234567890';
    const apiV3Key = '12345678901234567890123456789012';
    savePaymentConfig(
      db,
      {
        appId,
        appSecret: 'test-secret',
        mchId,
        mchSerialNo: 'ABC123',
        mchPrivateKey: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        platformSerialNo: 'DEF456',
        platformCert: platform.publicKey.export({ type: 'spki', format: 'pem' }),
        apiV3Key,
        publicBaseUrl: 'https://order.example.com',
      },
      'test',
    );
    const login = await call('/auth/wechat', 'POST', { code: 'dev:wallet-notify' });
    const user = { Authorization: `Bearer ${login.data.token}` };
    const topup = (
      await call(
        '/wallet/topups',
        'POST',
        { amount: 2000, clientRequestId: 'wallet-notify-1' },
        user,
      )
    ).data;
    const sendNotification = async (amount, transactionId, validSignature = true) => {
      const nonce = '0123456789ab';
      const associatedData = 'transaction';
      const plain = JSON.stringify({
        trade_state: 'SUCCESS',
        appid: appId,
        mchid: mchId,
        out_trade_no: topup.topup_no,
        amount: { total: amount },
        transaction_id: transactionId,
      });
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        Buffer.from(apiV3Key),
        Buffer.from(nonce),
      );
      cipher.setAAD(Buffer.from(associatedData));
      const ciphertext = Buffer.concat([
        cipher.update(plain),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString('base64');
      const raw = JSON.stringify({
        resource: { ciphertext, nonce, associated_data: associatedData },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const random = 'notification-nonce';
      const signature = crypto
        .sign('RSA-SHA256', Buffer.from(`${timestamp}\n${random}\n${raw}\n`), platform.privateKey)
        .toString('base64');
      return fetch(`${base}/pay/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'wechatpay-timestamp': timestamp,
          'wechatpay-nonce': random,
          'wechatpay-signature': validSignature ? signature : 'invalid-signature',
          'wechatpay-serial': 'DEF456',
        },
        body: raw,
      });
    };
    assert.equal((await sendNotification(2000, 'wx-tx-forged', false)).status, 401);
    assert.equal((await sendNotification(1900, 'wx-tx-wrong')).status, 400);
    assert.equal((await call('/wallet', 'GET', undefined, user)).data.balance, 0);
    assert.equal((await sendNotification(2000, 'wx-tx-good')).status, 200);
    assert.equal((await sendNotification(2000, 'wx-tx-good')).status, 200);
    assert.equal((await call('/wallet', 'GET', undefined, user)).data.balance, 2000);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM wallet_entries WHERE kind='TOPUP'").get().count,
      1,
    );
  } finally {
    await close();
  }
});
