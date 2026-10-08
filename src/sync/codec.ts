import type { SyncChange } from '../../server/src/contract';
import type { BindValue, Db } from '@/db/types';

/**
 * Har bir jadval qatori serverga JSON bo'lib boradi. Boshqa jadvalga havolalar lokal `id` emas,
 * global `uid` bilan yoziladi (`table_uid`, `bill_uid`, …) — qurilmalarda id'lar har xil.
 * Tartib muhim: ota jadvallar oldin qo'llanadi.
 */
export const TABLE_ORDER = [
  'tables',
  'products',
  'expense_categories',
  'customers',
  'bills',
  'bill_items',
  'payments',
  'debts',
  'expenses',
  'stock_moves',
  'settings',
] as const;

export type SyncTable = (typeof TABLE_ORDER)[number];

export const isSyncTable = (t: string): t is SyncTable => (TABLE_ORDER as readonly string[]).includes(t);

/** Qatorni uid bo'yicha o'qiydigan so'rovlar (havolalar uid'ga almashtirilgan). */
const SELECT: Record<SyncTable, string> = {
  tables: 'SELECT uid, name, hourly_rate, is_active, sort_order, kind, updated_at FROM tables WHERE uid = ?',
  products: 'SELECT uid, name, category, price, track_stock, is_active, updated_at FROM products WHERE uid = ?',
  expense_categories: 'SELECT uid, name, is_active, updated_at FROM expense_categories WHERE uid = ?',
  customers: 'SELECT uid, name, phone, note, created_at, updated_at FROM customers WHERE uid = ?',
  bills: `SELECT b.uid, b.kind, t.uid AS table_uid, c.uid AS customer_uid, b.label, b.status, b.started_at, b.ended_at,
            b.paused_at, b.paused_ms, b.carried_ms, b.carried_amount, b.hourly_rate, b.time_minutes, b.time_amount,
            b.items_amount, b.discount, b.rounding_adj, b.total, b.paid_amount, b.debt_amount, b.closed_at,
            b.cancel_reason, b.planned_minutes, b.updated_at
          FROM bills b
          LEFT JOIN tables t ON t.id = b.table_id
          LEFT JOIN customers c ON c.id = b.customer_id
          WHERE b.uid = ?`,
  bill_items: `SELECT i.uid, b.uid AS bill_uid, p.uid AS product_uid, i.name, i.qty, i.unit_price, i.created_at, i.updated_at
          FROM bill_items i
          JOIN bills b ON b.id = i.bill_id
          LEFT JOIN products p ON p.id = i.product_id
          WHERE i.uid = ?`,
  payments: `SELECT pm.uid, b.uid AS bill_uid, c.uid AS customer_uid, pm.amount, pm.method, pm.kind, pm.note,
            pm.created_at, pm.updated_at, pm.deleted_at
          FROM payments pm
          LEFT JOIN bills b ON b.id = pm.bill_id
          LEFT JOIN customers c ON c.id = pm.customer_id
          WHERE pm.uid = ?`,
  debts: `SELECT d.uid, c.uid AS customer_uid, b.uid AS bill_uid, d.amount, d.note, d.created_at, d.updated_at, d.deleted_at
          FROM debts d
          JOIN customers c ON c.id = d.customer_id
          LEFT JOIN bills b ON b.id = d.bill_id
          WHERE d.uid = ?`,
  expenses: `SELECT e.uid, ec.uid AS category_uid, e.amount, e.method, e.note, e.created_at, e.updated_at, e.deleted_at
          FROM expenses e
          LEFT JOIN expense_categories ec ON ec.id = e.category_id
          WHERE e.uid = ?`,
  stock_moves: `SELECT s.uid, p.uid AS product_uid, s.qty, s.kind, s.note, s.created_at, s.updated_at
          FROM stock_moves s
          JOIN products p ON p.id = s.product_id
          WHERE s.uid = ?`,
  settings: 'SELECT key AS uid, value, updated_at FROM settings WHERE key = ?',
};

export interface OutboxEntry {
  seq: number;
  tbl: string;
  uid: string;
  deleted: number;
  ts: number;
}

/**
 * Outbox yozuvini serverga yuboriladigan o'zgarishga aylantiradi. Qator topilmasa
 * (o'chirilgan bo'lsa) — o'chirish belgisi, vaqti outbox'dagi `ts`.
 */
export async function serialize(db: Db, e: OutboxEntry): Promise<SyncChange | null> {
  if (!isSyncTable(e.tbl)) return null;
  const row = e.deleted ? null : await db.getFirstAsync<Record<string, BindValue>>(SELECT[e.tbl], [e.uid]);
  if (!row) return { tbl: e.tbl, uid: e.uid, updatedAt: Math.max(e.ts, 1), deleted: true, data: {} };
  const { uid, updated_at, ...data } = row;
  return { tbl: e.tbl, uid: String(uid), updatedAt: Number(updated_at) || 0, deleted: false, data };
}
