import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard,
  ClipboardList,
  UtensilsCrossed,
  LayoutTemplate,
  BarChart3,
  LogOut,
  Menu,
  History,
  CreditCard,
  Users,
} from 'lucide-react';
import { api, json } from './api';
import { Notice } from './components/Ui';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Products from './pages/Products';
import PageSettings from './pages/PageSettings';
import Reports from './pages/Reports';
import Audit from './pages/Audit';
import Payment from './pages/Payment';
import Customers from './pages/Customers';
import './styles.css';

const sections = [
  ['dashboard', '工作台', LayoutDashboard],
  ['orders', '订单管理', ClipboardList],
  ['customers', '顾客管理', Users],
  ['products', '菜品与分类', UtensilsCrossed],
  ['pages', '页面配置', LayoutTemplate],
  ['reports', '销售报表', BarChart3],
  ['payment', '小程序与支付', CreditCard],
  ['audit', '操作记录', History],
];
const views = {
  dashboard: Dashboard,
  orders: Orders,
  customers: Customers,
  products: Products,
  pages: PageSettings,
  reports: Reports,
  payment: Payment,
  audit: Audit,
};

function App() {
  const [me, setMe] = React.useState(undefined);
  const [active, setActive] = React.useState('dashboard');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [credentials, setCredentials] = React.useState({ username: '', password: '' });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    api('/admin/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  const login = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      setMe(await json('POST', '/admin/login', credentials));
      setCredentials({ username: '', password: '' });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    await json('POST', '/admin/logout', {});
    setMe(null);
  };
  if (me === undefined) return <div className="loading-page">正在打开管理端…</div>;
  if (!me)
    return (
      <div className="login-page">
        <div className="login-visual">
          <div className="brand-mark">餐</div>
          <span>到店自取 / STORE OPERATIONS</span>
          <div>
            <p>
              每一份好味道，
              <br />
              都从井井有条开始。
            </p>
            <small>让点单、出餐与经营数据，清晰地在一处流转。</small>
          </div>
          <div className="login-visual__footer">PICKUP ORDERING SYSTEM · 2026</div>
        </div>
        <form className="login-card" onSubmit={login}>
          <div className="eyebrow">WELCOME BACK</div>
          <h1>商家管理后台</h1>
          <p>登录后管理菜品、订单与小程序页面。</p>
          <label>
            管理员账号
            <input
              value={credentials.username}
              onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
              autoComplete="username"
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
              autoComplete="current-password"
              required
            />
          </label>
          <Notice message={notice} onClose={() => setNotice('')} />
          <button className="button button--primary" disabled={busy}>
            {busy ? '登录中…' : '登录管理端'}
          </button>
          <small>仅授权管理员可访问</small>
        </form>
      </div>
    );
  const View = views[active];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <div className="brand-mark">餐</div>
          <div>
            <strong>点餐管理</strong>
            <small>商家管理平台</small>
          </div>
        </div>
        <div className="sidebar__label">工作空间</div>
        <nav>
          {sections.map(([id, label, Icon]) => (
            <button
              key={id}
              className={`sidebar__link ${active === id ? 'sidebar__link--active' : ''}`}
              onClick={() => {
                setActive(id);
                setMenuOpen(false);
              }}
            >
              <Icon size={19} />
              {label}
              {id === 'orders' && <span className="sidebar__link-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <div className="sidebar__account">
            <div className="sidebar__avatar">管</div>
            <div>
              <strong>{me.username}</strong>
              <small>店铺管理员</small>
            </div>
          </div>
          <button className="sidebar__logout" onClick={logout}>
            <LogOut size={17} /> 退出登录
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button topbar__menu"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="打开菜单"
          >
            <Menu size={22} />
          </button>
          <span>单店 · 到店自取</span>
          <div className="topbar__right">
            <span className="topbar__live" /> 系统运行中
          </div>
        </header>
        <main className="content">
          <View key={active} notify={setNotice} go={setActive} />
        </main>
      </div>
      <Notice message={notice} onClose={() => setNotice('')} />
      {menuOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭菜单"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
