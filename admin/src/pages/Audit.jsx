import React from 'react';
import { api, dateTime } from '../api';
import { Empty, PageHeader } from '../components/Ui';

export default function Audit() {
  const [rows, setRows] = React.useState(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    api('/admin/audits')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHeader
        eyebrow="HISTORY / 操作记录"
        title="操作记录"
        description="查看最近 100 条菜品、订单和页面配置操作。"
      />
      {error && <div className="inline-error">{error}</div>}
      <section className="panel">
        {rows?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>操作</th>
                  <th>对象</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.created_at.replace(' ', 'T') + 'Z')}</td>
                    <td>{row.actor}</td>
                    <td className="strong">{row.action}</td>
                    <td>
                      {row.target_type === 'order'
                        ? '订单'
                        : row.target_type === 'product'
                          ? '菜品'
                          : row.target_type === 'category'
                            ? '分类'
                            : '店铺设置'}
                    </td>
                    <td>{row.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          rows && <Empty title="暂无操作记录" hint="管理端操作后会显示在这里。" />
        )}
      </section>
    </>
  );
}
