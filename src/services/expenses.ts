import type { PaymentMethod } from '@/db/models';
import { NEW_UID, type Db } from '@/db/types';

export class ExpenseError extends Error {}

export interface ExpenseInput {
  categoryId: number | null;
  amount: number;
  method: PaymentMethod;
  note: string;
  now: number;
}

export async function addExpense(db: Db, input: ExpenseInput): Promise<number> {
  if (input.amount <= 0) throw new ExpenseError('Summani kiriting');
  const res = await db.runAsync(
    `INSERT INTO expenses (uid, category_id, amount, method, note, created_at, updated_at)
     VALUES (${NEW_UID}, ?, ?, ?, ?, ?, ?)`,
    [input.categoryId, input.amount, input.method, input.note.trim() || null, input.now, input.now],
  );
  return res.lastInsertRowId;
}

export interface ExpenseListItem {
  id: number;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  created_at: number;
  category_name: string | null;
}

export async function listExpenses(db: Db, from: number, to: number): Promise<ExpenseListItem[]> {
  return db.getAllAsync<ExpenseListItem>(
    `SELECT e.id, e.amount, e.method, e.note, e.created_at, c.name AS category_name
     FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NULL AND e.created_at >= ? AND e.created_at < ?
     ORDER BY e.created_at DESC`,
    [from, to],
  );
}

/** Xarajat o'chirilgan deb belgilanadi (zaxira orqali boshqa telefonda ham o'chadi). */
export async function deleteExpense(db: Db, id: number, now = Date.now()): Promise<void> {
  await db.runAsync('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
}
