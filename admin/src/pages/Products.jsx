import React from 'react';
import { Plus, UploadCloud, ChevronUp, ChevronDown, Pencil, Package } from 'lucide-react';
import { api, json, yuan } from '../api';
import { Empty, Field, Modal, PageHeader } from '../components/Ui';

const freshProduct = (categoryId) => ({
  category_id: categoryId || '',
  name: '',
  description: '',
  image: '',
  base_price: 0,
  stock: 20,
  enabled: true,
  featured: false,
  options: [],
});
const yuanInput = (cents) => (Number(cents || 0) / 100).toFixed(2);
const fromYuan = (value) => Math.round(Number(value || 0) * 100);

function ProductEditor({ product, categories, onClose, onSaved, notify }) {
  const [form, setForm] = React.useState(product || freshProduct(categories[0]?.id));
  const [priceText, setPriceText] = React.useState(yuanInput(product?.base_price));
  const [busy, setBusy] = React.useState(false);
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const editGroup = (index, patch) =>
    update(
      'options',
      form.options.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const editChoice = (groupIndex, choiceIndex, patch) =>
    update(
      'options',
      form.options.map((group, i) =>
        i === groupIndex
          ? {
              ...group,
              choices: group.choices.map((choice, j) =>
                j === choiceIndex ? { ...choice, ...patch } : choice,
              ),
            }
          : group,
      ),
    );
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify('图片不能超过 5 MB');
    const body = new FormData();
    body.append('image', file);
    try {
      const result = await api('/admin/upload', { method: 'POST', body });
      update('image', result.url);
    } catch (e) {
      notify(e.message);
    }
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        category_id: Number(form.category_id),
        base_price: fromYuan(priceText),
      };
      await json(
        product ? 'PUT' : 'POST',
        product ? `/admin/products/${product.id}` : '/admin/products',
        payload,
      );
      notify(product ? '菜品已更新' : '菜品已添加');
      onSaved();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={product ? '编辑菜品' : '新增菜品'} onClose={onClose} wide>
      <form className="editor" onSubmit={save}>
        <div className="editor__grid">
          <div className="editor__main">
            <h3>基本信息</h3>
            <div className="form-grid">
              <Field label="菜品名称">
                <input
                  required
                  maxLength="80"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="例如：招牌照烧鸡饭"
                />
              </Field>
              <Field label="所属分类">
                <select
                  required
                  value={form.category_id}
                  onChange={(e) => update('category_id', Number(e.target.value))}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="售价（元）">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                />
              </Field>
              <Field label="库存份数">
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={form.stock}
                  onChange={(e) => update('stock', Number(e.target.value))}
                />
              </Field>
            </div>
            <Field label="菜品介绍">
              <textarea
                rows="3"
                maxLength="1000"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="说说食材、口味或制作方式"
              />
            </Field>
            <div className="check-row">
              <label>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => update('enabled', e.target.checked)}
                />{' '}
                立即上架
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) => update('featured', e.target.checked)}
                />{' '}
                首页推荐
              </label>
            </div>
            <div className="editor__section-head">
              <div>
                <h3>规格与加价</h3>
                <p>顾客每组选一个选项。可选组允许不选。</p>
              </div>
              <button
                type="button"
                className="button button--light"
                onClick={() =>
                  update('options', [
                    ...form.options,
                    { name: '', required: true, choices: [{ name: '', price: 0 }] },
                  ])
                }
              >
                + 添加规格组
              </button>
            </div>
            {form.options.map((group, i) => (
              <div className="option-group" key={i}>
                <div className="option-group__head">
                  <input
                    placeholder="规格名称，如份量、口味"
                    value={group.name}
                    onChange={(e) => editGroup(i, { name: e.target.value })}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={!!group.required}
                      onChange={(e) => editGroup(i, { required: e.target.checked })}
                    />{' '}
                    必选
                  </label>
                  <button
                    type="button"
                    className="text-button text-button--danger"
                    onClick={() =>
                      update(
                        'options',
                        form.options.filter((_, j) => j !== i),
                      )
                    }
                  >
                    删除组
                  </button>
                </div>
                {group.choices.map((choice, j) => (
                  <div className="option-choice" key={j}>
                    <input
                      placeholder="选项，如加大份"
                      value={choice.name}
                      onChange={(e) => editChoice(i, j, { name: e.target.value })}
                    />
                    <span>加价 ¥</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={yuanInput(choice.price)}
                      onBlur={(e) => editChoice(i, j, { price: fromYuan(e.target.value) })}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() =>
                        editGroup(i, { choices: group.choices.filter((_, k) => k !== j) })
                      }
                      disabled={group.choices.length === 1}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    editGroup(i, { choices: [...group.choices, { name: '', price: 0 }] })
                  }
                >
                  + 添加选项
                </button>
              </div>
            ))}
          </div>
          <aside className="editor__aside">
            <h3>菜品图片</h3>
            <label className="upload-box">
              {form.image ? (
                <img src={form.image} alt="菜品预览" />
              ) : (
                <>
                  <UploadCloud size={30} />
                  <strong>上传菜品图片</strong>
                  <small>JPG、PNG、WebP，最多 5 MB</small>
                </>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => upload(e.target.files[0])}
              />
            </label>
            <p>建议使用清晰的正方形实拍图。</p>
          </aside>
        </div>
        <div className="editor__footer">
          <button type="button" className="button button--light" onClick={onClose}>
            取消
          </button>
          <button className="button button--primary" disabled={busy}>
            {busy ? '保存中…' : '保存菜品'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Products({ notify }) {
  const [tab, setTab] = React.useState('products');
  const [products, setProducts] = React.useState(null);
  const [categories, setCategories] = React.useState([]);
  const [selected, setSelected] = React.useState([]);
  const [editing, setEditing] = React.useState(undefined);
  const [categoryEditing, setCategoryEditing] = React.useState(undefined);
  const [categoryName, setCategoryName] = React.useState('');
  const [categoryBusy, setCategoryBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const load = async () => {
    try {
      const [p, c] = await Promise.all([api('/admin/products'), api('/admin/categories')]);
      setProducts(p);
      setCategories(c);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };
  React.useEffect(() => {
    load();
  }, []);
  const openCategory = (category) => {
    setCategoryEditing(category);
    setCategoryName(category?.name || '');
  };
  const saveCategory = async (event) => {
    event.preventDefault();
    if (!categoryName.trim()) return;
    setCategoryBusy(true);
    try {
      const category = categoryEditing;
      await json(
        category ? 'PUT' : 'POST',
        category ? `/admin/categories/${category.id}` : '/admin/categories',
        { name: categoryName, enabled: category?.enabled ?? true },
      );
      notify(category ? '分类已更新' : '分类已添加');
      setCategoryEditing(undefined);
      load();
    } catch (e) {
      notify(e.message);
    } finally {
      setCategoryBusy(false);
    }
  };
  const toggleCategory = async (category) => {
    try {
      await json('PUT', `/admin/categories/${category.id}`, {
        name: category.name,
        enabled: !category.enabled,
      });
      notify(category.enabled ? '分类已停用' : '分类已启用');
      load();
    } catch (e) {
      notify(e.message);
    }
  };
  const move = async (category, step) => {
    const ids = categories.map((c) => c.id);
    const index = ids.indexOf(category.id);
    if (index + step < 0 || index + step >= ids.length) return;
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    try {
      await json('POST', '/admin/categories/reorder', { ids });
      load();
    } catch (e) {
      notify(e.message);
    }
  };
  const bulk = async (enabled) => {
    if (!selected.length) return;
    if (!window.confirm(`确定${enabled ? '上架' : '下架'}选中的 ${selected.length} 道菜品吗？`))
      return;
    try {
      await json('POST', '/admin/products/batch', { ids: selected, enabled });
      setSelected([]);
      notify('批量操作已完成');
      load();
    } catch (e) {
      notify(e.message);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="MENU / 菜品与分类"
        title="菜品与分类"
        description="维护售卖菜品、规格、库存与分类。下架或售罄后，顾客将无法点选。"
        action={
          <button
            className="button button--primary"
            onClick={() => (tab === 'products' ? setEditing(null) : openCategory(null))}
          >
            <Plus size={17} /> {tab === 'products' ? '新增菜品' : '新增分类'}
          </button>
        }
      />
      <div className="tabs">
        <button
          className={tab === 'products' ? 'tabs__active' : ''}
          onClick={() => setTab('products')}
        >
          菜品管理
        </button>
        <button
          className={tab === 'categories' ? 'tabs__active' : ''}
          onClick={() => setTab('categories')}
        >
          分类管理
        </button>
      </div>
      {error && (
        <div className="inline-error">
          {error} <button onClick={load}>重试</button>
        </div>
      )}
      {tab === 'products' ? (
        <section className="panel">
          <div className="panel__head">
            <div>
              <h2>菜品列表</h2>
              <p>共 {products?.length || 0} 道菜品</p>
            </div>
            {selected.length > 0 && (
              <div className="button-group">
                <span>已选 {selected.length} 项</span>
                <button className="button button--light" onClick={() => bulk(true)}>
                  批量上架
                </button>
                <button className="button button--light" onClick={() => bulk(false)}>
                  批量下架
                </button>
              </div>
            )}
          </div>
          {products?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={selected.length === products.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? products.map((p) => p.id) : [])
                        }
                      />
                    </th>
                    <th>菜品</th>
                    <th>分类</th>
                    <th>售价</th>
                    <th>库存</th>
                    <th>状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, p.id]
                                : selected.filter((id) => id !== p.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <div className="product-cell">
                          <div className="product-cell__image">
                            {p.image ? <img src={p.image} alt="" /> : <Package size={22} />}
                          </div>
                          <div>
                            <strong>{p.name}</strong>
                            <small>{p.featured ? '★ 首页推荐' : p.description.slice(0, 30)}</small>
                          </div>
                        </div>
                      </td>
                      <td>{categories.find((c) => c.id === p.category_id)?.name || '—'}</td>
                      <td className="strong">{yuan(p.base_price)}</td>
                      <td>
                        {p.stock === 0 ? <span className="sold-out">售罄</span> : `${p.stock} 份`}
                      </td>
                      <td>
                        <span className={`pill ${p.enabled ? 'pill--green' : ''}`}>
                          {p.enabled ? '已上架' : '已下架'}
                        </span>
                      </td>
                      <td>
                        <button className="text-button" onClick={() => setEditing(p)}>
                          <Pencil size={14} /> 编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            products && <Empty title="还没有菜品" hint="点击右上角新增菜品。" />
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="panel__head">
            <div>
              <h2>菜品分类</h2>
              <p>使用上下箭头调整小程序展示顺序。</p>
            </div>
          </div>
          {categories.length ? (
            <div className="category-list">
              {categories.map((c, i) => (
                <div className="category-item" key={c.id}>
                  <div className="category-item__order">
                    <button disabled={i === 0} onClick={() => move(c, -1)} aria-label="上移">
                      <ChevronUp size={16} />
                    </button>
                    <button
                      disabled={i === categories.length - 1}
                      onClick={() => move(c, 1)}
                      aria-label="下移"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                  <strong>{c.name}</strong>
                  <span>{products?.filter((p) => p.category_id === c.id).length || 0} 道菜品</span>
                  <span className={`pill ${c.enabled ? 'pill--green' : ''}`}>
                    {c.enabled ? '启用中' : '已停用'}
                  </span>
                  <button className="text-button" onClick={() => openCategory(c)}>
                    编辑
                  </button>
                  <button className="text-button" onClick={() => toggleCategory(c)}>
                    {c.enabled ? '停用' : '启用'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="还没有分类" hint="先建立分类，再添加菜品。" />
          )}
        </section>
      )}
      {editing !== undefined && (
        <ProductEditor
          product={editing}
          categories={categories}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
          notify={notify}
        />
      )}
      {categoryEditing !== undefined && (
        <Modal
          title={categoryEditing ? '编辑分类' : '新增分类'}
          onClose={() => setCategoryEditing(undefined)}
        >
          <form className="category-form" onSubmit={saveCategory}>
            <Field label="分类名称">
              <input
                required
                maxLength="40"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="例如：主食、饮品"
              />
            </Field>
            <div className="category-form__actions">
              <button
                type="button"
                className="button button--light"
                onClick={() => setCategoryEditing(undefined)}
              >
                取消
              </button>
              <button className="button button--primary" disabled={categoryBusy}>
                {categoryBusy ? '保存中…' : '保存分类'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
