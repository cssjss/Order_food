import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';

test('管理员指定商家后微信账号可处理订单，撤销后立即失去权限', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_PAYMENT = 'true';
  process.env.SESSION_SECRET = 'merchant-role-test-secret-123456789';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'test-password';
  const db = createDb(':memory:');
  const { app } = createApp(db);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  try {
    const merchantLogin = await call('/auth/wechat', 'POST', { code: 'dev:merchant-user' });
    const merchant = { Authorization: `Bearer ${merchantLogin.data.token}` };
    const buyerLogin = await call('/auth/wechat', 'POST', { code: 'dev:buyer-user' });
    const buyer = { Authorization: `Bearer ${buyerLogin.data.token}` };
    await call('/me', 'PUT', { nickname: '测试商家', avatar: '' }, merchant);
    assert.equal(merchantLogin.data.profile.isMerchant, false);
    assert.equal((await call('/merchant/orders', 'GET', undefined, merchant)).status, 403);
    assert.equal((await call('/merchant/orders', 'GET', undefined, buyer)).status, 403);
    const adminLogin = await call('/admin/login', 'POST', {
      username: 'admin',
      password: 'test-password',
    });
    const admin = { Cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
    const id = (await call('/admin/customers?q=测试商家', 'GET', undefined, admin)).data.rows[0].id;
    assert.equal((await call(`/admin/customers/${id}/merchant`, 'POST', {}, admin)).status, 400);
    const granted = await call(
      `/admin/customers/${id}/merchant`,
      'POST',
      { isMerchant: true },
      admin,
    );
    assert.equal(granted.status, 200);
    assert.equal(granted.data.is_merchant, 1);
    assert.equal((await call('/me', 'GET', undefined, merchant)).data.isMerchant, true);
    assert.equal((await call('/auth/wechat', 'POST', { code: 'dev:merchant-user' })).data.profile.isMerchant, true);
    assert.equal((await call('/merchant/orders', 'GET', undefined, merchant)).status, 200);
    assert.equal((await call('/merchant/orders', 'GET', undefined, buyer)).status, 403);

    const order = await call(
      '/orders',
      'POST',
      { items: [{ productId: 2, quantity: 1, selection: {} }] },
      buyer,
    );
    await call(`/orders/${order.data.id}/mock-pay`, 'POST', {}, buyer);
    assert.equal((await call(`/merchant/orders/${order.data.id}/action`, 'POST', { action: 'accept' }, buyer)).status, 403);
    for (const [action, status] of [
      ['accept', 'PREPARING'],
      ['ready', 'READY'],
      ['complete', 'COMPLETED'],
    ]) {
      const result = await call(
        `/merchant/orders/${order.data.id}/action`,
        'POST',
        { action },
        merchant,
      );
      assert.equal(result.data.status, status);
    }
    assert.equal(
      (await call(`/merchant/orders/${order.data.id}/print`, 'POST', {}, merchant)).data.configured,
      false,
    );
    const revoked = await call(
      `/admin/customers/${id}/merchant`,
      'POST',
      { isMerchant: false },
      admin,
    );
    assert.equal(revoked.data.is_merchant, 0);
    assert.equal((await call('/merchant/orders', 'GET', undefined, merchant)).status, 403);
    assert.equal((await call(`/merchant/orders/${order.data.id}`, 'GET', undefined, merchant)).status, 403);
    const audits = (await call('/admin/audits', 'GET', undefined, admin)).data;
    assert.ok(audits.some((row) => row.action === '授予商家身份' && row.target_id === String(id)));
    assert.ok(audits.some((row) => row.action === '取消商家身份' && row.target_id === String(id)));
    assert.ok(audits.some((row) => row.action === '接单' && row.actor === `商家 ${id}`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
