import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { orderWorkbook } from './xlsx.js';
import { createDb, getSetting, setSetting, audit } from './db.js';
import {
  ApiError,
  fail,
  now,
  money,
  asId,
  productDto,
  priceFor,
  validateOptions,
  token,
  verifyToken,
  safeEqual,
} from './lib.js';
import {
  loginWithCode,
  paymentMode,
  createPrepay,
  closePayment,
  lookupPayment,
  verifyNotification,
} from './wechat.js';
import { paymentConfig, paymentPublic, savePaymentConfig } from './payment-config.js';
import { miniProgramRelease } from './miniprogram-release.js';
import { addWalletEntry, walletBalance } from './wallet.js';

const wrap = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(next);
const txt = (value, max = 200) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const bool = (value) => value === true || value === 1;
const secret = () =>
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'development-only-session-secret');
const projectRoot = path.resolve(import.meta.dirname, '../..');
const uploadDir = path.join(projectRoot, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
function uploadedImage(req, res, next) {
  if (!req.file) return next(new ApiError(400, '请选择 JPG、PNG 或 WebP 图片'));
  const bytes = req.file.buffer.subarray(0, 12);
  const ext =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? '.jpg'
      : bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        ? '.png'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          ? '.webp'
          : '';
  if (!ext) return next(new ApiError(400, '图片文件格式无效'));
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer, { flag: 'wx' });
  res.json({ url: `/uploads/${filename}` });
}

export function createApp(db = createDb()) {
  if (!secret()) throw new Error('SESSION_SECRET is required in production');
  if (
    process.env.NODE_ENV === 'production' &&
    (secret().length < 32 ||
      secret().startsWith('replace-') ||
      !process.env.ADMIN_USERNAME ||
      !process.env.ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWORD.length < 16 ||
      process.env.ADMIN_PASSWORD.startsWith('replace-'))
  )
    throw new Error('Set a strong ADMIN_PASSWORD and SESSION_SECRET before production startup');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  const loginAttempts = new Map();

  const readOrder = (id) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (!order) fail(404, '订单不存在');
    return {
      ...order,
      items: db
        .prepare(
          'SELECT product_id,name,image,options_label,selection,unit_price,quantity FROM order_items WHERE order_id=?',
        )
        .all(id)
        .map((item) => ({ ...item, selection: JSON.parse(item.selection) })),
    };
  };
  const restoreStock = (orderId) => {
    const items = db
      .prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?')
      .all(orderId);
    const restore = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
    items.forEach((item) => restore.run(item.quantity, item.product_id));
  };
  const cancelPending = (order, reason, actor) =>
    db.transaction(() => {
      const result = db
        .prepare(
          "UPDATE orders SET status='CANCELLED',stock_released=1,updated_at=? WHERE id=? AND status='PENDING_PAYMENT'",
        )
        .run(now(), order.id);
      if (result.changes) {
        restoreStock(order.id);
        audit(db, actor, '取消订单', 'order', order.id, reason);
      }
      return !!result.changes;
    })();
  const markPaid = (orderNo, amount, transactionId) =>
    db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE order_no=?').get(orderNo);
      if (!order || order.amount !== amount) fail(400, '订单金额不匹配');
      if (
        order.status === 'CANCELLED' ||
        (order.status === 'PENDING_PAYMENT' && order.expires_at <= now())
      ) {
        db.prepare(
          "UPDATE orders SET status='REFUND_PENDING',paid_at=?,updated_at=?,refund_note=? WHERE id=?",
        ).run(now(), now(), '支付在订单超时或取消后确认，请在微信商户平台退款', order.id);
        audit(db, '微信支付', '超时付款待退款', 'order', order.id, transactionId);
        return false;
      }
      if (order.status !== 'PENDING_PAYMENT') return false;
      const time = now();
      db.prepare(
        "UPDATE orders SET status='PENDING_ACCEPTANCE',paid_at=?,updated_at=?,payment_method=? WHERE id=?",
      ).run(time, time, transactionId === 'mock' ? 'mock' : 'wechat', order.id);
      audit(db, '微信支付', '支付成功', 'order', order.id, transactionId);
      return order.id;
    })();
  const markTopupPaid = (topupNo, amount, transactionId) =>
    db.transaction(() => {
      const topup = db.prepare('SELECT * FROM wallet_topups WHERE topup_no=?').get(topupNo);
      if (!topup || topup.amount !== amount || !transactionId)
        fail(400, '充值金额或支付记录不匹配');
      if (topup.status === 'PAID') {
        if (topup.transaction_id !== transactionId) fail(409, '充值支付记录不一致');
        return false;
      }
      const used = db
        .prepare('SELECT id FROM wallet_topups WHERE transaction_id=?')
        .get(transactionId);
      if (used) fail(409, '支付记录已用于其他充值');
      db.prepare(
        "UPDATE wallet_topups SET status='PAID',paid_at=?,transaction_id=? WHERE id=?",
      ).run(now(), transactionId, topup.id);
      addWalletEntry(db, {
        userId: topup.user_id,
        amount,
        kind: 'TOPUP',
        reference: `topup:${topup.id}`,
        detail: `微信充值 ${topup.topup_no}`,
        actor: '微信支付',
      });
      audit(db, '微信支付', '余额充值到账', 'user', topup.user_id, topup.topup_no);
      return true;
    })();
  const printOrder = async (orderId) => {
    if (!process.env.PRINTER_WEBHOOK_URL) return { configured: false };
    const order = readOrder(orderId);
    const response = await fetch(process.env.PRINTER_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PRINTER_WEBHOOK_TOKEN || ''}`,
      },
      body: JSON.stringify({
        orderNo: order.order_no,
        paidAt: order.paid_at,
        remark: order.remark,
        amount: order.amount,
        items: order.items,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`打印服务返回 ${response.status}`);
    audit(db, '系统', '发送小票', 'order', orderId);
    return { configured: true };
  };
  const safePrint = (orderId) =>
    printOrder(orderId).catch((error) => {
      audit(db, '系统', '小票发送失败', 'order', orderId, error.message);
    });

  app.post(
    '/api/pay/notify',
    express.raw({ type: 'application/json', limit: '100kb' }),
    wrap(async (req, res) => {
      const data = verifyNotification(db, req.headers, req.body.toString());
      if (data.trade_state === 'SUCCESS') {
        if (data.mchid !== paymentConfig(db).mchId || data.appid !== paymentConfig(db).appId)
          fail(401, '支付通知商户不匹配');
        const topup = db
          .prepare('SELECT id FROM wallet_topups WHERE topup_no=?')
          .get(data.out_trade_no);
        if (topup) markTopupPaid(data.out_trade_no, data.amount?.total, data.transaction_id || '');
        else {
          const id = markPaid(data.out_trade_no, data.amount?.total, data.transaction_id || '');
          if (id) await safePrint(id);
        }
      }
      res.json({ code: 'SUCCESS', message: '成功' });
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/uploads',
    express.static(uploadDir, {
      immutable: true,
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  const admin = (req, _res, next) => {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('admin_session='))
      ?.slice(14);
    const auth = verifyToken(cookie, secret());
    if (auth?.role !== 'admin') return next(new ApiError(401, '请先登录管理端'));
    req.admin = auth;
    next();
  };
  const user = (req, _res, next) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : '';
    const auth = verifyToken(bearer, secret());
    if (auth?.role !== 'user') return next(new ApiError(401, '请先微信登录'));
    req.user = db.prepare('SELECT * FROM users WHERE id=?').get(auth.id);
    if (!req.user) return next(new ApiError(401, '登录已失效'));
    if (req.user.disabled_at) return next(new ApiError(403, '账号暂不可用，请联系商家'));
    next();
  };
  const merchant = (req, res, next) =>
    user(req, res, (error) => {
      if (error) return next(error);
      if (!req.user.is_merchant) return next(new ApiError(403, '当前账号没有商家权限'));
      next();
    });

  app.get('/api/health', (_req, res) => res.json({ ok: true, payment: paymentMode(db) }));
  app.get('/api/store', (_req, res) => {
    const categories = db
      .prepare('SELECT * FROM categories WHERE enabled=1 ORDER BY sort_order,id')
      .all()
      .map((row) => ({ ...row, enabled: true }));
    const products = db
      .prepare(
        'SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE p.enabled=1 AND c.enabled=1 ORDER BY c.sort_order,p.id',
      )
      .all()
      .map(productDto);
    res.json({
      shop: getSetting(db, 'shop'),
      page: getSetting(db, 'page'),
      categories,
      products,
      payment: paymentMode(db),
    });
  });
  app.post(
    '/api/auth/wechat',
    wrap(async (req, res) => {
      if (!txt(req.body?.code, 100)) fail(400, '缺少微信登录凭证');
      const openid = await loginWithCode(db, req.body.code);
      db.prepare('INSERT OR IGNORE INTO users(openid) VALUES (?)').run(openid);
      const row = db.prepare('SELECT * FROM users WHERE openid=?').get(openid);
      if (row.disabled_at) fail(403, '账号暂不可用，请联系商家');
      res.json({
        token: token({ role: 'user', id: row.id }, secret(), 30 * 86400),
        profile: { nickname: row.nickname, avatar: row.avatar, isMerchant: !!row.is_merchant },
      });
    }),
  );
  app.get('/api/me', user, (req, res) =>
    res.json({
      nickname: req.user.nickname,
      avatar: req.user.avatar,
      balance: walletBalance(db, req.user.id),
      isMerchant: !!req.user.is_merchant,
    }),
  );
  app.put('/api/me', user, (req, res) => {
    const nickname = txt(req.body?.nickname, 40);
    const avatar = txt(req.body?.avatar, 500);
    if (avatar && !avatar.startsWith('/uploads/')) fail(400, '头像地址无效');
    db.prepare('UPDATE users SET nickname=?,avatar=? WHERE id=?').run(
      nickname,
      avatar,
      req.user.id,
    );
    res.json({ nickname, avatar });
  });
  app.post('/api/me/avatar', user, (req, res, next) =>
    upload.single('image')(req, res, (error) => {
      if (error) return next(new ApiError(400, '请上传 5 MB 以内的 JPG、PNG 或 WebP 图片'));
      uploadedImage(req, res, next);
    }),
  );
  const userTopup = (userId, id) => {
    const topup = db
      .prepare('SELECT * FROM wallet_topups WHERE id=? AND user_id=?')
      .get(id, userId);
    if (!topup) fail(404, '充值单不存在');
    return topup;
  };
  app.get('/api/wallet', user, (req, res) => {
    res.json({
      balance: walletBalance(db, req.user.id),
      entries: db
        .prepare(
          'SELECT id,amount,kind,detail,created_at FROM wallet_entries WHERE user_id=? ORDER BY id DESC LIMIT 50',
        )
        .all(req.user.id),
      topups: db
        .prepare(
          'SELECT id,topup_no,amount,status,created_at,expires_at,paid_at FROM wallet_topups WHERE user_id=? ORDER BY id DESC LIMIT 10',
        )
        .all(req.user.id),
    });
  });
  app.post('/api/wallet/topups', user, (req, res) => {
    const amount = Number(req.body?.amount);
    const clientRequestId = txt(req.body?.clientRequestId, 80);
    if (!Number.isInteger(amount) || amount < 100 || amount > 100000)
      fail(400, '单次充值金额须在 1 元至 1000 元之间');
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(clientRequestId)) fail(400, '充值请求无效');
    if (paymentMode(db) === 'unavailable') fail(503, '微信支付尚未配置，请联系商家');
    const topup = db.transaction(() => {
      const existing = db
        .prepare('SELECT * FROM wallet_topups WHERE user_id=? AND client_request_id=?')
        .get(req.user.id, clientRequestId);
      if (existing) {
        if (existing.amount !== amount) fail(409, '充值请求金额已变化，请重新发起');
        return existing;
      }
      const topupNo = `R${Date.now()}${crypto.randomBytes(6).toString('hex')}`;
      const time = now();
      const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const id = db
        .prepare(
          "INSERT INTO wallet_topups(topup_no,user_id,amount,status,created_at,expires_at,client_request_id) VALUES (?,?,?,'PENDING',?,?,?)",
        )
        .run(topupNo, req.user.id, amount, time, expires, clientRequestId).lastInsertRowid;
      return userTopup(req.user.id, id);
    })();
    res.status(201).json(topup);
  });
  app.get('/api/wallet/topups/:id', user, (req, res) =>
    res.json(userTopup(req.user.id, asId(req.params.id))),
  );
  app.post(
    '/api/wallet/topups/:id/pay',
    user,
    wrap(async (req, res) => {
      const topup = userTopup(req.user.id, asId(req.params.id));
      if (topup.status === 'PAID') fail(409, '充值已到账');
      if (topup.expires_at <= now()) fail(409, '充值单已过期，请重新发起');
      if (paymentMode(db) === 'mock') return res.json({ mock: true, topupId: topup.id });
      res.json(
        await createPrepay(
          db,
          { order_no: topup.topup_no, amount: topup.amount, expires_at: topup.expires_at },
          req.user.openid,
          '点餐余额充值',
        ),
      );
    }),
  );
  app.post('/api/wallet/topups/:id/mock-pay', user, (req, res) => {
    if (paymentMode(db) !== 'mock') fail(404, '当前不可用');
    const topup = userTopup(req.user.id, asId(req.params.id));
    if (topup.expires_at <= now() && topup.status !== 'PAID') fail(409, '充值单已过期');
    markTopupPaid(topup.topup_no, topup.amount, `mock:${topup.id}`);
    res.json({ topup: userTopup(req.user.id, topup.id), balance: walletBalance(db, req.user.id) });
  });
  app.post(
    '/api/wallet/topups/:id/refresh',
    user,
    wrap(async (req, res) => {
      const topup = userTopup(req.user.id, asId(req.params.id));
      if (topup.status !== 'PAID' && paymentMode(db) === 'wechat') {
        try {
          const paid = await lookupPayment(db, topup.topup_no);
          if (paid.trade_state === 'SUCCESS') {
            const config = paymentConfig(db);
            if (paid.mchid !== config.mchId || paid.appid !== config.appId)
              fail(401, '支付商户不匹配');
            markTopupPaid(topup.topup_no, paid.amount?.total, paid.transaction_id || '');
          }
        } catch (error) {
          if (error.code !== 'ORDER_NOT_EXIST') throw error;
        }
      }
      res.json({
        topup: userTopup(req.user.id, topup.id),
        balance: walletBalance(db, req.user.id),
      });
    }),
  );
  app.get('/api/favorites', user, (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT p.* FROM favorites f JOIN products p ON p.id=f.product_id WHERE f.user_id=? AND p.enabled=1',
        )
        .all(req.user.id)
        .map(productDto),
    ),
  );
  app.put('/api/favorites/:id', user, (req, res) => {
    const id = asId(req.params.id);
    if (!db.prepare('SELECT 1 FROM products WHERE id=? AND enabled=1').get(id))
      fail(404, '菜品不存在');
    db.prepare('INSERT OR IGNORE INTO favorites(user_id,product_id) VALUES (?,?)').run(
      req.user.id,
      id,
    );
    res.json({ ok: true });
  });
  app.delete('/api/favorites/:id', user, (req, res) => {
    db.prepare('DELETE FROM favorites WHERE user_id=? AND product_id=?').run(
      req.user.id,
      asId(req.params.id),
    );
    res.json({ ok: true });
  });

  app.post('/api/orders', user, (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length || items.length > 50)
      fail(400, '请选择要结算的菜品');
    const remark = txt(req.body?.remark, 300);
    const clientRequestId = txt(req.body?.clientRequestId, 80) || null;
    if (clientRequestId && !/^[a-zA-Z0-9-]{8,80}$/.test(clientRequestId)) fail(400, '下单请求无效');
    const created = db.transaction(() => {
      if (clientRequestId) {
        const existing = db
          .prepare('SELECT id FROM orders WHERE user_id=? AND client_request_id=?')
          .get(req.user.id, clientRequestId);
        if (existing) return readOrder(existing.id);
      }
      let amount = 0;
      const lines = [];
      const requested = new Map();
      for (const item of items) {
        const id = asId(item.productId);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail(400, '菜品数量无效');
        const row = db
          .prepare(
            'SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.enabled=1 AND c.enabled=1',
          )
          .get(id);
        if (!row) fail(400, '有菜品已下架，请刷新购物车');
        const product = productDto(row);
        const { price, label } = priceFor(product, item.selection || {});
        requested.set(id, (requested.get(id) || 0) + quantity);
        amount += price * quantity;
        lines.push({
          id,
          name: product.name,
          image: product.image,
          price,
          label,
          selection: item.selection || {},
          quantity,
        });
      }
      if (!money(amount) || amount === 0) fail(400, '订单金额无效');
      for (const [id, quantity] of requested) {
        if (
          !db
            .prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?')
            .run(quantity, id, quantity).changes
        )
          fail(409, '部分菜品库存不足，请刷新购物车');
      }
      const time = now();
      const orderNo = `${Date.now()}${crypto.randomInt(100000, 999999)}`;
      const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const orderId = db
        .prepare(
          'INSERT INTO orders(order_no,user_id,status,amount,remark,created_at,expires_at,updated_at,client_request_id,payment_method) VALUES (?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          orderNo,
          req.user.id,
          'PENDING_PAYMENT',
          amount,
          remark,
          time,
          expires,
          time,
          clientRequestId,
          'none',
        ).lastInsertRowid;
      const addLine = db.prepare(
        'INSERT INTO order_items(order_id,product_id,name,image,options_label,selection,unit_price,quantity) VALUES (?,?,?,?,?,?,?,?)',
      );
      lines.forEach((line) =>
        addLine.run(
          orderId,
          line.id,
          line.name,
          line.image,
          line.label,
          JSON.stringify(line.selection),
          line.price,
          line.quantity,
        ),
      );
      audit(db, `顾客 ${req.user.id}`, '创建订单', 'order', orderId);
      return readOrder(orderId);
    })();
    res.status(201).json(created);
  });
  app.get('/api/orders', user, (req, res) => {
    const status = txt(req.query.status, 40);
    const rows = status
      ? db
          .prepare('SELECT * FROM orders WHERE user_id=? AND status=? ORDER BY id DESC')
          .all(req.user.id, status)
      : db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);
    res.json(rows.map((row) => readOrder(row.id)));
  });
  app.get('/api/orders/:id', user, (req, res) => {
    const order = readOrder(asId(req.params.id));
    if (order.user_id !== req.user.id) fail(404, '订单不存在');
    res.json(order);
  });
  app.post(
    '/api/orders/:id/pay',
    user,
    wrap(async (req, res) => {
      const order = readOrder(asId(req.params.id));
      if (order.user_id !== req.user.id) fail(404, '订单不存在');
      if (order.status !== 'PENDING_PAYMENT' || order.expires_at <= now())
        fail(409, '订单已失效，请重新下单');
      if (paymentMode(db) === 'unavailable') fail(503, '微信支付尚未配置，请选择余额支付');
      db.transaction(() => {
        const current = readOrder(order.id);
        if (current.status !== 'PENDING_PAYMENT' || current.expires_at <= now())
          fail(409, '订单已失效，请刷新后重试');
        if (!['none', 'wechat_initiated'].includes(current.payment_method))
          fail(409, '订单支付方式已变化，请刷新后重试');
        if (current.payment_method === 'none')
          db.prepare("UPDATE orders SET payment_method='wechat_initiated' WHERE id=?").run(
            order.id,
          );
      })();
      if (paymentMode(db) === 'mock') return res.json({ mock: true, orderId: order.id });
      res.json(await createPrepay(db, order, req.user.openid));
    }),
  );
  app.post(
    '/api/orders/:id/balance-pay',
    user,
    wrap(async (req, res) => {
      const order = readOrder(asId(req.params.id));
      if (order.user_id !== req.user.id) fail(404, '订单不存在');
      if (order.status !== 'PENDING_PAYMENT' || order.expires_at <= now())
        fail(409, '订单已失效，请刷新后重试');
      if (order.payment_method !== 'none')
        fail(409, '这笔订单已发起微信支付，请继续微信支付或取消后重新下单');
      const paid = db.transaction(() => {
        const current = readOrder(order.id);
        if (current.status !== 'PENDING_PAYMENT' || current.expires_at <= now())
          fail(409, '订单状态已变化，请刷新后重试');
        if (current.payment_method !== 'none')
          fail(409, '这笔订单已发起微信支付，请继续微信支付或取消后重新下单');
        addWalletEntry(db, {
          userId: req.user.id,
          amount: -current.amount,
          kind: 'ORDER_PAYMENT',
          reference: `order:${current.id}`,
          detail: `订单 ${current.order_no}`,
          actor: `顾客 ${req.user.id}`,
        });
        const time = now();
        db.prepare(
          "UPDATE orders SET status='PENDING_ACCEPTANCE',paid_at=?,updated_at=?,payment_method='balance' WHERE id=?",
        ).run(time, time, current.id);
        audit(db, `顾客 ${req.user.id}`, '余额支付订单', 'order', current.id);
        return readOrder(current.id);
      })();
      await safePrint(paid.id);
      res.json(paid);
    }),
  );
  app.post(
    '/api/orders/:id/mock-pay',
    user,
    wrap(async (req, res) => {
      if (paymentMode(db) !== 'mock') fail(404, '当前不可用');
      const order = readOrder(asId(req.params.id));
      if (order.user_id !== req.user.id || order.expires_at <= now()) fail(409, '订单已失效');
      if (
        order.status !== 'PENDING_PAYMENT' ||
        !['none', 'wechat_initiated'].includes(order.payment_method)
      )
        fail(409, '订单支付方式已变化，请刷新后重试');
      const id = markPaid(order.order_no, order.amount, 'mock');
      if (id) await safePrint(id);
      res.json(readOrder(order.id));
    }),
  );
  app.post(
    '/api/orders/:id/cancel',
    user,
    wrap(async (req, res) => {
      const order = readOrder(asId(req.params.id));
      if (order.user_id !== req.user.id) fail(404, '订单不存在');
      if (order.status !== 'PENDING_PAYMENT') fail(409, '只有待付款订单可以取消');
      try {
        await closePayment(db, order.order_no);
      } catch (error) {
        if (error.code === 'ORDER_PAID') {
          const paid = await lookupPayment(db, order.order_no);
          if (paid.trade_state === 'SUCCESS') {
            const id = markPaid(order.order_no, paid.amount?.total, paid.transaction_id || '');
            if (id) await safePrint(id);
          }
          fail(409, '订单已付款，请刷新查看');
        }
        throw error;
      }
      cancelPending(order, '顾客取消', `顾客 ${req.user.id}`);
      res.json(readOrder(order.id));
    }),
  );

  app.post('/api/admin/login', (req, res) => {
    const key = req.ip || 'unknown';
    const record = loginAttempts.get(key);
    if (record && record.until > Date.now() && record.count >= 10)
      fail(429, '尝试次数过多，请 15 分钟后重试');
    const configuredPassword = process.env.ADMIN_PASSWORD;
    if (!configuredPassword || !process.env.ADMIN_USERNAME) fail(503, '请先配置管理员账号密码');
    if (
      !safeEqual(req.body?.username, process.env.ADMIN_USERNAME) ||
      !safeEqual(req.body?.password, configuredPassword)
    ) {
      const next =
        record && record.until > Date.now()
          ? { count: record.count + 1, until: record.until }
          : { count: 1, until: Date.now() + 15 * 60 * 1000 };
      loginAttempts.set(key, next);
      fail(401, '账号或密码错误');
    }
    loginAttempts.delete(key);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `admin_session=${token({ role: 'admin', name: process.env.ADMIN_USERNAME }, secret(), 12 * 3600)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`,
    );
    res.json({ username: process.env.ADMIN_USERNAME });
  });
  app.post('/api/admin/logout', admin, (_req, res) => {
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/admin/me', admin, (req, res) => res.json({ username: req.admin.name }));
  app.get('/api/admin/payment', admin, (_req, res) => res.json(paymentPublic(paymentConfig(db))));
  app.put('/api/admin/payment', admin, (req, res) =>
    res.json(savePaymentConfig(db, req.body, req.admin.name)),
  );
  app.get('/api/admin/miniprogram-release', admin, (_req, res) => {
    const bundle = miniProgramRelease(paymentConfig(db));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="miniprogram-release.zip"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(bundle);
  });
  app.get('/api/admin/overview', admin, (_req, res) => {
    const today = db
      .prepare(
        "SELECT COUNT(*) AS orders,COALESCE(SUM(amount),0) AS revenue FROM orders WHERE date(paid_at,'+8 hours')=date('now','+8 hours') AND status NOT IN ('CANCELLED','REFUND_PENDING','REFUNDED')",
      )
      .get();
    const pending = db
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE status='PENDING_ACCEPTANCE'")
      .get().count;
    const preparing = db
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE status IN ('PREPARING','READY')")
      .get().count;
    const recent = db
      .prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 8')
      .all()
      .map((row) => readOrder(row.id));
    res.json({
      today,
      pending,
      preparing,
      recent,
      payment: paymentMode(db),
      printer: !!process.env.PRINTER_WEBHOOK_URL,
    });
  });
  const customerColumns = `
    u.id,u.nickname,u.avatar,u.created_at,u.disabled_at,u.disabled_reason,u.admin_note,u.is_merchant,
    COUNT(o.id) AS order_count,
    COALESCE(SUM(CASE WHEN o.paid_at IS NOT NULL AND o.status NOT IN ('REFUND_PENDING','REFUNDED') THEN 1 ELSE 0 END),0) AS paid_order_count,
    COALESCE(SUM(CASE WHEN o.paid_at IS NOT NULL AND o.status NOT IN ('REFUND_PENDING','REFUNDED') THEN o.amount ELSE 0 END),0) AS paid_amount,
    MAX(o.created_at) AS last_order_at,
    (SELECT COALESCE(SUM(w.amount),0) FROM wallet_entries w WHERE w.user_id=u.id) AS balance`;
  const customerSql = `SELECT ${customerColumns} FROM users u LEFT JOIN orders o ON o.user_id=u.id`;
  const customer = (id) => {
    const row = db.prepare(`${customerSql} WHERE u.id=? GROUP BY u.id`).get(id);
    if (!row) fail(404, '顾客不存在');
    return row;
  };
  app.get('/api/admin/customers', admin, (req, res) => {
    const q = txt(req.query.q, 80);
    const status = txt(req.query.status, 20);
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    if (status && !['active', 'disabled'].includes(status)) fail(400, '筛选状态无效');
    const where = [];
    const params = [];
    if (q) {
      where.push(
        '(instr(u.nickname, ?) > 0 OR EXISTS (SELECT 1 FROM orders search_order WHERE search_order.user_id=u.id AND instr(search_order.order_no, ?) > 0))',
      );
      params.push(q, q);
    }
    if (status)
      where.push(status === 'disabled' ? 'u.disabled_at IS NOT NULL' : 'u.disabled_at IS NULL');
    const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM users u${condition}`)
      .get(...params).count;
    const pageSize = 20;
    const rows = db
      .prepare(`${customerSql}${condition} GROUP BY u.id ORDER BY u.id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map(({ disabled_reason, admin_note, ...row }) => row);
    res.json({ rows, total, page, pageSize });
  });
  app.get('/api/admin/customers/:id', admin, (req, res) => {
    const id = asId(req.params.id);
    const profile = customer(id);
    const orders = db
      .prepare('SELECT id FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 30')
      .all(id)
      .map((row) => readOrder(row.id));
    const walletEntries = db
      .prepare(
        'SELECT id,amount,kind,detail,actor,created_at FROM wallet_entries WHERE user_id=? ORDER BY id DESC LIMIT 30',
      )
      .all(id);
    res.json({ customer: profile, orders, walletEntries });
  });
  app.put('/api/admin/customers/:id/note', admin, (req, res) => {
    const id = asId(req.params.id);
    customer(id);
    const note = txt(req.body?.note, 500);
    db.transaction(() => {
      db.prepare('UPDATE users SET admin_note=? WHERE id=?').run(note, id);
      audit(db, req.admin.name, '更新顾客备注', 'user', id, note);
    })();
    res.json(customer(id));
  });
  app.post('/api/admin/customers/:id/merchant', admin, (req, res) => {
    const id = asId(req.params.id);
    if (typeof req.body?.isMerchant !== 'boolean') fail(400, '请选择是否为商家');
    const updated = db.transaction(() => {
      const current = customer(id);
      if (Boolean(current.is_merchant) === req.body.isMerchant)
        fail(409, '商家身份已变化，请刷新后重试');
      db.prepare('UPDATE users SET is_merchant=? WHERE id=?').run(req.body.isMerchant ? 1 : 0, id);
      audit(
        db,
        req.admin.name,
        req.body.isMerchant ? '授予商家身份' : '取消商家身份',
        'user',
        id,
      );
      return customer(id);
    })();
    res.json(updated);
  });
  app.post('/api/admin/customers/:id/status', admin, (req, res) => {
    const id = asId(req.params.id);
    if (typeof req.body?.disabled !== 'boolean') fail(400, '请选择顾客状态');
    const disabled = req.body.disabled;
    const reason = txt(req.body.reason, 300);
    if (disabled && !reason) fail(400, '请填写停用原因');
    const updated = db.transaction(() => {
      const current = customer(id);
      if (Boolean(current.disabled_at) === disabled) fail(409, '顾客状态已变化，请刷新后重试');
      if (disabled) {
        const active = db
          .prepare(
            "SELECT 1 FROM orders WHERE user_id=? AND status IN ('PENDING_PAYMENT','PENDING_ACCEPTANCE','PREPARING','READY','REFUND_PENDING') LIMIT 1",
          )
          .get(id);
        if (active) fail(409, '该顾客有未处理订单，请先完成订单处理');
      }
      db.prepare('UPDATE users SET disabled_at=?,disabled_reason=? WHERE id=?').run(
        disabled ? now() : null,
        disabled ? reason : '',
        id,
      );
      audit(db, req.admin.name, disabled ? '停用顾客' : '恢复顾客', 'user', id, reason);
      return customer(id);
    })();
    res.json(updated);
  });
  const adjustCustomerWallet = (operation) => (req, res) => {
    const credit = operation === 'credit';
    const action = credit ? '增加' : '扣减';
    const id = asId(req.params.id);
    const amount = Number(req.body?.amount);
    const reason = txt(req.body?.reason, 300);
    const clientRequestId = txt(req.body?.clientRequestId, 80);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000000)
      fail(400, `${action}金额无效`);
    if (!reason) fail(400, `请填写${action}原因`);
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(clientRequestId)) fail(400, `${action}请求无效`);
    customer(id);
    const reference = `admin-${operation}:${clientRequestId}`;
    const signedAmount = credit ? amount : -amount;
    const updated = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM wallet_entries WHERE reference=?').get(reference);
      if (existing) {
        if (
          existing.user_id !== id ||
          existing.amount !== signedAmount ||
          existing.detail !== reason
        )
          fail(409, `${action}请求内容已变化，请重新提交`);
        return customer(id);
      }
      addWalletEntry(db, {
        userId: id,
        amount: signedAmount,
        kind: credit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        reference,
        detail: reason,
        actor: req.admin.name,
      });
      audit(
        db,
        req.admin.name,
        `${action}顾客余额`,
        'user',
        id,
        `${(amount / 100).toFixed(2)} 元；${reason}`,
      );
      return customer(id);
    })();
    res.json(updated);
  };
  app.post('/api/admin/customers/:id/wallet/credit', admin, adjustCustomerWallet('credit'));
  app.post('/api/admin/customers/:id/wallet/debit', admin, adjustCustomerWallet('debit'));
  app.get('/api/admin/categories', admin, (_req, res) =>
    res.json(
      db
        .prepare('SELECT * FROM categories ORDER BY sort_order,id')
        .all()
        .map((row) => ({ ...row, enabled: !!row.enabled })),
    ),
  );
  app.post('/api/admin/categories', admin, (req, res) => {
    const name = txt(req.body?.name, 40);
    if (!name) fail(400, '请输入分类名称');
    const sort = db
      .prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM categories')
      .get().next;
    const id = db
      .prepare('INSERT INTO categories(name,sort_order,enabled) VALUES (?,?,?)')
      .run(name, sort, bool(req.body?.enabled) ? 1 : 0).lastInsertRowid;
    audit(db, req.admin.name, '新增分类', 'category', id, name);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=?').get(id));
  });
  app.put('/api/admin/categories/:id', admin, (req, res) => {
    const id = asId(req.params.id);
    const name = txt(req.body?.name, 40);
    if (!name) fail(400, '请输入分类名称');
    if (
      !db
        .prepare('UPDATE categories SET name=?,enabled=? WHERE id=?')
        .run(name, bool(req.body?.enabled) ? 1 : 0, id).changes
    )
      fail(404, '分类不存在');
    audit(db, req.admin.name, '修改分类', 'category', id, name);
    res.json(db.prepare('SELECT * FROM categories WHERE id=?').get(id));
  });
  app.post('/api/admin/categories/reorder', admin, (req, res) => {
    const ids = req.body?.ids;
    const existing = db
      .prepare('SELECT id FROM categories')
      .all()
      .map((row) => row.id);
    if (
      !Array.isArray(ids) ||
      ids.length !== existing.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !existing.includes(id))
    )
      fail(400, '分类顺序无效');
    db.transaction(() =>
      ids.forEach((id, index) =>
        db.prepare('UPDATE categories SET sort_order=? WHERE id=?').run(index + 1, id),
      ),
    )();
    audit(db, req.admin.name, '调整分类顺序', 'category', 'all');
    res.json({ ok: true });
  });
  app.get('/api/admin/products', admin, (_req, res) =>
    res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(productDto)),
  );
  const productInput = (body) => {
    const categoryId = asId(body.category_id);
    if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(categoryId))
      fail(400, '请选择有效分类');
    const name = txt(body.name, 80);
    const basePrice = Number(body.base_price);
    const stock = Number(body.stock);
    if (!name || !money(basePrice) || !Number.isSafeInteger(stock) || stock < 0 || stock > 1000000)
      fail(400, '请检查菜品名称、价格和库存');
    const options = body.options || [];
    validateOptions(options);
    const image = txt(body.image, 500);
    if (image && !image.startsWith('/uploads/')) fail(400, '请上传菜品图片');
    return {
      categoryId,
      name,
      description: txt(body.description, 1000),
      image,
      basePrice,
      stock,
      enabled: bool(body.enabled) ? 1 : 0,
      featured: bool(body.featured) ? 1 : 0,
      options: JSON.stringify(options),
    };
  };
  app.post('/api/admin/products', admin, (req, res) => {
    const p = productInput(req.body);
    const id = db
      .prepare(
        'INSERT INTO products(category_id,name,description,image,base_price,stock,enabled,featured,options) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        p.categoryId,
        p.name,
        p.description,
        p.image,
        p.basePrice,
        p.stock,
        p.enabled,
        p.featured,
        p.options,
      ).lastInsertRowid;
    audit(db, req.admin.name, '新增菜品', 'product', id, p.name);
    res.status(201).json(productDto(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
  });
  app.put('/api/admin/products/:id', admin, (req, res) => {
    const id = asId(req.params.id);
    const p = productInput(req.body);
    if (
      !db
        .prepare(
          'UPDATE products SET category_id=?,name=?,description=?,image=?,base_price=?,stock=?,enabled=?,featured=?,options=? WHERE id=?',
        )
        .run(
          p.categoryId,
          p.name,
          p.description,
          p.image,
          p.basePrice,
          p.stock,
          p.enabled,
          p.featured,
          p.options,
          id,
        ).changes
    )
      fail(404, '菜品不存在');
    audit(db, req.admin.name, '修改菜品', 'product', id, p.name);
    res.json(productDto(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
  });
  app.post('/api/admin/products/batch', admin, (req, res) => {
    const ids = req.body?.ids;
    const enabled = req.body?.enabled;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      ids.some((id) => !Number.isInteger(id) || id < 1) ||
      typeof enabled !== 'boolean'
    )
      fail(400, '请选择菜品及操作');
    const update = db.prepare('UPDATE products SET enabled=? WHERE id=?');
    db.transaction(() => ids.forEach((id) => update.run(enabled ? 1 : 0, id)))();
    audit(db, req.admin.name, enabled ? '批量上架' : '批量下架', 'product', ids.join(','));
    res.json({ ok: true });
  });
  app.post('/api/admin/upload', admin, (req, res, next) =>
    upload.single('image')(req, res, (error) => {
      if (error)
        return next(
          new ApiError(
            400,
            error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 5 MB' : '请上传 JPG、PNG 或 WebP 图片',
          ),
        );
      uploadedImage(req, res, next);
    }),
  );
  app.get('/api/admin/settings', admin, (_req, res) =>
    res.json({ shop: getSetting(db, 'shop'), page: getSetting(db, 'page') }),
  );
  app.put('/api/admin/settings', admin, (req, res) => {
    const currentShop = getSetting(db, 'shop');
    const currentPage = getSetting(db, 'page');
    const shop = {
      ...currentShop,
      name: txt(req.body?.shop?.name, 60),
      hours: txt(req.body?.shop?.hours, 100),
      notice: txt(req.body?.shop?.notice, 300),
      phone: txt(req.body?.shop?.phone, 30),
      pickupAddress: txt(req.body?.shop?.pickupAddress, 200),
      pickupGuide: txt(req.body?.shop?.pickupGuide, 300),
    };
    const page = {
      ...currentPage,
      heroTitle: txt(req.body?.page?.heroTitle, 60),
      heroSubtitle: txt(req.body?.page?.heroSubtitle, 100),
      heroImage: txt(req.body?.page?.heroImage, 500),
      accent: txt(req.body?.page?.accent, 7),
      showFeatured: bool(req.body?.page?.showFeatured),
      featuredTitle: txt(req.body?.page?.featuredTitle, 30),
      showNotice: bool(req.body?.page?.showNotice),
      profileMessage: txt(req.body?.page?.profileMessage, 100),
    };
    if (
      !shop.name ||
      !/^#[0-9a-fA-F]{6}$/.test(page.accent) ||
      (page.heroImage && !page.heroImage.startsWith('/uploads/'))
    )
      fail(400, '请检查店名、主题颜色和图片');
    db.transaction(() => {
      setSetting(db, 'shop', shop);
      setSetting(db, 'page', page);
      audit(db, req.admin.name, '更新店铺和页面', 'settings', 'store');
    })();
    res.json({ shop, page });
  });
  const listOrders = (req, res) => {
    const status = txt(req.query.status, 40);
    const from = txt(req.query.from, 10);
    const to = txt(req.query.to, 10);
    let query = 'SELECT id FROM orders WHERE 1=1';
    const params = [];
    if (status) {
      query += ' AND status=?';
      params.push(status);
    }
    if (from) {
      query += " AND date(created_at,'+8 hours')>=?";
      params.push(from);
    }
    if (to) {
      query += " AND date(created_at,'+8 hours')<=?";
      params.push(to);
    }
    query += ' ORDER BY id DESC LIMIT 500';
    res.json(
      db
        .prepare(query)
        .all(...params)
        .map((row) => readOrder(row.id)),
    );
  };
  const orderActor = (req) => req.admin?.name || `商家 ${req.user.id}`;
  const orderAction = (req, res) => {
    const order = readOrder(asId(req.params.id));
    const action = txt(req.body?.action, 30);
    const reason = txt(req.body?.reason, 300);
    const transitions = {
      accept: ['PENDING_ACCEPTANCE', 'PREPARING'],
      ready: ['PREPARING', 'READY'],
      complete: ['READY', 'COMPLETED'],
      reject: ['PENDING_ACCEPTANCE', 'REFUND_PENDING'],
      refunded: ['REFUND_PENDING', 'REFUNDED'],
    };
    const balanceRefund = action === 'reject' && order.payment_method === 'balance';
    const transition = balanceRefund ? ['PENDING_ACCEPTANCE', 'REFUNDED'] : transitions[action];
    if (!transition || order.status !== transition[0]) fail(409, '订单状态已变化，请刷新后再操作');
    if (action === 'reject' && !reason) fail(400, '请填写拒单原因');
    if (action === 'refunded' && !reason) fail(400, '请填写微信商户平台退款凭证或说明');
    db.transaction(() => {
      const changed = db
        .prepare('UPDATE orders SET status=?,refund_note=?,updated_at=? WHERE id=? AND status=?')
        .run(
          transition[1],
          balanceRefund
            ? `${reason}；余额已退回`
            : action === 'reject' || action === 'refunded'
              ? reason
              : order.refund_note,
          now(),
          order.id,
          transition[0],
        ).changes;
      if (!changed) fail(409, '订单状态已变化，请刷新后再操作');
      if (balanceRefund) {
        addWalletEntry(db, {
          userId: order.user_id,
          amount: order.amount,
          kind: 'ORDER_REFUND',
          reference: `order-refund:${order.id}`,
          detail: `订单 ${order.order_no} 拒单退款`,
          actor: orderActor(req),
        });
      }
      if ((action === 'refunded' || balanceRefund) && !order.stock_released) {
        restoreStock(order.id);
        db.prepare('UPDATE orders SET stock_released=1 WHERE id=?').run(order.id);
      }
      audit(
        db,
        orderActor(req),
        {
          accept: '接单',
          ready: '制作完成',
          complete: '订单完结',
          reject: balanceRefund ? '拒单并退回余额' : '拒单待退款',
          refunded: '确认已退款',
        }[action],
        'order',
        order.id,
        reason,
      );
    })();
    res.json(readOrder(order.id));
  };
  const sendOrderPrint = wrap(async (req, res) => {
    const id = asId(req.params.id);
    const order = readOrder(id);
    if (!order.paid_at) fail(409, '待付款订单不能打印小票');
    try {
      res.json(await printOrder(id));
    } catch (error) {
      audit(db, orderActor(req), '小票发送失败', 'order', id, error.message);
      fail(502, '打印服务暂时不可用，请稍后重试');
    }
  });
  for (const [prefix, access] of [
    ['/api/admin/orders', admin],
    ['/api/merchant/orders', merchant],
  ]) {
    app.get(prefix, access, listOrders);
    app.get(`${prefix}/:id`, access, (req, res) => res.json(readOrder(asId(req.params.id))));
    app.post(`${prefix}/:id/action`, access, orderAction);
    app.post(`${prefix}/:id/print`, access, sendOrderPrint);
  }
  app.get('/api/admin/stats', admin, (_req, res) => {
    const daily = db
      .prepare(
        "SELECT date(paid_at,'+8 hours') AS day,COUNT(*) AS orders,SUM(amount) AS revenue FROM orders WHERE paid_at IS NOT NULL AND status NOT IN ('REFUND_PENDING','REFUNDED') GROUP BY day ORDER BY day DESC LIMIT 30",
      )
      .all();
    const top = db
      .prepare(
        "SELECT oi.name,SUM(oi.quantity) AS quantity,SUM(oi.unit_price*oi.quantity) AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.paid_at IS NOT NULL AND o.status NOT IN ('REFUND_PENDING','REFUNDED') GROUP BY oi.product_id ORDER BY quantity DESC LIMIT 10",
      )
      .all();
    res.json({ daily, top });
  });
  app.get(
    '/api/admin/orders-export',
    admin,
    wrap(async (req, res) => {
      const from = txt(req.query.from, 10);
      const to = txt(req.query.to, 10);
      const status = txt(req.query.status, 40);
      let sql =
        "SELECT o.*,GROUP_CONCAT(oi.name || ' ×' || oi.quantity || CASE WHEN oi.options_label='' THEN '' ELSE '（' || oi.options_label || '）' END,'；') AS items FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE 1=1";
      const params = [];
      if (status) {
        sql += ' AND o.status=?';
        params.push(status);
      }
      if (from) {
        sql += " AND date(o.created_at,'+8 hours')>=?";
        params.push(from);
      }
      if (to) {
        sql += " AND date(o.created_at,'+8 hours')<=?";
        params.push(to);
      }
      sql += ' GROUP BY o.id ORDER BY o.id DESC LIMIT 10000';
      const rows = db.prepare(sql).all(...params);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      );
      res.end(orderWorkbook(rows));
    }),
  );
  app.get('/api/admin/audits', admin, (_req, res) =>
    res.json(db.prepare('SELECT * FROM audits ORDER BY id DESC LIMIT 100').all()),
  );

  const adminDist = path.join(projectRoot, 'admin/dist');
  if (fs.existsSync(adminDist)) {
    app.use('/admin', express.static(adminDist));
    app.get('/admin/{*path}', (_req, res) => res.sendFile(path.join(adminDist, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (Number.isInteger(error.status) && error.status >= 400 && error.status <= 599)
      return res.status(error.status).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: '服务器暂时无法处理，请稍后重试' });
  });
  return {
    app,
    db,
    expireOrders: async () => {
      const expired = db
        .prepare("SELECT * FROM orders WHERE status='PENDING_PAYMENT' AND expires_at<=?")
        .all(now());
      for (const order of expired) {
        try {
          await closePayment(db, order.order_no);
          cancelPending(order, '15 分钟未支付', '系统');
        } catch (error) {
          if (error.code === 'ORDER_PAID') {
            try {
              const paid = await lookupPayment(db, order.order_no);
              if (paid.trade_state === 'SUCCESS') {
                markPaid(order.order_no, paid.amount?.total, paid.transaction_id || '');
                continue;
              }
            } catch (lookupError) {
              audit(db, '系统', '支付状态查询失败', 'order', order.id, lookupError.message);
            }
          }
          audit(db, '系统', '超时关单失败', 'order', order.id, error.message);
        }
      }
    },
  };
}
