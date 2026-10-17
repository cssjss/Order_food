import test from 'node:test';
import assert from 'node:assert/strict';
import { wechatLoginError } from '../src/wechat.js';

test('微信登录错误指出可操作的配置问题，不暴露平台原始响应', () => {
  assert.match(
    wechatLoginError(40164, 'invalid ip 47.104.141.32 ipv6 ::ffff:47.104.141.32, rid: abc'),
    /47\.104\.141\.32.*接口 IP 白名单/,
  );
  assert.match(wechatLoginError(40125), /AppSecret/);
  assert.match(wechatLoginError(40013), /AppID/);
  assert.match(wechatLoginError(40029), /重试/);
  assert.equal(wechatLoginError(12345), '微信登录失败，请重试');
});
