import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';

test('现有顾客表升级后保留资料并增加管理字段', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-customers-'));
  const filename = path.join(directory, 'orders.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, openid TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  legacy.prepare('INSERT INTO users(openid,nickname) VALUES (?,?)').run('old-customer', '老顾客');
  legacy.close();
  try {
    const db = createDb(filename);
    const row = db
      .prepare('SELECT nickname,admin_note,disabled_at,disabled_reason,is_merchant FROM users WHERE openid=?')
      .get('old-customer');
    assert.equal(row.nickname, '老顾客');
    assert.equal(row.admin_note, '');
    assert.equal(row.disabled_at, null);
    assert.equal(row.disabled_reason, '');
    assert.equal(row.is_merchant, 0);
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('顾客管理可检索、查看订单、记录备注并安全停用及恢复账号', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_PAYMENT = 'true';
  process.env.SESSION_SECRET = 'customer-management-test-secret-123';
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
    assert.equal((await call('/admin/customers')).status, 401);
    const login = await call('/auth/wechat', 'POST', { code: 'dev:guest-1' });
    const guest = { Authorization: `Bearer ${login.data.token}` };
    await call('/me', 'PUT', { nickname: '小林', avatar: '' }, guest);
    const adminLogin = await call('/admin/login', 'POST', {
      username: 'admin',
      password: 'test-password',
    });
    const admin = { Cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
    const list = await call('/admin/customers?q=小林', 'GET', undefined, admin);
    assert.equal(list.status, 200);
    assert.equal(list.data.total, 1);
    const id = list.data.rows[0].id;
    assert.equal(list.data.rows[0].order_count, 0);
    assert.equal(
      (await call('/admin/customers?status=wrong', 'GET', undefined, admin)).status,
      400,
    );
    assert.equal((await call('/admin/customers/99999', 'GET', undefined, admin)).status, 404);

    const order = await call(
      '/orders',
      'POST',
      {
        items: [{ productId: 2, quantity: 1, selection: {} }],
      },
      guest,
    );
    assert.equal(order.status, 201);
    assert.equal(
      (await call(`/admin/customers?q=${order.data.order_no}`, 'GET', undefined, admin)).data.total,
      1,
    );
    const detail = await call(`/admin/customers/${id}`, 'GET', undefined, admin);
    assert.equal(detail.data.customer.order_count, 1);
    assert.equal(detail.data.orders[0].order_no, order.data.order_no);
    assert.equal(
      (
        await call(
          `/admin/customers/${id}/status`,
          'POST',
          { disabled: true, reason: '异常下单' },
          admin,
        )
      ).status,
      409,
    );

    await call(`/orders/${order.data.id}/mock-pay`, 'POST', {}, guest);
    for (const action of ['accept', 'ready', 'complete'])
      assert.equal(
        (await call(`/admin/orders/${order.data.id}/action`, 'POST', { action }, admin)).status,
        200,
      );
    const paid = await call(`/admin/customers/${id}`, 'GET', undefined, admin);
    assert.equal(paid.data.customer.paid_amount, order.data.amount);
    assert.equal(paid.data.customer.paid_order_count, 1);
    assert.equal(
      (await call(`/admin/customers/${id}/note`, 'PUT', { note: '偏好少盐' }, admin)).data
        .admin_note,
      '偏好少盐',
    );
    assert.equal(
      (await call(`/admin/customers/${id}/status`, 'POST', { disabled: true }, admin)).status,
      400,
    );
    assert.equal(
      (
        await call(
          `/admin/customers/${id}/status`,
          'POST',
          { disabled: true, reason: '异常下单' },
          admin,
        )
      ).status,
      200,
    );
    assert.equal((await call('/me', 'GET', undefined, guest)).status, 403);
    assert.equal((await call('/auth/wechat', 'POST', { code: 'dev:guest-1' })).status, 403);
    assert.equal(
      (await call('/admin/customers?status=disabled', 'GET', undefined, admin)).data.total,
      1,
    );
    assert.equal(
      (await call(`/admin/customers/${id}/status`, 'POST', { disabled: false }, admin)).status,
      200,
    );
    assert.equal((await call('/me', 'GET', undefined, guest)).status, 200);
    const audits = await call('/admin/audits', 'GET', undefined, admin);
    assert.ok(audits.data.some((row) => row.action === '停用顾客' && row.target_id === String(id)));
    assert.ok(audits.data.some((row) => row.action === '恢复顾客' && row.target_id === String(id)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
