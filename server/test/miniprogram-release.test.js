import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';

test('小程序配置可分阶段保存，发布包仅包含公开参数', async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-session-secret-with-enough-length';
  process.env.CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'test-password';
  const db = createDb(':memory:');
  const server = createApp(db).app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, options = {}) => fetch(`${base}${path}`, options);
  try {
    assert.equal((await request('/admin/miniprogram-release')).status, 401);
    const login = await request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password' }),
    });
    const headers = {
      Cookie: login.headers.get('set-cookie').split(';')[0],
      'Content-Type': 'application/json',
    };
    assert.equal((await request('/admin/miniprogram-release', { headers })).status, 409);
    const save = async (body) => {
      const response = await request('/admin/payment', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    const partial = await save({ appId: 'wx1234567890abcdef', appSecret: 'private-app-secret' });
    assert.equal(partial.status, 200);
    assert.equal(partial.data.miniProgramReady, true);
    assert.equal(partial.data.releaseReady, false);
    assert.equal(partial.data.ready, false);
    assert.equal(partial.data.appSecret, undefined);
    assert.equal((await request('/admin/miniprogram-release', { headers })).status, 409);
    assert.equal((await save({ publicBaseUrl: 'https://order.example.com/path' })).status, 400);
    assert.equal((await save({ publicBaseUrl: 'https://order.example.com:8443' })).status, 400);
    assert.equal((await save({ publicBaseUrl: 'https://order.example.com:443' })).status, 400);
    const configured = await save({ publicBaseUrl: 'https://order.example.com' });
    assert.equal(configured.data.releaseReady, true);
    assert.equal(configured.data.miniProgramReady, true);
    assert.equal(configured.data.ready, false);
    const response = await request('/admin/miniprogram-release', { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/zip/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const source = new TextDecoder().decode(files['config.js']);
    const project = JSON.parse(new TextDecoder().decode(files['project.config.json']));
    assert.match(source, /apiBase: "https:\/\/order.example.com"/);
    assert.match(source, /devLogin: false/);
    assert.equal(project.appid, 'wx1234567890abcdef');
    assert.equal(project.setting.urlCheck, true);
    const allFiles = Object.values(files)
      .map((data) => new TextDecoder().decode(data))
      .join('\n');
    assert.equal(allFiles.includes('private-app-secret'), false);
    assert.equal(allFiles.includes('CONFIG_ENCRYPTION_KEY='), false);
    const changed = await save({ appId: 'wxabcdef1234567890' });
    assert.equal(changed.data.hasAppSecret, false);
    assert.equal(changed.data.miniProgramReady, false);
    assert.equal(changed.data.releaseReady, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
