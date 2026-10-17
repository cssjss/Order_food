import React from 'react';
import { Download, Save, ShieldCheck } from 'lucide-react';
import { api, json } from '../api';
import { Field, PageHeader } from '../components/Ui';

const empty = {
  appId: '',
  appSecret: '',
  publicBaseUrl: '',
  mchId: '',
  mchSerialNo: '',
  mchPrivateKey: '',
  platformSerialNo: '',
  platformCert: '',
  apiV3Key: '',
};
const secretKeys = ['appSecret', 'mchPrivateKey', 'platformCert', 'apiV3Key'];
const displayForm = (result) => ({
  ...empty,
  ...Object.fromEntries(
    Object.keys(empty)
      .filter((key) => !secretKeys.includes(key))
      .map((key) => [key, result[key] || '']),
  ),
});

function MiniProgramFields({ form, state, change }) {
  return (
    <section className="panel panel--padded">
      <div className="section-title">
        <div className="section-number">01</div>
        <div>
          <h2>小程序登录与服务域名</h2>
          <p>保存后，服务端会使用这些信息完成微信登录。</p>
        </div>
      </div>
      <div className="form-grid">
        <Field label="小程序 AppID">
          <input
            value={form.appId}
            onChange={(e) => change('appId', e.target.value)}
            placeholder="wx 开头的 AppID"
          />
        </Field>
        <Field
          label={`小程序 AppSecret · ${state.hasAppSecret ? '已配置' : '待配置'}`}
          hint="留空保留当前值；更换 AppID 时需要填写对应的新 AppSecret。"
        >
          <input
            type="password"
            autoComplete="off"
            value={form.appSecret}
            onChange={(e) => change('appSecret', e.target.value)}
            placeholder={state.hasAppSecret ? '留空保持原值' : '填写 AppSecret'}
          />
        </Field>
      </div>
      <Field
        label="HTTPS 服务域名"
        hint="小程序 API、头像上传、图片加载和支付通知共用此域名。只填域名，例如 https://order.example.com；需在微信公众平台登记 request、uploadFile、downloadFile 合法域名。"
      >
        <input
          type="url"
          value={form.publicBaseUrl}
          onChange={(e) => change('publicBaseUrl', e.target.value)}
          placeholder="https://order.example.com"
        />
      </Field>
    </section>
  );
}

function MerchantFields({ form, state, change }) {
  return (
    <section className="panel panel--padded">
      <div className="section-title">
        <div className="section-number">03</div>
        <div>
          <h2>微信支付商户</h2>
          <p>开通 JSAPI 支付后填写，可分次保存。密钥留空会保留已存值。</p>
        </div>
      </div>
      <div className="form-grid">
        <Field label="微信支付商户号">
          <input
            value={form.mchId}
            onChange={(e) => change('mchId', e.target.value)}
            placeholder="商户平台中的商户号"
          />
        </Field>
        <Field label="商户证书序列号">
          <input value={form.mchSerialNo} onChange={(e) => change('mchSerialNo', e.target.value)} />
        </Field>
        <Field label="微信支付平台证书序列号">
          <input
            value={form.platformSerialNo}
            onChange={(e) => change('platformSerialNo', e.target.value)}
            placeholder="用于确认平台证书版本"
          />
        </Field>
        <Field
          label={`API v3 密钥 · ${state.hasApiV3Key ? '已配置' : '待配置'}`}
          hint="微信商户平台设置的 32 字节密钥"
        >
          <input
            type="password"
            autoComplete="off"
            value={form.apiV3Key}
            onChange={(e) => change('apiV3Key', e.target.value)}
            placeholder={state.hasApiV3Key ? '留空保持原值' : '填写 API v3 密钥'}
          />
        </Field>
      </div>
      <Field label={`商户私钥 PEM · ${state.hasMchPrivateKey ? '已配置' : '待配置'}`}>
        <textarea
          rows="5"
          value={form.mchPrivateKey}
          onChange={(e) => change('mchPrivateKey', e.target.value)}
          placeholder={state.hasMchPrivateKey ? '留空保持原值' : '粘贴完整的 PRIVATE KEY PEM 内容'}
        />
      </Field>
      <Field label={`微信支付平台证书 PEM · ${state.hasPlatformCert ? '已配置' : '待配置'}`}>
        <textarea
          rows="5"
          value={form.platformCert}
          onChange={(e) => change('platformCert', e.target.value)}
          placeholder={state.hasPlatformCert ? '留空保持原值' : '粘贴完整的 CERTIFICATE PEM 内容'}
        />
      </Field>
    </section>
  );
}

export default function Payment({ notify }) {
  const [form, setForm] = React.useState(empty);
  const [state, setState] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    api('/admin/payment')
      .then((result) => {
        setState(result);
        setForm(displayForm(result));
      })
      .catch((e) => setError(e.message));
  }, []);
  const change = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const releaseDirty =
    state &&
    (form.appId.trim() !== state.appId || form.publicBaseUrl.trim() !== state.publicBaseUrl);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await json('PUT', '/admin/payment', form);
      setState(result);
      setForm(displayForm(result));
      notify('小程序与支付配置已保存');
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch('/api/admin/miniprogram-release', { credentials: 'include' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '下载失败');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'miniprogram-release.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('发布配置已下载');
    } catch (e) {
      notify(e.message);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="WECHAT / 小程序与支付"
        title="小程序与支付配置"
        description="先配置小程序登录和服务域名，再按需补齐微信支付商户资料。保存后服务端立即使用新配置。"
      />
      {error && <div className="inline-error">{error}，请刷新页面重试。</div>}
      {state && (
        <div className="payment-layout">
          <form className="payment-form" onSubmit={save}>
            <MiniProgramFields form={form} state={state} change={change} />
            <section className="panel panel--padded payment-release">
              <div className="section-title">
                <div className="section-number">02</div>
                <div>
                  <h2>小程序发布配置</h2>
                  <p>下载配置包并覆盖小程序源码中的同名文件，然后在微信开发者工具上传。</p>
                </div>
              </div>
              <p>配置包仅含 AppID 和 HTTPS 服务域名，不包含 AppSecret 或商户密钥。</p>
              <p>
                更换 AppID 或服务域名后，需要重新上传小程序；微信公众平台的合法域名也需同步设置。
              </p>
              <button
                type="button"
                className="button button--light"
                disabled={!state.releaseReady || releaseDirty || downloading || busy}
                onClick={download}
              >
                <Download size={17} />
                {downloading ? '下载中…' : '下载发布配置包'}
              </button>
              {!state.releaseReady && (
                <small>先保存小程序 AppID 和 HTTPS 服务域名，即可下载。</small>
              )}
              {releaseDirty && <small>请先保存更改，再下载最新配置。</small>}
            </section>
            <MerchantFields form={form} state={state} change={change} />
            <div className="payment-save">
              <button className="button button--primary" disabled={busy}>
                <Save size={17} />
                {busy ? '保存中…' : '保存配置'}
              </button>
            </div>
          </form>
          <aside className="payment-aside">
            <div className="payment-state">
              <ShieldCheck size={30} />
              <div className="eyebrow">当前接入状态</div>
              <h3>
                {state.ready
                  ? '微信支付资料齐全'
                  : state.miniProgramReady
                    ? '小程序登录已配置'
                    : '等待配置小程序'}
              </h3>
              <p>小程序登录：{state.miniProgramReady ? '已配置' : '待填写 AppID 和 AppSecret'}</p>
              <p>发布配置：{state.releaseReady ? '可下载' : '待填写 AppID 和服务域名'}</p>
              <p>微信支付：{state.ready ? '资料齐全，需真实订单验证' : '待补齐商户资料'}</p>
            </div>
            <div className="system-card">
              <h3>安全与上线</h3>
              <p>
                密钥由服务器的 CONFIG_ENCRYPTION_KEY
                加密保存，管理端不会返回原文。备份数据库时请同时保管该密钥。
              </p>
              <p>
                后台无法代替微信公众平台登记合法域名，也无法修改已发布小程序内的初始域名或 AppID。
              </p>
              <p>本地模拟支付仅用于开发；上线前请完成一笔真实小额支付验证。</p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
