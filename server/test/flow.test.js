import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';

test('下单、付款、接单、完结、超时及库存恢复', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_PAYMENT = 'true';
  process.env.SESSION_SECRET = 'test-session-secret-with-enough-length';
  process.env.CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'test-password';
  const db = createDb(':memory:');
  const { app, expireOrders } = createApp(db);
  const server = app.listen(0);
  let uploadedFile = '';
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  try {
    const publicStore = await call('/store');
    assert.equal(publicStore.status, 200);
    assert.equal(publicStore.data.products.length, 3);
    assert.equal((await call('/admin/orders')).status, 401);

    const login = await call('/auth/wechat', 'POST', { code: 'dev:customer-a' });
    assert.equal(login.status, 200);
    const customer = { Authorization: `Bearer ${login.data.token}` };
    const imageForm = new FormData();
    imageForm.append(
      'image',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+y0AAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        { type: 'application/octet-stream' },
      ),
      'avatar.png',
    );
    const uploaded = await fetch(`${base}/api/me/avatar`, {
      method: 'POST',
      headers: customer,
      body: imageForm,
    });
    assert.equal(uploaded.status, 200);
    const uploadUrl = (await uploaded.json()).url;
    uploadedFile = path.resolve(import.meta.dirname, '../../uploads', path.basename(uploadUrl));
    assert.equal(
      (await fetch(`${base}${uploadUrl}`)).headers.get('x-content-type-options'),
      'nosniff',
    );
    const invalid = await call(
      '/orders',
      'POST',
      { items: [{ productId: 1, quantity: 1, selection: {} }] },
      customer,
    );
    assert.equal(invalid.status, 400);
    const firstPayload = {
      items: [{ productId: 1, quantity: 2, selection: { 份量: '加大份', 口味: '微辣' } }],
      remark: '少盐',
      clientRequestId: 'request-000001',
    };
    const first = await call('/orders', 'POST', firstPayload, customer);
    assert.equal(first.status, 201);
    assert.equal(first.data.amount, 6360);
    assert.equal(first.data.status, 'PENDING_PAYMENT');
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock, 28);
    assert.equal((await call('/orders', 'POST', firstPayload, customer)).data.id, first.data.id);
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock, 28);
    assert.equal(
      (await call(`/orders/${first.data.id}/pay`, 'POST', {}, customer)).data.mock,
      true,
    );
    assert.equal(
      (await call(`/orders/${first.data.id}/mock-pay`, 'POST', {}, customer)).data.status,
      'PENDING_ACCEPTANCE',
    );

    const adminLogin = await call('/admin/login', 'POST', {
      username: 'admin',
      password: 'test-password',
    });
    assert.equal(adminLogin.status, 200);
    const admin = { Cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
    assert.equal((await call('/admin/overview', 'GET', undefined, admin)).data.pending, 1);
    for (const [action, expected] of [
      ['accept', 'PREPARING'],
      ['ready', 'READY'],
      ['complete', 'COMPLETED'],
    ]) {
      const result = await call(`/admin/orders/${first.data.id}/action`, 'POST', { action }, admin);
      assert.equal(result.data.status, expected);
    }
    assert.equal(
      (await call(`/admin/orders/${first.data.id}/action`, 'POST', { action: 'complete' }, admin))
        .status,
      409,
    );
    const report = await call('/admin/stats', 'GET', undefined, admin);
    assert.equal(report.data.daily[0].revenue, 6360);
    const excel = await fetch(`${base}/api/admin/orders-export`, { headers: admin });
    assert.equal(excel.status, 200);
    const files = unzipSync(new Uint8Array(await excel.arrayBuffer()));
    assert.ok(
      new TextDecoder().decode(files['xl/worksheets/sheet1.xml']).includes(first.data.order_no),
    );

    const second = await call(
      '/orders',
      'POST',
      { items: [{ productId: 2, quantity: 1, selection: {} }] },
      customer,
    );
    assert.equal(second.status, 201);
    db.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(
      new Date(Date.now() - 1000).toISOString(),
      second.data.id,
    );
    await expireOrders();
    assert.equal(
      (await call(`/orders/${second.data.id}`, 'GET', undefined, customer)).data.status,
      'CANCELLED',
    );
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=2').get().stock, 20);

    const rejected = await call(
      '/orders',
      'POST',
      { items: [{ productId: 2, quantity: 1, selection: {} }] },
      customer,
    );
    await call(`/orders/${rejected.data.id}/mock-pay`, 'POST', {}, customer);
    assert.equal(
      (
        await call(
          `/admin/orders/${rejected.data.id}/action`,
          'POST',
          { action: 'reject', reason: '无法制作' },
          admin,
        )
      ).data.status,
      'REFUND_PENDING',
    );
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=2').get().stock, 19);
    assert.equal(
      (
        await call(
          `/admin/orders/${rejected.data.id}/action`,
          'POST',
          { action: 'refunded', reason: '微信商户平台退款单 123' },
          admin,
        )
      ).data.status,
      'REFUNDED',
    );
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=2').get().stock, 20);
    assert.equal(
      (
        await call(
          `/admin/orders/${rejected.data.id}/action`,
          'POST',
          { action: 'refunded', reason: '重复' },
          admin,
        )
      ).status,
      409,
    );

    db.prepare('UPDATE products SET stock=1 WHERE id=3').run();
    const concurrent = await Promise.all([
      call('/orders', 'POST', { items: [{ productId: 3, quantity: 1 }] }, customer),
      call('/orders', 'POST', { items: [{ productId: 3, quantity: 1 }] }, customer),
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
    const pending = concurrent.find((result) => result.status === 201).data;
    assert.equal(
      (await call(`/orders/${pending.id}/cancel`, 'POST', {}, customer)).data.status,
      'CANCELLED',
    );
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=3').get().stock, 1);

    const otherLogin = await call('/auth/wechat', 'POST', { code: 'dev:customer-b' });
    assert.equal(
      (
        await call(`/orders/${first.data.id}`, 'GET', undefined, {
          Authorization: `Bearer ${otherLogin.data.token}`,
        })
      ).status,
      404,
    );
    const settings = await call('/admin/settings', 'GET', undefined, admin);
    const update = await call(
      '/admin/settings',
      'PUT',
      { ...settings.data, page: { ...settings.data.page, heroTitle: '测试标题' } },
      admin,
    );
    assert.equal(update.status, 200);
    assert.equal((await call('/store')).data.page.heroTitle, '测试标题');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const payment = await call(
      '/admin/payment',
      'PUT',
      {
        appId: 'wx1234567890abcdef',
        appSecret: 'test-secret',
        mchId: '1234567890',
        mchSerialNo: 'ABC123',
        mchPrivateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        platformSerialNo: 'DEF456',
        platformCert: publicKey.export({ type: 'spki', format: 'pem' }),
        apiV3Key: '12345678901234567890123456789012',
        publicBaseUrl: 'https://order.example.com',
      },
      admin,
    );
    assert.equal(payment.status, 200);
    assert.equal(payment.data.ready, true);
    assert.equal(payment.data.appSecret, undefined);
    assert.equal((await call('/admin/payment', 'GET', undefined, admin)).data.hasAppSecret, true);
    assert.equal(
      db
        .prepare("SELECT value FROM settings WHERE key='paymentConfig'")
        .get()
        .value.includes('test-secret'),
      false,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    if (uploadedFile && fs.existsSync(uploadedFile)) fs.unlinkSync(uploadedFile);
  }
});
