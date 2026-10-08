import type { ExpenseCategoryRow, PaymentMethod, ProductRow, TableKind, TableRow } from '@/db/models';
import { NEW_UID, transaction, type Db, type RootDb } from '@/db/types';

export class CatalogError extends Error {}

// ---------- Stollar ----------

export async function listTables(db: Db, includeInactive = false): Promise<TableRow[]> {
  return db.getAllAsync<TableRow>(
    `SELECT * FROM tables ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY is_active DESC, sort_order, id`,
    [],
  );
}

export interface TableInput {
  id?: number;
  name: string;
  hourly_rate: number;
  kind?: TableKind;
}

export async function saveTable(db: Db, input: TableInput, now = Date.now()): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new CatalogError('Stol nomini kiriting');
  if (input.hourly_rate <= 0) throw new CatalogError('Soatlik narxni kiriting');
  if (input.id) {
    await db.runAsync('UPDATE tables SET name = ?, hourly_rate = ?, kind = COALESCE(?, kind), updated_at = ? WHERE id = ?', [
      name,
      input.hourly_rate,
      input.kind ?? null,
      now,
      input.id,
    ]);
    return input.id;
  }
  const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM tables', []);
  const res = await db.runAsync(
    `INSERT INTO tables (uid, name, hourly_rate, sort_order, kind, updated_at) VALUES (${NEW_UID}, ?, ?, ?, ?, ?)`,
    [name, input.hourly_rate, (max?.m ?? 0) + 1, input.kind ?? 'billiard', now],
  );
  return res.lastInsertRowId;
}

/** Stolni zaldan olib tashlash yoki qaytarish. Tarix (cheklar) saqlanib qoladi. */
export async function setTableActive(db: Db, id: number, active: boolean, now = Date.now()): Promise<void> {
  if (!active) {
    const open = await db.getFirstAsync<{ id: number }>("SELECT id FROM bills WHERE table_id = ? AND status = 'open'", [id]);
    if (open) throw new CatalogError("Stolda ochiq seans bor, avval uni yoping");
  }
  await db.runAsync('UPDATE tables SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, now, id]);
}

// ---------- Mahsulotlar ----------

/**
 * Ombordagi qoldiq: kirim va sanoq harakatlari minus bekor qilinmagan cheklarda sotilgani.
 * Qoldiq saqlanmaydi, har safar hisoblanadi — ikki telefon ma'lumoti birlashtirilganda ham to'g'ri chiqadi.
 */
const STOCK_SQL = `(
  COALESCE((SELECT SUM(m.qty) FROM stock_moves m WHERE m.product_id = p.id), 0)
  - COALESCE((SELECT SUM(i.qty) FROM bill_items i JOIN bills b ON b.id = i.bill_id
              WHERE i.product_id = p.id AND b.status != 'cancelled'), 0)
)`;

export async function listProducts(db: Db, includeInactive = false): Promise<ProductRow[]> {
  return db.getAllAsync<ProductRow>(
    `SELECT p.*, ${STOCK_SQL} AS stock_qty FROM products p
     ${includeInactive ? '' : 'WHERE p.is_active = 1'} ORDER BY p.is_active DESC, p.category, p.name`,
    [],
  );
}

export async function getStock(db: Db, productId: number): Promise<number> {
  const row = await db.getFirstAsync<{ stock: number }>(`SELECT ${STOCK_SQL} AS stock FROM products p WHERE p.id = ?`, [
    productId,
  ]);
  return row?.stock ?? 0;
}

export interface ProductInput {
  id?: number;
  name: string;
  category: string;
  price: number;
  track_stock: boolean;
}

export async function saveProduct(db: Db, input: ProductInput, now = Date.now()): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new CatalogError('Mahsulot nomini kiriting');
  if (input.price <= 0) throw new CatalogError('Narxni kiriting');
  const params = [name, input.category.trim(), input.price, input.track_stock ? 1 : 0, now];
  if (input.id) {
    await db.runAsync(
      'UPDATE products SET name = ?, category = ?, price = ?, track_stock = ?, updated_at = ? WHERE id = ?',
      [...params, input.id],
    );
    return input.id;
  }
  const res = await db.runAsync(
    `INSERT INTO products (uid, name, category, price, track_stock, updated_at) VALUES (${NEW_UID}, ?, ?, ?, ?, ?)`,
    params,
  );
  return res.lastInsertRowId;
}

export async function setProductActive(db: Db, id: number, active: boolean, now = Date.now()): Promise<void> {
  await db.runAsync('UPDATE products SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, now, id]);
}

export interface RestockInput {
  productId: number;
  qty: number;
  /** Xarid uchun to'langan jami summa. 0 bo'lsa xarajat yozilmaydi. */
  totalCost: number;
  method: PaymentMethod;
  now: number;
}

/** Omborga kirim. Xarid summasi berilsa "Mahsulot xaridi" xarajati ham yoziladi. */
export async function restockProduct(db: RootDb, input: RestockInput): Promise<void> {
  if (input.qty <= 0) throw new CatalogError('Miqdorni kiriting');
  await transaction(db, async (txn) => {
    const product = await txn.getFirstAsync<{ name: string; track_stock: number }>(
      'SELECT name, track_stock FROM products WHERE id = ?',
      [input.productId],
    );
    if (!product) throw new CatalogError('Mahsulot topilmadi');
    await txn.runAsync(
      `INSERT INTO stock_moves (uid, product_id, qty, kind, created_at) VALUES (${NEW_UID}, ?, ?, 'restock', ?)`,
      [input.productId, input.qty, input.now],
    );
    if (!product.track_stock) {
      await txn.runAsync('UPDATE products SET track_stock = 1, updated_at = ? WHERE id = ?', [input.now, input.productId]);
    }
    if (input.totalCost > 0) {
      const category = await getOrCreateExpenseCategory(txn, 'Mahsulot xaridi', input.now);
      await txn.runAsync(
        `INSERT INTO expenses (uid, category_id, amount, method, note, created_at, updated_at)
         VALUES (${NEW_UID}, ?, ?, ?, ?, ?, ?)`,
        [category, input.totalCost, input.method, `${product.name} × ${input.qty}`, input.now, input.now],
      );
    }
  });
}

/** Sanoqdan keyin qoldiqni to'g'rilash: farq alohida harakat sifatida yoziladi. */
export async function setStock(db: RootDb, productId: number, counted: number, now = Date.now()): Promise<void> {
  if (counted < 0) throw new CatalogError("Miqdor manfiy bo'lishi mumkin emas");
  await transaction(db, async (txn) => {
    const delta = counted - (await getStock(txn, productId));
    if (delta !== 0) {
      await txn.runAsync(
        `INSERT INTO stock_moves (uid, product_id, qty, kind, note, created_at) VALUES (${NEW_UID}, ?, ?, 'adjust', 'Sanoq', ?)`,
        [productId, delta, now],
      );
    }
    await txn.runAsync('UPDATE products SET track_stock = 1, updated_at = ? WHERE id = ? AND track_stock = 0', [
      now,
      productId,
    ]);
  });
}

// ---------- Xarajat turlari ----------

export async function listExpenseCategories(db: Db, includeInactive = false): Promise<ExpenseCategoryRow[]> {
  return db.getAllAsync<ExpenseCategoryRow>(
    `SELECT * FROM expense_categories ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY is_active DESC, id`,
    [],
  );
}

export async function saveExpenseCategory(db: Db, input: { id?: number; name: string }, now = Date.now()): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new CatalogError('Nomini kiriting');
  if (input.id) {
    await db.runAsync('UPDATE expense_categories SET name = ?, updated_at = ? WHERE id = ?', [name, now, input.id]);
    return input.id;
  }
  const res = await db.runAsync(
    `INSERT INTO expense_categories (uid, name, updated_at) VALUES (${NEW_UID}, ?, ?)`,
    [name, now],
  );
  return res.lastInsertRowId;
}

export async function setExpenseCategoryActive(db: Db, id: number, active: boolean, now = Date.now()): Promise<void> {
  await db.runAsync('UPDATE expense_categories SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, now, id]);
}

async function getOrCreateExpenseCategory(db: Db, name: string, now: number): Promise<number> {
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM expense_categories WHERE name = ?', [name]);
  if (row) return row.id;
  return saveExpenseCategory(db, { name }, now);
}
