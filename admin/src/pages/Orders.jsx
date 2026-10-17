import React from 'react';
import { Download, RefreshCw, Printer } from 'lucide-react';
import { api, json, yuan, dateTime, statuses } from '../api';
import { Empty, Modal, PageHeader, Status, Field } from '../components/Ui';

const actions = {
  PENDING_ACCEPTANCE: ['accept', '接单并开始制作'],
  PREPARING: ['ready', '标记制作完成'],
  READY: ['complete', '确认订单完结'],
};
export default function Orders({ notify }) {
  const [orders, setOrders] = React.useState(null);
  const [filter, setFilter] = React.useState({ status: '', from: '', to: '' });
  const [selected, setSelected] = React.useState(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const load = () => {
    const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    api(`/admin/orders?${query}`)
      .then(setOrders)
      .catch((e) => setError(e.message));
  };
  React.useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [filter.status, filter.from, filter.to]);
  React.useEffect(() => {
    if (selected && orders) setSelected(orders.find((o) => o.id === selected.id) || selected);
  }, [orders]);
  const act = async (action) => {
    if (['reject', 'refunded'].includes(action) && !reason.trim())
      return notify(action === 'reject' ? '请填写拒单原因' : '请填写退款凭证或说明');
    const labels = {
      accept: '接单',
      ready: '完成制作',
      complete: '完结订单',
      reject: selected.payment_method === 'balance' ? '拒单并退回余额' : '拒单并标记待退款',
      refunded: '确认已退款',
    };
    if (
      !window.confirm(
        `确定${labels[action]}吗？${action === 'reject' && selected.payment_method !== 'balance' ? '请随后在微信商户平台办理整单退款。' : ''}`,
      )
    )
      return;
    setBusy(true);
    try {
      const updated = await json('POST', `/admin/orders/${selected.id}/action`, { action, reason });
      setSelected(updated);
      setReason('');
      notify(`${labels[action]}成功`);
      load();
    } catch (error) {
      notify(error.message);
      load();
    } finally {
      setBusy(false);
    }
  };
  const print = async (order) => {
    try {
      const result = await json('POST', `/admin/orders/${order.id}/print`, {});
      notify(result.configured ? '小票已发送至打印服务' : '尚未配置打印服务');
    } catch (e) {
      notify(e.message);
    }
  };
  const exportFile = () => {
    const query = new URLSearchParams(Object.entries(filter).filter(([, value]) => value));
    window.open(`/api/admin/orders-export?${query}`, '_blank');
  };
  return (
    <>
      <PageHeader
        eyebrow="ORDERS / 订单管理"
        title="订单管理"
        description="新订单自动刷新；按付款、制作和取餐进度处理每一单。"
        action={
          <div className="button-group">
            <button className="button button--light" onClick={load}>
              <RefreshCw size={16} /> 刷新
            </button>
            <button className="button button--primary" onClick={exportFile}>
              <Download size={16} /> 导出 Excel
            </button>
          </div>
        }
      />
      <div className="filter-bar">
        <Field label="订单状态">
          <select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="开始日期">
          <input
            type="date"
            value={filter.from}
            onChange={(e) => setFilter({ ...filter, from: e.target.value })}
          />
        </Field>
        <Field label="结束日期">
          <input
            type="date"
            value={filter.to}
            onChange={(e) => setFilter({ ...filter, to: e.target.value })}
          />
        </Field>
        <button className="text-button" onClick={() => setFilter({ status: '', from: '', to: '' })}>
          清除筛选
        </button>
      </div>
      {error && (
        <div className="inline-error">
          {error} <button onClick={load}>重试</button>
        </div>
      )}
      <section className="panel">
        <div className="panel__head">
          <div>
            <h2>订单列表</h2>
            <p>{orders ? `共 ${orders.length} 单，最多显示最近 500 单` : '正在加载…'}</p>
          </div>
        </div>
        {orders?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>订单号 / 时间</th>
                  <th>菜品</th>
                  <th>实付金额</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong className="mono">{order.order_no}</strong>
                      <small className="table-sub">{dateTime(order.created_at)}</small>
                    </td>
                    <td>
                      {order.items.map((item) => `${item.name} ×${item.quantity}`).join('、')}
                    </td>
                    <td className="strong">{yuan(order.amount)}</td>
                    <td>
                      <Status value={order.status} />
                    </td>
                    <td>
                      <button className="text-button" onClick={() => setSelected(order)}>
                        查看处理 →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          orders && <Empty title="没有符合条件的订单" hint="调整筛选条件后重试。" />
        )}
      </section>
      {selected && (
        <Modal
          title={`订单 ${selected.order_no}`}
          onClose={() => {
            setSelected(null);
            setReason('');
          }}
          wide
        >
          <div className="order-detail">
            <div className="order-detail__summary">
              <Status value={selected.status} />
              <strong>{yuan(selected.amount)}</strong>
              <p>
                {selected.status === 'PENDING_ACCEPTANCE'
                  ? '顾客已付款，等待店铺接单。'
                  : selected.status === 'REFUND_PENDING'
                    ? '请在微信商户平台办理整单退款，完成后登记凭证。'
                    : '到店自取订单'}
              </p>
            </div>
            <div className="detail-grid">
              <div>
                <span>支付方式</span>
                <strong>
                  {selected.payment_method === 'balance'
                    ? '余额支付'
                    : selected.payment_method === 'mock'
                      ? '模拟支付'
                      : '微信支付'}
                </strong>
              </div>
              <div>
                <span>下单时间</span>
                <strong>{dateTime(selected.created_at)}</strong>
              </div>
              <div>
                <span>付款时间</span>
                <strong>{dateTime(selected.paid_at)}</strong>
              </div>
              <div>
                <span>订单备注</span>
                <strong>{selected.remark || '无'}</strong>
              </div>
              <div>
                <span>退款说明</span>
                <strong>{selected.refund_note || '—'}</strong>
              </div>
            </div>
            <h3>菜品清单</h3>
            {selected.items.map((item, index) => (
              <div className="order-line" key={index}>
                <div>
                  <strong>
                    {item.name} ×{item.quantity}
                  </strong>
                  <small>{item.options_label || '标准规格'}</small>
                </div>
                <b>{yuan(item.unit_price * item.quantity)}</b>
              </div>
            ))}
            <div className="order-detail__actions">
              <button className="button button--light" onClick={() => print(selected)}>
                <Printer size={16} /> 打印小票
              </button>
              {actions[selected.status] && (
                <button
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => act(actions[selected.status][0])}
                >
                  {actions[selected.status][1]}
                </button>
              )}
            </div>
            {selected.status === 'PENDING_ACCEPTANCE' && (
              <div className="danger-zone">
                <strong>订单无效，需要拒单</strong>
                <p>
                  {selected.payment_method === 'balance'
                    ? '拒单后订单金额会立即退回顾客余额。'
                    : '拒单后订单进入待退款。请在微信商户平台完成整单退款，并在此记录处理结果。'}
                </p>
                <textarea
                  placeholder="填写拒单原因"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => act('reject')}
                >
                  {selected.payment_method === 'balance' ? '拒单并退回余额' : '拒单并标记待退款'}
                </button>
              </div>
            )}
            {selected.status === 'REFUND_PENDING' && (
              <div className="danger-zone">
                <strong>登记退款结果</strong>
                <textarea
                  placeholder="填写商户平台退款单号或处理说明"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => act('refunded')}
                >
                  确认已退款
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
