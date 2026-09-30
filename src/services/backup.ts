import { transaction, type BindValue, type Db, type RootDb } from '@/db/types';

/**
 * Zaxira fayli ikki telefon (egasi va sherigi) o'rtasida ma'lumot almashish uchun ham ishlatiladi.
 * Shuning uchun fayldagi yozuvlar lokal `id` bilan emas, global `uid` bilan bog'lanadi, import esa
 * mavjud ma'lumotlarni o'chirmaydi — birlashtiradi:
 *  - yangi `uid` → qo'shiladi;
 *  - mavjud `uid` → qaysi nusxa keyinroq o'zgargan bo'lsa (`updated_at`), o'sha qoladi;
 *  - stol, mahsulot, xarajat turi va mijoz `uid` bo'yicha topilmasa, nomi bo'yicha moslanadi
 *    (ikkala telefonda alohida yaratilgan "Stol 1" bitta stol bo'lib qoladi).
 * Ochiq (hali yopilmagan) hisoblar faylga kirmaydi — ular faqat shu telefonda yopiladi.
 */

export class BackupError extends Error {}

export const BACKUP_FORMAT = 2;

type Rec = Record<string, BindValue>;

export interface BackupFile {
  /** Fayl belgisi. Ilova GreenTable deb nomlanishidan oldingi nom — mos kelishi uchun o'zgartirilmaydi. */
  app: 'biliard-pos';
  format: number;
  exportedAt: number;
  /** Faylga kirgan o'zgarishlar davri; `null` — butun tarix. */
  period: { from: number; to: number } | null;
  tables: Rec[];
  products: Rec[];
  expenseCategories: Rec[];
  customers: Rec[];
  bills: Rec[];
  billItems: Rec[];
  payments: Rec[];
  debts: Rec[];
  expenses: Rec[];
  stockMoves: Rec[];
}

const SECTIONS = [
  'tables',
  'products',
  'expenseCategories',
  'customers',
  'bills',
  'billItems',
  'payments',
  'debts',
  'expenses',
  'stockMoves',
] as const;
type Section = (typeof SECTIONS)[number];

// ---------- Eksport ----------

/**
 * Katalog (stollar, mahsulotlar, xarajat turlari, mijozlar) har doim to'liq yoziladi — u kichik.
 * Cheklar, to'lovlar, qarzlar, xarajatlar va ombor harakatlaridan esa faqat davr ichida
 * yaratilgan yoki o'zgargani olinadi (masalan kechagi chekni bugun bekor qilish ham bugungi faylga tushadi).
 */
export async function exportData(
  db: Db,
  now: number,
  period: { from: number; to: number } | null = null,
): Promise<BackupFile> {
  const range = [period?.from ?? 0, period?.to ?? Number.MAX_SAFE_INTEGER];
  const all = (sql: string, params: BindValue[] = []) => db.getAllAsync<Rec>(sql, params);
  return {
    app: 'biliard-pos',
    format: BACKUP_FORMAT,
    exportedAt: now,
    period,
    tables: await all('SELECT uid, name, hourly_rate, is_active, sort_order, updated_at FROM tables ORDER BY id'),
    products: await all('SELECT uid, name, category, price, track_stock, is_active, updated_at FROM products ORDER BY id'),
    expenseCategories: await all('SELECT uid, name, is_active, updated_at FROM expense_categories ORDER BY id'),
    customers: await all('SELECT uid, name, phone, note, created_at, updated_at FROM customers ORDER BY id'),
    bills: await all(
      `SELECT b.uid, b.kind, t.uid AS table_uid, c.uid AS customer_uid, b.label, b.status, b.started_at, b.ended_at,
         b.paused_ms, b.carried_ms, b.carried_amount, b.hourly_rate, b.time_minutes, b.time_amount, b.items_amount,
         b.discount, b.rounding_adj, b.total, b.paid_amount, b.debt_amount, b.closed_at, b.cancel_reason, b.updated_at
       FROM bills b
       LEFT JOIN tables t ON t.id = b.table_id
       LEFT JOIN customers c ON c.id = b.customer_id
       WHERE b.status != 'open' AND b.updated_at >= ? AND b.updated_at < ?
       ORDER BY b.id`,
      range,
    ),
    billItems: await all(
      `SELECT i.uid, b.uid AS bill_uid, p.uid AS product_uid, i.name, i.qty, i.unit_price, i.created_at
       FROM bill_items i
       JOIN bills b ON b.id = i.bill_id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE b.status != 'open' AND b.updated_at >= ? AND b.updated_at < ?
       ORDER BY i.id`,
      range,
    ),
    payments: await all(
      `SELECT pm.uid, b.uid AS bill_uid, c.uid AS customer_uid, pm.amount, pm.method, pm.kind, pm.note,
         pm.created_at, pm.updated_at, pm.deleted_at
       FROM payments pm
       LEFT JOIN bills b ON b.id = pm.bill_id
       LEFT JOIN customers c ON c.id = pm.customer_id
       WHERE pm.updated_at >= ? AND pm.updated_at < ?
       ORDER BY pm.id`,
      range,
    ),
    debts: await all(
      `SELECT d.uid, b.uid AS bill_uid, c.uid AS customer_uid, d.amount, d.note, d.created_at, d.updated_at, d.deleted_at
       FROM debts d
       JOIN customers c ON c.id = d.customer_id
       LEFT JOIN bills b ON b.id = d.bill_id
       WHERE d.updated_at >= ? AND d.updated_at < ?
       ORDER BY d.id`,
      range,
    ),
    expenses: await all(
      `SELECT e.uid, ec.uid AS category_uid, e.amount, e.method, e.note, e.created_at, e.updated_at, e.deleted_at
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.updated_at >= ? AND e.updated_at < ?
       ORDER BY e.id`,
      range,
    ),
    stockMoves: await all(
      `SELECT m.uid, p.uid AS product_uid, m.qty, m.kind, m.note, m.created_at
       FROM stock_moves m JOIN products p ON p.id = m.product_id
       WHERE m.created_at >= ? AND m.created_at < ?
       ORDER BY m.id`,
      range,
    ),
  };
}

/** Zaxiraga kirmaydigan ochiq hisoblar soni (eksportdan oldin ogohlantirish uchun). */
export async function countOpenBills(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM bills WHERE status = 'open'", []);
  return row?.n ?? 0;
}

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError("Fayl o'qilmadi: zaxira fayli emas");
  }
  const file = data as Partial<BackupFile> & { schemaVersion?: number };
  if (file?.app !== 'biliard-pos') throw new BackupError('Bu fayl GreenTable zaxira nusxasi emas');
  if (file.format !== BACKUP_FORMAT) {
    throw new BackupError(
      (file.format ?? 0) > BACKUP_FORMAT
        ? 'Zaxira ilovaning yangiroq versiyasida olingan. Avval ilovani yangilang'
        : "Zaxira ilovaning eski versiyasida olingan va birlashtirib bo'lmaydi",
    );
  }
  for (const s of SECTIONS) {
    if (file[s] != null && !Array.isArray(file[s])) throw new BackupError('Zaxira fayli buzilgan');
    (file as Record<string, unknown>)[s] = file[s] ?? [];
  }
  return file as BackupFile;
}

// ---------- Import (birlashtirish) ----------

export type MergeCounts = Record<Exclude<Section, 'billItems'>, number>;

export interface MergeStats {
  added: MergeCounts;
  updated: MergeCounts;
}

const emptyCounts = (): MergeCounts => ({
  tables: 0,
  products: 0,
  expenseCategories: 0,
  customers: 0,
  bills: 0,
  payments: 0,
  debts: 0,
  expenses: 0,
  stockMoves: 0,
});

const num = (v: BindValue | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const str = (v: BindValue | undefined): string | null => (v == null || v === '' ? null : String(v));

interface Local {
  id: number;
  uid: string;
  updated_at: number;
}

export async function importData(db: RootDb, file: BackupFile): Promise<MergeStats> {
  return transaction(db, async (txn) => {
    const stats: MergeStats = { added: emptyCounts(), updated: emptyCounts() };
    const ids: Record<string, Map<string, number | null>> = {};

    /** uid → lokal id (avval shu importda moslangan, bo'lmasa bazadan). */
    const resolve = async (table: string, uid: BindValue | undefined): Promise<number | null> => {
      const key = str(uid);
      if (!key) return null;
      const cache = (ids[table] ??= new Map());
      if (!cache.has(key)) {
        const row = await txn.getFirstAsync<{ id: number }>(`SELECT id FROM ${table} WHERE uid = ?`, [key]);
        cache.set(key, row?.id ?? null);
      }
      return cache.get(key) ?? null;
    };
    const remember = (table: string, uid: BindValue | undefined, id: number) => {
      const key = str(uid);
      if (key) (ids[table] ??= new Map()).set(key, id);
    };
    const byUid = (table: string, uid: BindValue | undefined) =>
      txn.getFirstAsync<Local>(`SELECT id, uid, updated_at FROM ${table} WHERE uid = ?`, [str(uid)]);
    const exists = async (table: string, uid: BindValue | undefined) =>
      (await txn.getFirstAsync<{ id: number }>(`SELECT id FROM ${table} WHERE uid = ?`, [str(uid)])) != null;

    /**
     * Katalog yozuvi: uid bo'yicha, topilmasa nomi bo'yicha moslanadi.
     * `fields` — ustun nomi → fayldagi qiymat.
     */
    const mergeCatalog = async (
      table: string,
      section: keyof MergeCounts,
      rec: Rec,
      fields: Record<string, BindValue>,
      natural: { sql: string; params: BindValue[] },
      updateSql?: string,
    ) => {
      if (!str(rec.uid)) return;
      let local = await byUid(table, rec.uid);
      if (!local) {
        local = await txn.getFirstAsync<Local>(natural.sql, natural.params);
        // Nomi bo'yicha moslangan yozuvlar ikkala telefonda bir xil uid'ga o'tadi (kichigi tanlanadi),
        // shunda keyingi almashuvlarda qayta nomlash ham to'g'ri yetib boradi.
        const incoming = str(rec.uid);
        if (local && incoming && incoming < local.uid) {
          await txn.runAsync(`UPDATE ${table} SET uid = ? WHERE id = ?`, [incoming, local.id]);
        }
      }
      const cols = Object.keys(fields);
      if (!local) {
        const res = await txn.runAsync(
          `INSERT INTO ${table} (uid, ${cols.join(', ')}, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`,
          [str(rec.uid), ...cols.map((c) => fields[c]), num(rec.updated_at)],
        );
        stats.added[section]++;
        remember(table, rec.uid, res.lastInsertRowId);
        return;
      }
      if (num(rec.updated_at) > local.updated_at) {
        await txn.runAsync(
          updateSql ?? `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          [...cols.map((c) => fields[c]), num(rec.updated_at), local.id],
        );
        stats.updated[section]++;
      }
      remember(table, rec.uid, local.id);
    };

    const byName = (table: string, name: BindValue) => ({
      sql: `SELECT id, uid, updated_at FROM ${table} WHERE lower(trim(name)) = lower(trim(?)) ORDER BY is_active DESC, id LIMIT 1`,
      params: [str(name) ?? ''],
    });

    for (const r of file.tables) {
      await mergeCatalog(
        'tables',
        'tables',
        r,
        { name: str(r.name) ?? 'Stol', hourly_rate: num(r.hourly_rate), is_active: num(r.is_active), sort_order: num(r.sort_order) },
        byName('tables', r.name),
      );
    }
    for (const r of file.products) {
      await mergeCatalog(
        'products',
        'products',
        r,
        {
          name: str(r.name) ?? 'Mahsulot',
          category: str(r.category) ?? '',
          price: num(r.price),
          track_stock: num(r.track_stock),
          is_active: num(r.is_active),
        },
        byName('products', r.name),
      );
    }
    for (const r of file.expenseCategories) {
      await mergeCatalog(
        'expense_categories',
        'expenseCategories',
        r,
        { name: str(r.name) ?? 'Boshqa', is_active: num(r.is_active) },
        byName('expense_categories', r.name),
      );
    }
    for (const r of file.customers) {
      const phone = str(r.phone);
      await mergeCatalog(
        'customers',
        'customers',
        r,
        { name: str(r.name) ?? 'Mijoz', phone, note: str(r.note), created_at: num(r.created_at) },
        {
          // Ism bir xil va telefonlar bir-biriga zid emas — bitta odam deb hisoblanadi.
          sql: `SELECT id, uid, updated_at FROM customers
                WHERE lower(trim(name)) = lower(trim(?)) AND (phone IS NULL OR ? IS NULL OR phone = ?)
                ORDER BY id LIMIT 1`,
          params: [str(r.name) ?? '', phone, phone],
        },
        // Bo'sh telefon/izoh mavjud qiymatni o'chirib yubormasin.
        `UPDATE customers SET name = ?, phone = COALESCE(?, phone), note = COALESCE(?, note), created_at = MIN(created_at, ?),
           updated_at = ? WHERE id = ?`,
      );
    }

    for (const r of file.bills) {
      if (!str(r.uid) || (r.status !== 'closed' && r.status !== 'cancelled')) continue;
      const fields: Record<string, BindValue> = {
        table_id: await resolve('tables', r.table_uid),
        customer_id: await resolve('customers', r.customer_uid),
        label: str(r.label),
        status: r.status,
        started_at: num(r.started_at),
        ended_at: r.ended_at == null ? null : num(r.ended_at),
        paused_ms: num(r.paused_ms),
        carried_ms: num(r.carried_ms),
        carried_amount: num(r.carried_amount),
        hourly_rate: num(r.hourly_rate),
        time_minutes: num(r.time_minutes),
        time_amount: num(r.time_amount),
        items_amount: num(r.items_amount),
        discount: num(r.discount),
        rounding_adj: num(r.rounding_adj),
        total: num(r.total),
        paid_amount: num(r.paid_amount),
        debt_amount: num(r.debt_amount),
        closed_at: r.closed_at == null ? null : num(r.closed_at),
        cancel_reason: str(r.cancel_reason),
      };
      const local = await byUid('bills', r.uid);
      const cols = Object.keys(fields);
      if (!local) {
        const res = await txn.runAsync(
          `INSERT INTO bills (uid, kind, ${cols.join(', ')}, updated_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)`,
          [str(r.uid), r.kind === 'table' ? 'table' : 'sale', ...cols.map((c) => fields[c]), num(r.updated_at)],
        );
        stats.added.bills++;
        remember('bills', r.uid, res.lastInsertRowId);
      } else {
        if (num(r.updated_at) > local.updated_at) {
          await txn.runAsync(
            `UPDATE bills SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
            [...cols.map((c) => fields[c]), num(r.updated_at), local.id],
          );
          stats.updated.bills++;
        }
        remember('bills', r.uid, local.id);
      }
    }

    // Yopilgan chekning mahsulotlari o'zgarmaydi — faqat yangilari qo'shiladi.
    for (const r of file.billItems) {
      if (!str(r.uid) || (await exists('bill_items', r.uid))) continue;
      const billId = await resolve('bills', r.bill_uid);
      if (billId == null) continue;
      await txn.runAsync(
        'INSERT INTO bill_items (uid, bill_id, product_id, name, qty, unit_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          str(r.uid),
          billId,
          await resolve('products', r.product_uid),
          str(r.name) ?? '',
          num(r.qty),
          num(r.unit_price),
          num(r.created_at),
        ],
      );
    }

    /** To'lov, qarz, xarajat: yangisi qo'shiladi, mavjudida keyingi o'zgarish (masalan o'chirish) olinadi. */
    const mergeRecord = async (table: string, section: keyof MergeCounts, r: Rec, fields: Record<string, BindValue>) => {
      if (!str(r.uid)) return;
      const local = await byUid(table, r.uid);
      const cols = Object.keys(fields);
      const values = cols.map((c) => fields[c]);
      if (!local) {
        await txn.runAsync(
          `INSERT INTO ${table} (uid, ${cols.join(', ')}, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`,
          [str(r.uid), ...values, num(r.updated_at)],
        );
        stats.added[section]++;
      } else if (num(r.updated_at) > local.updated_at) {
        await txn.runAsync(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [
          ...values,
          num(r.updated_at),
          local.id,
        ]);
        stats.updated[section]++;
      }
    };

    for (const r of file.payments) {
      await mergeRecord('payments', 'payments', r, {
        bill_id: await resolve('bills', r.bill_uid),
        customer_id: await resolve('customers', r.customer_uid),
        amount: num(r.amount),
        method: r.method === 'card' || r.method === 'transfer' ? r.method : 'cash',
        kind: r.kind === 'debt_repayment' ? 'debt_repayment' : 'bill',
        note: str(r.note),
        created_at: num(r.created_at),
        deleted_at: r.deleted_at == null ? null : num(r.deleted_at),
      });
    }
    for (const r of file.debts) {
      const customerId = await resolve('customers', r.customer_uid);
      if (customerId == null) continue;
      await mergeRecord('debts', 'debts', r, {
        customer_id: customerId,
        bill_id: await resolve('bills', r.bill_uid),
        amount: num(r.amount),
        note: str(r.note),
        created_at: num(r.created_at),
        deleted_at: r.deleted_at == null ? null : num(r.deleted_at),
      });
    }
    for (const r of file.expenses) {
      await mergeRecord('expenses', 'expenses', r, {
        category_id: await resolve('expense_categories', r.category_uid),
        amount: num(r.amount),
        method: r.method === 'card' || r.method === 'transfer' ? r.method : 'cash',
        note: str(r.note),
        created_at: num(r.created_at),
        deleted_at: r.deleted_at == null ? null : num(r.deleted_at),
      });
    }
    for (const r of file.stockMoves) {
      if (!str(r.uid) || (await exists('stock_moves', r.uid))) continue;
      const productId = await resolve('products', r.product_uid);
      if (productId == null) continue;
      await txn.runAsync(
        'INSERT INTO stock_moves (uid, product_id, qty, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [str(r.uid), productId, num(r.qty), r.kind === 'restock' ? 'restock' : 'adjust', str(r.note), num(r.created_at)],
      );
      stats.added.stockMoves++;
    }

    return stats;
  });
}

// ---------- Tarixni tozalash ----------

export interface ClearOptions {
  /** Stollar, mahsulotlar va xarajat turlarini ham o'chirish. Sozlamalar va PIN saqlanadi. */
  includeCatalog: boolean;
}

/** Barcha cheklar, to'lovlar, qarzlar, mijozlar, xarajatlar va ombor harakatlarini o'chiradi. */
export async function clearHistory(db: RootDb, { includeCatalog }: ClearOptions): Promise<void> {
  await transaction(db, async (txn) => {
    for (const table of ['bill_items', 'payments', 'debts', 'expenses', 'stock_moves', 'bills', 'customers']) {
      await txn.runAsync(`DELETE FROM ${table}`, []);
    }
    if (includeCatalog) {
      for (const table of ['tables', 'products', 'expense_categories']) {
        await txn.runAsync(`DELETE FROM ${table}`, []);
      }
    }
  });
}
