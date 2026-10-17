import React from 'react';
import { UploadCloud, Save, MapPin, Clock3, Search, ShoppingBag, UserRound } from 'lucide-react';
import { api, json, yuan } from '../api';
import { Field, PageHeader } from '../components/Ui';

export default function PageSettings({ notify }) {
  const [form, setForm] = React.useState(null);
  const [products, setProducts] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    Promise.all([api('/admin/settings'), api('/admin/products')])
      .then(([settings, items]) => {
        setForm(settings);
        setProducts(items.filter((p) => p.enabled && p.featured));
      })
      .catch((e) => setError(e.message));
  }, []);
  const change = (area, key, value) =>
    setForm((prev) => ({ ...prev, [area]: { ...prev[area], [key]: value } }));
  const upload = async (file) => {
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    try {
      const result = await api('/admin/upload', { method: 'POST', body });
      change('page', 'heroImage', result.url);
    } catch (e) {
      notify(e.message);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      setForm(await json('PUT', '/admin/settings', form));
      notify('页面配置已保存，小程序刷新后生效');
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="STOREFRONT / 页面配置"
        title="页面配置"
        description="编辑店铺信息与小程序首页展示内容，右侧可预览主要布局。"
        action={
          <button className="button button--primary" disabled={busy || !form} onClick={save}>
            <Save size={17} /> {busy ? '保存中…' : '保存并发布'}
          </button>
        }
      />
      {error && <div className="inline-error">{error}</div>}
      {form && (
        <div className="settings-layout">
          <div className="settings-form">
            <section className="panel panel--padded">
              <div className="section-title">
                <div className="section-number">01</div>
                <div>
                  <h2>店铺信息</h2>
                  <p>显示在首页和个人中心，帮助顾客确认取餐信息。</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="店铺名称">
                  <input
                    value={form.shop.name}
                    onChange={(e) => change('shop', 'name', e.target.value)}
                  />
                </Field>
                <Field label="营业时间">
                  <input
                    value={form.shop.hours}
                    onChange={(e) => change('shop', 'hours', e.target.value)}
                    placeholder="每天 10:00–21:00"
                  />
                </Field>
                <Field label="联系电话">
                  <input
                    value={form.shop.phone}
                    onChange={(e) => change('shop', 'phone', e.target.value)}
                    placeholder="顾客可一键拨打"
                  />
                </Field>
                <Field label="取餐地址">
                  <input
                    value={form.shop.pickupAddress}
                    onChange={(e) => change('shop', 'pickupAddress', e.target.value)}
                    placeholder="门店详细地址"
                  />
                </Field>
              </div>
              <Field label="店铺公告">
                <textarea
                  rows="3"
                  value={form.shop.notice}
                  onChange={(e) => change('shop', 'notice', e.target.value)}
                />
              </Field>
              <Field label="取餐提示">
                <textarea
                  rows="2"
                  value={form.shop.pickupGuide}
                  onChange={(e) => change('shop', 'pickupGuide', e.target.value)}
                />
              </Field>
            </section>
            <section className="panel panel--padded">
              <div className="section-title">
                <div className="section-number">02</div>
                <div>
                  <h2>首页展示</h2>
                  <p>首页主视觉、推荐菜品和公告显示方式。</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="主标题">
                  <input
                    value={form.page.heroTitle}
                    onChange={(e) => change('page', 'heroTitle', e.target.value)}
                  />
                </Field>
                <Field label="副标题">
                  <input
                    value={form.page.heroSubtitle}
                    onChange={(e) => change('page', 'heroSubtitle', e.target.value)}
                  />
                </Field>
              </div>
              <label className="banner-upload">
                {form.page.heroImage ? (
                  <img src={form.page.heroImage} alt="首页横幅预览" />
                ) : (
                  <div>
                    <UploadCloud size={26} />
                    <strong>上传首页横幅</strong>
                    <small>JPG、PNG、WebP，最多 5 MB</small>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => upload(e.target.files[0])}
                />
              </label>
              <div className="form-grid">
                <Field label="主题颜色" hint="按钮与重点文字使用此颜色">
                  <input
                    type="color"
                    value={form.page.accent}
                    onChange={(e) => change('page', 'accent', e.target.value)}
                  />
                </Field>
                <Field label="推荐区标题">
                  <input
                    value={form.page.featuredTitle}
                    onChange={(e) => change('page', 'featuredTitle', e.target.value)}
                  />
                </Field>
              </div>
              <div className="check-row">
                <label>
                  <input
                    type="checkbox"
                    checked={form.page.showNotice}
                    onChange={(e) => change('page', 'showNotice', e.target.checked)}
                  />{' '}
                  首页显示公告
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.page.showFeatured}
                    onChange={(e) => change('page', 'showFeatured', e.target.checked)}
                  />{' '}
                  显示推荐菜品
                </label>
              </div>
              <Field label="个人中心寄语">
                <input
                  value={form.page.profileMessage}
                  onChange={(e) => change('page', 'profileMessage', e.target.value)}
                />
              </Field>
            </section>
            <div className="settings-note">
              推荐菜品在“菜品与分类”中勾选“首页推荐”。微信支付密钥、商户号与打印服务地址通过服务器环境变量配置，避免在网页中暴露。
            </div>
          </div>
          <aside className="preview-area">
            <div className="preview-area__label">
              小程序首页预览 <span>实时预览内容</span>
            </div>
            <div className="phone">
              <div className="phone__status">
                9:41 <span>●●● ▪</span>
              </div>
              <div className="phone__top">
                <strong>{form.shop.name || '店铺名称'}</strong>
                <span>···</span>
              </div>
              <div className="phone__body" style={{ '--phone-accent': form.page.accent }}>
                <div
                  className="phone__hero"
                  style={
                    form.page.heroImage
                      ? {
                          backgroundImage: `linear-gradient(90deg,rgba(0,0,0,.45),transparent),url(${form.page.heroImage})`,
                        }
                      : {}
                  }
                >
                  <small>{form.page.heroSubtitle}</small>
                  <strong>{form.page.heroTitle || '首页标题'}</strong>
                  <span>立即点餐 →</span>
                </div>
                <div className="phone__info">
                  <div>
                    <Clock3 size={13} /> {form.shop.hours || '营业时间'}
                  </div>
                  <div>
                    <MapPin size={13} /> {form.shop.pickupAddress || '到店自取'}
                  </div>
                </div>
                {form.page.showNotice && (
                  <div className="phone__notice">公告　{form.shop.notice || '店铺公告'}</div>
                )}
                <div className="phone__search">
                  <Search size={14} /> 搜索喜欢的菜品
                </div>
                {form.page.showFeatured && (
                  <>
                    <h4>
                      {form.page.featuredTitle || '今日推荐'} <span>查看更多 →</span>
                    </h4>
                    <div className="phone__products">
                      {products.slice(0, 2).map((p) => (
                        <div key={p.id}>
                          <div>{p.image && <img src={p.image} alt="" />}</div>
                          <strong>{p.name}</strong>
                          <span>{yuan(p.base_price)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="phone__tabs">
                <span>
                  ⌂<small>首页</small>
                </span>
                <span>
                  <ShoppingBag size={16} />
                  <small>购物车</small>
                </span>
                <span>
                  <UserRound size={16} />
                  <small>我的</small>
                </span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
