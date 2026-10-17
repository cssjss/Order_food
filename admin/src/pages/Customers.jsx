import React from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api, json, yuan, dateTime } from '../api';
import { Empty, Field, Modal, PageHeader, Status } from '../components/Ui';

const walletKinds = {
  TOPUP: '微信充值',
  ORDER_PAYMENT: '余额支付订单',
  ORDER_REFUND: '订单退款',
  ADMIN_CREDIT: '商家增加',
  ADMIN_DEBIT: '商家扣减',
};
const newRequestId = () =>
  window.crypto?.randomUUID?.() || `${Date.now()}-${Math.floor(Math.random() * 1000000000)}`;

function CustomerIdentity({ customer }) {
  return (
    <div className="customer-identity">
      <div className="customer-identity__avatar">
        {customer.avatar ? (
          <img src={customer.avatar} alt="" />
        ) : (
          (customer.nickname || '顾').slice(0, 1)
        )}
      </div>
      <div>
        <strong>{customer.nickname || '未设置昵称'}</strong>
        <small>注册于 {dateTime(customer.created_at)}</small>
      </div>
    </div>
  );
}

export default function Customers({ notify }) {
  const [queryInput, setQueryInput] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [version, setVersion] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [detailError, setDetailError] = React.useState('');
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [walletAction, setWalletAction] = React.useState('credit');
  const [walletAmount, setWalletAmount] = React.useState('');
  const [walletReason, setWalletReason] = React.useState('');
  const [walletRequestId, setWalletRequestId] = React.useState(newRequestId);
  const [walletError, setWalletError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setError('');
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    api(`/admin/customers?${params}`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [query, status, page, version]);

  React.useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    setDetail(null);
    setDetailError('');
    setWalletAction('credit');
    setWalletAmount('');
    setWalletReason('');
    setWalletRequestId(newRequestId());
    setWalletError('');
    api(`/admin/customers/${selectedId}`)
      .then((result) => {
        if (!alive) return;
        setDetail(result);
        setNote(result.customer.admin_note || '');
        setReason('');
      })
      .catch((e) => {
        if (alive) setDetailError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const saveNote = async () => {
    setBusy(true);
    setDetailError('');
    try {
      const customer = await json('PUT', `/admin/customers/${selectedId}/note`, { note });
      setDetail((previous) => ({ ...previous, customer }));
      notify('内部备注已保存');
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async () => {
    const disabled = !detail.customer.disabled_at;
    if (disabled && !reason.trim()) return setDetailError('请填写停用原因');
    const message = disabled
      ? `确定停用这位顾客吗？停用后顾客无法登录或使用余额${detail.customer.balance > 0 ? `（当前余额 ${yuan(detail.customer.balance)}）` : ''}。原因：${reason.trim()}`
      : '确定恢复这位顾客的账号吗？恢复后顾客可以再次使用小程序。';
    if (!window.confirm(message)) return;
    setBusy(true);
    setDetailError('');
    try {
      const customer = await json('POST', `/admin/customers/${selectedId}/status`, {
        disabled,
        reason: disabled ? reason.trim() : '',
      });
      setDetail((previous) => ({ ...previous, customer }));
      setReason('');
      setVersion((value) => value + 1);
      notify(disabled ? '顾客账号已停用' : '顾客账号已恢复');
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const changeMerchant = async () => {
    const isMerchant = !detail.customer.is_merchant;
    const name = detail.customer.nickname || '这位顾客';
    if (
      !window.confirm(
        isMerchant
          ? `确定将${name}设为商家吗？该账号下次进入小程序后可以处理所有订单并发送小票。`
          : `确定取消${name}的商家身份吗？该账号将立即无法处理商家订单。`,
      )
    )
      return;
    setBusy(true);
    setDetailError('');
    try {
      const customer = await json('POST', `/admin/customers/${selectedId}/merchant`, {
        isMerchant,
      });
      setDetail((previous) => ({ ...previous, customer }));
      setVersion((value) => value + 1);
      notify(isMerchant ? '已设为商家' : '已取消商家身份');
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const changeWalletAction = (action) => {
    setWalletAction(action);
    setWalletAmount('');
    setWalletReason('');
    setWalletRequestId(newRequestId());
    setWalletError('');
  };
  const adjustBalance = async () => {
    const credit = walletAction === 'credit';
    const action = credit ? '增加' : '扣减';
    const value = walletAmount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value))
      return setWalletError(`请输入正确的${action}金额，最多保留两位小数`);
    const amount = Math.round(Number(value) * 100);
    if (!amount || amount > 100000000)
      return setWalletError(`${action}金额须大于 0 且不超过 100 万元`);
    if (!credit && amount > detail.customer.balance)
      return setWalletError('扣减金额不能超过当前余额');
    if (!walletReason.trim()) return setWalletError(`请填写${action}原因`);
    if (
      !window.confirm(
        `确定为${detail.customer.nickname || '这位顾客'}${credit ? '增加' : '扣减'}余额 ${yuan(amount)} 吗？${credit ? '增加后顾客可立即用于支付订单。' : ''}原因：${walletReason.trim()}`,
      )
    )
      return;
    setBusy(true);
    setWalletError('');
    try {
      await json('POST', `/admin/customers/${selectedId}/wallet/${walletAction}`, {
        amount,
        reason: walletReason.trim(),
        clientRequestId: walletRequestId,
      });
      setDetail(await api(`/admin/customers/${selectedId}`));
      setWalletAmount('');
      setWalletReason('');
      setWalletRequestId(newRequestId());
      setVersion((value) => value + 1);
      notify(`顾客余额已${action}`);
    } catch (e) {
      setWalletError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="CUSTOMERS / 顾客管理"
        title="顾客管理"
        description="查找小程序顾客，查看消费与订单记录，处理账号状态。"
        action={
          <button className="button button--light" onClick={() => setVersion((value) => value + 1)}>
            <RefreshCw size={16} /> 刷新
          </button>
        }
      />
      <form
        className="filter-bar customer-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(queryInput.trim());
          setVersion((value) => value + 1);
        }}
      >
        <Field label="查找顾客">
          <input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="昵称或订单号"
            maxLength={80}
          />
        </Field>
        <Field label="账号状态">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部顾客</option>
            <option value="active">正常使用</option>
            <option value="disabled">已停用</option>
          </select>
        </Field>
        <button className="button button--primary" type="submit">
          <Search size={16} /> 搜索
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setQueryInput('');
            setQuery('');
            setStatus('');
            setPage(1);
            setVersion((value) => value + 1);
          }}
        >
          清除筛选
        </button>
      </form>
      {error && (
        <div className="inline-error">
          {error}
          <button onClick={() => setVersion((value) => value + 1)}>重试</button>
        </div>
      )}
      <section className="panel">
        <div className="panel__head">
          <div>
            <h2>顾客列表</h2>
            <p>{loading ? '正在加载…' : `共 ${data?.total ?? 0} 位顾客`}</p>
          </div>
        </div>
        {data?.rows.length ? (
          <>
            <div className="table-wrap">
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>顾客</th>
                    <th>订单</th>
                    <th>有效消费</th>
                    <th>余额</th>
                    <th>最近下单</th>
                    <th>账号状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <CustomerIdentity customer={customer} />
                        {!!customer.is_merchant && <span className="customer-merchant-label">商家</span>}
                      </td>
                      <td>{customer.order_count} 单</td>
                      <td className="strong">{yuan(customer.paid_amount)}</td>
                      <td className="strong">{yuan(customer.balance)}</td>
                      <td>{dateTime(customer.last_order_at)}</td>
                      <td>
                        <span
                          className={`pill ${customer.disabled_at ? 'customer-pill--disabled' : 'pill--green'}`}
                        >
                          {customer.disabled_at ? '已停用' : '正常使用'}
                        </span>
                      </td>
                      <td>
                        <button className="text-button" onClick={() => setSelectedId(customer.id)}>
                          查看详情 →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="customer-pagination">
              <span>
                第 {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页
              </span>
              <div className="button-group">
                <button
                  className="button button--light"
                  disabled={loading || page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <button
                  className="button button--light"
                  disabled={loading || page * data.pageSize >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : !loading && !error ? (
          <Empty
            title={query || status ? '没有找到顾客' : '还没有顾客'}
            hint={query || status ? '试试其他昵称或订单号。' : '顾客首次登录小程序后会在这里显示。'}
          />
        ) : null}
      </section>
      {selectedId && (
        <Modal
          title="顾客详情"
          wide
          onClose={() => {
            setSelectedId(null);
            setDetail(null);
            setDetailError('');
          }}
        >
          <div className="customer-detail">
            {detailError && <div className="inline-error">{detailError}</div>}
            {!detail ? (
              <p className="customer-detail__muted">
                {detailError ? '详情加载失败，请关闭后重试。' : '正在加载顾客资料…'}
              </p>
            ) : (
              <>
                <div className="customer-detail__heading">
                  <CustomerIdentity customer={detail.customer} />
                  <div className="customer-detail__badges">
                    {!!detail.customer.is_merchant && <span className="pill pill--green">商家</span>}
                    <span
                      className={`pill ${detail.customer.disabled_at ? 'customer-pill--disabled' : 'pill--green'}`}
                    >
                      {detail.customer.disabled_at ? '已停用' : '正常使用'}
                    </span>
                  </div>
                </div>
                <div className="customer-detail__stats">
                  <div>
                    <span>全部订单</span>
                    <strong>{detail.customer.order_count} 单</strong>
                  </div>
                  <div>
                    <span>有效支付订单</span>
                    <strong>{detail.customer.paid_order_count} 单</strong>
                  </div>
                  <div>
                    <span>有效消费</span>
                    <strong>{yuan(detail.customer.paid_amount)}</strong>
                  </div>
                  <div>
                    <span>最近下单</span>
                    <strong>{dateTime(detail.customer.last_order_at)}</strong>
                  </div>
                </div>
                <div className="customer-detail__section customer-merchant">
                  <div>
                    <h3>商家身份</h3>
                    <p>
                      {detail.customer.is_merchant
                        ? '该账号可以在小程序处理全部订单、制作出单，并切换回买家视图。'
                        : '设为商家后，该账号可在小程序处理全部订单、制作出单。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button button--light"
                    disabled={busy}
                    onClick={changeMerchant}
                  >
                    {detail.customer.is_merchant ? '取消商家身份' : '设为商家'}
                  </button>
                </div>
                <div className="customer-detail__section customer-wallet">
                  <div className="customer-wallet__head">
                    <div>
                      <h3>账户余额</h3>
                      <strong>{yuan(detail.customer.balance)}</strong>
                    </div>
                    <p>充值、支付、退款和商家余额调整都会记录在余额流水中。</p>
                  </div>
                  <div className="customer-wallet__adjustment">
                    <h4>调整余额</h4>
                    <p>请核对顾客、金额和原因。调整后立即生效，并留下余额流水及操作记录。</p>
                    <div
                      className="customer-wallet__actions"
                      role="group"
                      aria-label="余额调整方式"
                    >
                      <button
                        type="button"
                        className={walletAction === 'credit' ? 'is-active' : ''}
                        aria-pressed={walletAction === 'credit'}
                        disabled={busy}
                        onClick={() => changeWalletAction('credit')}
                      >
                        增加余额
                      </button>
                      <button
                        type="button"
                        className={walletAction === 'debit' ? 'is-active' : ''}
                        aria-pressed={walletAction === 'debit'}
                        disabled={busy}
                        onClick={() => changeWalletAction('debit')}
                      >
                        扣减余额
                      </button>
                    </div>
                    <div className="customer-wallet__fields">
                      <Field label={`${walletAction === 'credit' ? '增加' : '扣减'}金额（元）`}>
                        <input
                          inputMode="decimal"
                          value={walletAmount}
                          onChange={(event) => {
                            setWalletAmount(event.target.value);
                            setWalletRequestId(newRequestId());
                            setWalletError('');
                          }}
                          placeholder="例如 10.00"
                        />
                      </Field>
                      <Field label={`${walletAction === 'credit' ? '增加' : '扣减'}原因`}>
                        <input
                          value={walletReason}
                          maxLength={300}
                          onChange={(event) => {
                            setWalletReason(event.target.value);
                            setWalletRequestId(newRequestId());
                            setWalletError('');
                          }}
                          placeholder="填写处理原因"
                        />
                      </Field>
                      <button
                        type="button"
                        className={`button ${walletAction === 'debit' ? 'button--danger' : 'button--primary'}`}
                        disabled={
                          busy || (walletAction === 'debit' && detail.customer.balance <= 0)
                        }
                        onClick={adjustBalance}
                      >
                        {busy ? '处理中…' : `确认${walletAction === 'credit' ? '增加' : '扣减'}`}
                      </button>
                    </div>
                    {walletError && (
                      <p className="customer-wallet__error" role="alert">
                        {walletError}
                      </p>
                    )}
                  </div>
                  <h4>最近余额流水</h4>
                  {detail.walletEntries?.length ? (
                    <div className="customer-wallet__entries">
                      {detail.walletEntries.map((entry) => (
                        <div className="customer-wallet__entry" key={entry.id}>
                          <div>
                            <strong>{walletKinds[entry.kind] || '余额变动'}</strong>
                            <small>
                              {entry.detail} · {dateTime(entry.created_at)} · {entry.actor}
                            </small>
                          </div>
                          <strong className={entry.amount > 0 ? 'customer-wallet__positive' : ''}>
                            {entry.amount > 0 ? '+' : '−'}
                            {yuan(Math.abs(entry.amount))}
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="customer-detail__muted">暂无余额流水</p>
                  )}
                </div>
                <div className="customer-detail__section">
                  <h3>最近订单</h3>
                  {detail.orders.length ? (
                    <div className="customer-orders">
                      {detail.orders.map((order) => (
                        <div className="customer-order" key={order.id}>
                          <div>
                            <strong className="mono">{order.order_no}</strong>
                            <small>
                              {dateTime(order.created_at)} ·{' '}
                              {order.items
                                .map((item) => `${item.name} ×${item.quantity}`)
                                .join('、')}
                            </small>
                          </div>
                          <strong>{yuan(order.amount)}</strong>
                          <Status value={order.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="customer-detail__muted">暂无订单</p>
                  )}
                  {detail.customer.order_count > 30 && (
                    <p className="customer-detail__muted">这里只显示最近 30 单。</p>
                  )}
                </div>
                <div className="customer-detail__section">
                  <h3>内部备注</h3>
                  <p className="customer-detail__muted">仅管理端可见，顾客不会看到。</p>
                  <textarea
                    className="customer-note"
                    value={note}
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="记录需要留意的服务事项"
                  />
                  <div className="customer-detail__footer">
                    <button
                      className="button button--light"
                      disabled={busy || note === detail.customer.admin_note}
                      onClick={saveNote}
                    >
                      保存备注
                    </button>
                  </div>
                </div>
                <div className="customer-detail__section customer-detail__status">
                  <h3>账号状态</h3>
                  {detail.customer.disabled_at ? (
                    <>
                      <p>
                        已于 {dateTime(detail.customer.disabled_at)} 停用。原因：
                        {detail.customer.disabled_reason}
                      </p>
                      <button
                        className="button button--primary"
                        disabled={busy}
                        onClick={changeStatus}
                      >
                        恢复账号
                      </button>
                    </>
                  ) : (
                    <>
                      <p>停用后，顾客无法登录或访问小程序账号。有未处理订单时不能停用。</p>
                      <textarea
                        value={reason}
                        maxLength={300}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="请填写停用原因"
                      />
                      <button
                        className="button button--danger"
                        disabled={busy}
                        onClick={changeStatus}
                      >
                        停用账号
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
