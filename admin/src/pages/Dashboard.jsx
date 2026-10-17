import React from 'react';
import { ArrowUpRight, Clock3, ChefHat, Wallet, ReceiptText } from 'lucide-react';
import { api, yuan, dateTime } from '../api';
import { Empty, PageHeader, Status } from '../components/Ui';

export default function Dashboard({ notify, go }) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const load = () =>
    api('/admin/overview')
      .then(setData)
      .catch((e) => setError(e.message));
  React.useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW / 今日经营"
        title="工作台"
        description="从新订单到出餐，今天的营业情况一目了然。"
        action={
          <button className="button button--primary" onClick={() => go('orders')}>
            处理订单 <ArrowUpRight size={17} />
          </button>
        }
      />
      {error && (
        <div className="inline-error">
          {error} <button onClick={load}>重试</button>
        </div>
      )}
      {data && (
        <>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-card__icon metric-card__icon--peach">
                <Wallet />
              </div>
              <span>今日营业额</span>
              <strong>{yuan(data.today.revenue)}</strong>
              <small>已付款订单，不含待退款</small>
            </div>
            <div className="metric-card">
              <div className="metric-card__icon metric-card__icon--mint">
                <ReceiptText />
              </div>
              <span>今日订单</span>
              <strong>
                {data.today.orders}
                <em>单</em>
              </strong>
              <small>以北京时间统计</small>
            </div>
            <div className="metric-card">
              <div className="metric-card__icon metric-card__icon--gold">
                <Clock3 />
              </div>
              <span>待接单</span>
              <strong>
                {data.pending}
                <em>单</em>
              </strong>
              <small>请及时确认新订单</small>
            </div>
            <div className="metric-card">
              <div className="metric-card__icon metric-card__icon--lavender">
                <ChefHat />
              </div>
              <span>制作中 / 待取餐</span>
              <strong>
                {data.preparing}
                <em>单</em>
              </strong>
              <small>关注出餐进度</small>
            </div>
          </div>
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel__head">
                <div>
                  <h2>最近订单</h2>
                  <p>每 15 秒自动更新</p>
                </div>
                <button className="text-button" onClick={() => go('orders')}>
                  查看全部 →
                </button>
              </div>
              {data.recent.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>订单号</th>
                        <th>下单时间</th>
                        <th>金额</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((order) => (
                        <tr key={order.id}>
                          <td className="mono">{order.order_no}</td>
                          <td>{dateTime(order.created_at)}</td>
                          <td className="strong">{yuan(order.amount)}</td>
                          <td>
                            <Status value={order.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="还没有订单" hint="顾客下单后会显示在这里。" />
              )}
            </section>
            <aside className="dashboard-side">
              <div className="tip-card">
                <span className="tip-card__icon">✦</span>
                <div className="eyebrow">经营提示</div>
                <h3>把好味道准备好</h3>
                <p>收到付款订单后及时接单。制作完成时将订单标记为待取餐，顾客就能看到最新进度。</p>
                <button onClick={() => go('products')}>管理菜品 →</button>
              </div>
              <div className="system-card">
                <h3>接入状态</h3>
                <p>
                  <span className={`dot ${data.payment === 'unavailable' ? 'dot--warn' : ''}`} />
                  {data.payment === 'wechat'
                    ? '微信支付已配置'
                    : data.payment === 'mock'
                      ? '开发模拟支付'
                      : '微信支付待配置'}
                </p>
                <p>
                  <span className={`dot ${!data.printer ? 'dot--warn' : ''}`} />
                  {data.printer ? '打印服务已配置' : '打印服务待配置'}
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
