import { fail, now } from './lib.js';

export const walletBalance = (db, userId) =>
  db
    .prepare('SELECT COALESCE(SUM(amount),0) AS balance FROM wallet_entries WHERE user_id=?')
    .get(userId).balance;

// Call inside db.transaction so the balance check and new entry share one SQLite write lock.
export function addWalletEntry(db, { userId, amount, kind, reference, detail = '', actor }) {
  if (!Number.isSafeInteger(amount) || amount === 0) fail(400, '余额变动金额无效');
  const nextBalance = walletBalance(db, userId) + amount;
  if (nextBalance < 0) fail(409, '余额不足');
  if (!Number.isSafeInteger(nextBalance)) fail(400, '余额超过允许上限');
  const id = db
    .prepare(
      'INSERT INTO wallet_entries(user_id,amount,kind,reference,detail,actor,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(userId, amount, kind, reference, detail, actor, now()).lastInsertRowid;
  return { id, balance: nextBalance };
}
