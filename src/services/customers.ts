import type { CustomerRow, PaymentMethod } from '@/db/models';
import { NEW_UID, type Db } from '@/db/types';

export class CustomerError extends Error {}

export interface CustomerWithBalance extends CustomerRow {
  /** Musbat — mijoz qarzdor; manfiy — mijoz ortiqcha to'lagan. */
  balance: number;
  last_activity_at: number | null;
}

const BALANCE_SQL = `
  COALESCE((SELECT SUM(amount) FROM debts d WHERE d.customer_id = c.id AND d.deleted_at IS NULL), 0)
  - COALESCE((SELECT SUM(amount) FROM payments p
              WHERE p.customer_id = c.id AND p.kind = 'debt_repayment' AND p.deleted_at IS NULL), 0)`;

export async function listCustomers(db: Db, search = ''): Promise<CustomerWithBalance[]> {
  const q = `%${search.trim()}%`;
  return db.getAllAsync<CustomerWithBalance>(
    `SELECT c.*, (${BALANCE_SQL}) AS balance,
       MAX(
         COALESCE((SELECT MAX(created_at) FROM debts WHERE customer_id = c.id AND deleted_at IS NULL), 0),
         COALESCE((SELECT MAX(created_at) FROM payments WHERE customer_id = c.id AND deleted_at IS NULL), 0)
       ) AS last_activity_at
     FROM customers c
     WHERE c.name LIKE ? OR COALESCE(c.phone, '') LIKE ?
     ORDER BY (balance > 0) DESC, balance DESC, c.name COLLATE NOCASE`,
    [q, q],
  );
}

export async function getCustomer(db: Db, id: number): Promise<CustomerWithBalance | null> {
  return db.getFirstAsync<CustomerWithBalance>(
    `SELECT c.*, (${BALANCE_SQL}) AS balance, NULL AS last_activity_at FROM customers c WHERE c.id = ?`,
    [id],
  );
}

export interface CustomerInput {
  id?: number;
  name: string;
  phone?: string | null;
  note?: string | null;
}

export async function saveCustomer(db: Db, input: CustomerInput, now: number): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new CustomerError('Mijoz ismini kiriting');
  const phone = input.phone?.trim() || null;
  const note = input.note?.trim() || null;
  if (input.id) {
    await db.runAsync('UPDATE customers SET name = ?, phone = ?, note = ?, updated_at = ? WHERE id = ?', [
      name,
      phone,
      note,
      now,
      input.id,
    ]);
    return input.id;
  }
  const res = await db.runAsync(
    `INSERT INTO customers (uid, name, phone, note, created_at, updated_at) VALUES (${NEW_UID}, ?, ?, ?, ?, ?)`,
    [name, phone, note, now, now],
  );
  return res.lastInsertRowId;
}

export interface LedgerEntry {
  type: 'debt' | 'payment';
  id: number;
  amount: number;
  note: string | null;
  bill_id: number | null;
  method: PaymentMethod | null;
  created_at: number;
}

/** Qarz daftaridagi mijoz tarixi: qarzlar va to'lovlar, yangilari birinchi. */
export async function getLedger(db: Db, customerId: number): Promise<LedgerEntry[]> {
  return db.getAllAsync<LedgerEntry>(
    `SELECT 'debt' AS type, id, amount, note, bill_id, NULL AS method, created_at FROM debts
       WHERE customer_id = ? AND deleted_at IS NULL
     UNION ALL
     SELECT 'payment' AS type, id, amount, note, bill_id, method, created_at FROM payments
       WHERE customer_id = ? AND kind = 'debt_repayment' AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    [customerId, customerId],
  );
}

export async function addManualDebt(db: Db, customerId: number, amount: number, note: string, now: number): Promise<void> {
  if (amount <= 0) throw new CustomerError('Summani kiriting');
  await db.runAsync(
    `INSERT INTO debts (uid, customer_id, amount, note, created_at, updated_at) VALUES (${NEW_UID}, ?, ?, ?, ?, ?)`,
    [customerId, amount, note.trim() || null, now, now],
  );
}

export async function repayDebt(
  db: Db,
  customerId: number,
  amount: number,
  method: PaymentMethod,
  note: string,
  now: number,
): Promise<void> {
  if (amount <= 0) throw new CustomerError('Summani kiriting');
  await db.runAsync(
    `INSERT INTO payments (uid, customer_id, amount, method, kind, note, created_at, updated_at)
     VALUES (${NEW_UID}, ?, ?, ?, 'debt_repayment', ?, ?, ?)`,
    [customerId, amount, method, note.trim() || null, now, now],
  );
}

/**
 * Xato kiritilgan yozuvni o'chirish. Chekdan kelgan qarzni bu yerda o'chirib bo'lmaydi —
 * buning uchun chekning o'zi bekor qilinadi. Yozuv o'chirilgan deb belgilanadi, shunda
 * o'chirish boshqa telefonga ham zaxira fayli orqali yetib boradi.
 */
export async function deleteLedgerEntry(
  db: Db,
  entry: Pick<LedgerEntry, 'type' | 'id' | 'bill_id'>,
  now = Date.now(),
): Promise<void> {
  if (entry.type === 'debt') {
    if (entry.bill_id != null) throw new CustomerError("Bu qarz chekdan yozilgan. Chekni bekor qiling");
    await db.runAsync('UPDATE debts SET deleted_at = ?, updated_at = ? WHERE id = ? AND bill_id IS NULL', [
      now,
      now,
      entry.id,
    ]);
  } else {
    await db.runAsync(
      "UPDATE payments SET deleted_at = ?, updated_at = ? WHERE id = ? AND kind = 'debt_repayment'",
      [now, now, entry.id],
    );
  }
}

export async function totalOutstanding(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE((SELECT SUM(amount) FROM debts WHERE deleted_at IS NULL), 0)
       - COALESCE((SELECT SUM(amount) FROM payments WHERE kind = 'debt_repayment' AND deleted_at IS NULL), 0) AS v`,
    [],
  );
  return row?.v ?? 0;
}
