import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDb(filename = process.env.DATABASE_FILE || './data/orders.sqlite') {
  const location =
    filename === ':memory:'
      ? filename
      : path.isAbsolute(filename)
        ? filename
        : path.resolve(import.meta.dirname, '../..', filename);
  if (location !== ':memory:') fs.mkdirSync(path.dirname(location), { recursive: true });
  const db = new DatabaseSync(location);
  db.transaction =
    (fn) =>
    (...args) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };
  if (location !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '',
      base_price INTEGER NOT NULL CHECK(base_price >= 0), stock INTEGER NOT NULL CHECK(stock >= 0),
      enabled INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0,
      options TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, openid TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      admin_note TEXT NOT NULL DEFAULT '', disabled_at TEXT, disabled_reason TEXT NOT NULL DEFAULT '',
      is_merchant INTEGER NOT NULL DEFAULT 0 CHECK(is_merchant IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id), product_id INTEGER NOT NULL REFERENCES products(id),
      PRIMARY KEY(user_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL, amount INTEGER NOT NULL, remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, paid_at TEXT,
      updated_at TEXT NOT NULL, refund_note TEXT NOT NULL DEFAULT '', stock_released INTEGER NOT NULL DEFAULT 0,
      client_request_id TEXT, payment_method TEXT NOT NULL DEFAULT 'wechat'
    );
    CREATE TABLE IF NOT EXISTS wallet_topups (
      id INTEGER PRIMARY KEY, topup_no TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount BETWEEN 100 AND 100000),
      status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      paid_at TEXT, transaction_id TEXT UNIQUE, client_request_id TEXT NOT NULL,
      UNIQUE(user_id,client_request_id)
    );
    CREATE TABLE IF NOT EXISTS wallet_entries (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL CHECK(amount != 0), kind TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE, detail TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL,
      image TEXT NOT NULL, options_label TEXT NOT NULL, selection TEXT NOT NULL DEFAULT '{}', unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audits (
      id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
      target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_entries_user ON wallet_entries(user_id,id);
    CREATE INDEX IF NOT EXISTS idx_wallet_topups_user ON wallet_topups(user_id,id);
  `);
  if (
    !db
      .prepare('PRAGMA table_info(order_items)')
      .all()
      .some((column) => column.name === 'selection')
  )
    db.exec("ALTER TABLE order_items ADD COLUMN selection TEXT NOT NULL DEFAULT '{}'");
  if (
    !db
      .prepare('PRAGMA table_info(orders)')
      .all()
      .some((column) => column.name === 'stock_released')
  )
    db.exec('ALTER TABLE orders ADD COLUMN stock_released INTEGER NOT NULL DEFAULT 0');
  if (
    !db
      .prepare('PRAGMA table_info(orders)')
      .all()
      .some((column) => column.name === 'client_request_id')
  )
    db.exec('ALTER TABLE orders ADD COLUMN client_request_id TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(orders)')
      .all()
      .some((column) => column.name === 'payment_method')
  )
    db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'wechat'");
  const userColumns = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((column) => column.name);
  if (!userColumns.includes('admin_note'))
    db.exec("ALTER TABLE users ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('disabled_at'))
    db.exec('ALTER TABLE users ADD COLUMN disabled_at TEXT');
  if (!userColumns.includes('disabled_reason'))
    db.exec("ALTER TABLE users ADD COLUMN disabled_reason TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('is_merchant'))
    db.exec('ALTER TABLE users ADD COLUMN is_merchant INTEGER NOT NULL DEFAULT 0');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request ON orders(user_id,client_request_id) WHERE client_request_id IS NOT NULL',
  );
  const defaults = {
    shop: {
      name: '拾味小馆',
      hours: '每天 10:00–21:00',
      notice: '现做餐食，建议提前下单，到店自取。',
      phone: '',
      pickupAddress: '',
      pickupGuide: '支付后请留意订单状态，制作完成即可到店领取。',
    },
    page: {
      heroTitle: '好好吃饭，刚刚好。',
      heroSubtitle: '新鲜现做 · 到店自取',
      heroImage: '',
      accent: '#78b93b',
      showFeatured: true,
      featuredTitle: '今日推荐',
      showNotice: true,
      profileMessage: '每一餐，都值得认真对待。',
    },
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  Object.entries(defaults).forEach(([key, value]) => insert.run(key, JSON.stringify(value)));
  if (!db.prepare('SELECT 1 FROM categories LIMIT 1').get()) {
    const category = db.prepare('INSERT INTO categories(name,sort_order) VALUES (?,?)');
    const product = db.prepare(
      'INSERT INTO products(category_id,name,description,base_price,stock,featured,options) VALUES (?,?,?,?,?,?,?)',
    );
    db.transaction(() => {
      const rice = category.run('主食', 1).lastInsertRowid;
      const drink = category.run('饮品', 2).lastInsertRowid;
      product.run(
        rice,
        '招牌照烧鸡饭',
        '鸡腿肉现煎，搭配时蔬与米饭。',
        2680,
        30,
        1,
        JSON.stringify([
          {
            name: '份量',
            required: true,
            choices: [
              { name: '标准份', price: 0 },
              { name: '加大份', price: 500 },
            ],
          },
          {
            name: '口味',
            required: true,
            choices: [
              { name: '原味', price: 0 },
              { name: '微辣', price: 0 },
            ],
          },
          {
            name: '加料',
            required: false,
            choices: [
              { name: '溏心蛋', price: 300 },
              { name: '加鸡肉', price: 600 },
            ],
          },
        ]),
      );
      product.run(rice, '番茄牛腩饭', '慢炖牛腩与酸甜番茄酱汁。', 3280, 20, 1, '[]');
      product.run(drink, '手作柠檬茶', '鲜柠檬与清香茶底。', 1200, 40, 0, '[]');
    })();
  }
  return db;
}

export const getSetting = (db, key) =>
  JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '{}');
export const setSetting = (db, key, value) =>
  db
    .prepare(
      'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    )
    .run(key, JSON.stringify(value));
export const audit = (db, actor, action, targetType, targetId, detail = '') =>
  db
    .prepare('INSERT INTO audits(actor,action,target_type,target_id,detail) VALUES (?,?,?,?,?)')
    .run(actor, action, targetType, String(targetId), detail);
