import React from 'react';
import { api, yuan } from '../api';
import { Empty, PageHeader } from '../components/Ui';

export default function Reports() {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    api('/admin/stats')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const max = Math.max(1, ...(data?.daily || []).map((row) => row.revenue));
  return (
    <>
      <PageHeader
        eyebrow="INSIGHTS / 销售报表"
        title="销售报表"
        description="按北京时间统计最近 30 天营业额和菜品销量。退款订单不计入营业额。"
      />
      {error && <div className="inline-error">{error}</div>}
      {data && (
        <div className="report-grid">
          <section className="panel panel--padded">
            <div className="panel__head">
              <div>
                <h2>每日营业额</h2>
                <p>最近 30 天</p>
              </div>
            </div>
            {data.daily.length ? (
              <div className="report-bars">
                {[...data.daily].reverse().map((row) => (
                  <div className="report-bar" key={row.day}>
                    <span>{row.day.slice(5)}</span>
                    <div>
                      <i style={{ width: `${Math.max(2, (row.revenue / max) * 100)}%` }} />
                    </div>
                    <strong>{yuan(row.revenue)}</strong>
                    <small>{row.orders} 单</small>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="暂无销售数据" hint="完成首笔付款后即可查看报表。" />
            )}
          </section>
          <section className="panel panel--padded">
            <div className="panel__head">
              <div>
                <h2>菜品销量排行</h2>
                <p>按已付款菜品份数排序</p>
              </div>
            </div>
            {data.top.length ? (
              <div className="rank-list">
                {data.top.map((row, index) => (
                  <div key={row.name}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{row.name}</strong>
                    <small>{row.quantity} 份</small>
                    <b>{yuan(row.revenue)}</b>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="暂无销量记录" hint="订单付款后会自动累计。" />
            )}
          </section>
        </div>
      )}
    </>
  );
}
