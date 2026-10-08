import { NEW_UID, type Db } from './types';

/** Namunaviy ma'lumotlar. O'zgartirmang: migratsiya 2 ularga id bo'yicha doimiy uid beradi. */
const SEED_TABLES = 4;
const SEED_PRODUCTS: [string, string, number][] = [
  ['Choy', 'Ichimliklar', 5000],
  ['Kofe', 'Ichimliklar', 10000],
  ['Suv 0.5 L', 'Ichimliklar', 5000],
  ['Coca-Cola 0.5 L', 'Ichimliklar', 10000],
];
const SEED_EXPENSE_CATEGORIES = ['Ijara', 'Kommunal', 'Maosh', 'Mahsulot xaridi', "Ta'mirlash", 'Boshqa'];

/** Sinxronlanadigan jadvallar: [nomi, global kalit ustuni, lokal kalit ustuni]. */
export const SYNC_TABLES: [string, string, string][] = [
  ['tables', 'uid', 'id'],
  ['products', 'uid', 'id'],
  ['expense_categories', 'uid', 'id'],
  ['customers', 'uid', 'id'],
  ['bills', 'uid', 'id'],
  ['bill_items', 'uid', 'id'],
  ['payments', 'uid', 'id'],
  ['debts', 'uid', 'id'],
  ['expenses', 'uid', 'id'],
  ['stock_moves', 'uid', 'id'],
  ['settings', 'key', 'key'],
];

const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const NOT_APPLYING = '(SELECT applying FROM sync_state WHERE id = 1) = 0';

/**
 * Qurilmadagi har bir o'zgarishni outbox'ga yozadi. `updated_at` ni servis o'zgartirmagan bo'lsa
 * (yoki yangi qatorda 0 bo'lsa) trigger o'zi hozirgi vaqtga oshiradi — aks holda server o'zgarishni
 * eski deb rad etardi. `uid` o'zgarsa (nom bo'yicha moslashda) eski uid o'chirilgan deb yuboriladi.
 */
function syncTriggers([t, uid, pk]: [string, string, string]): string {
  // INSERT OR REPLACE o'rniga DELETE + INSERT: tashqi UPSERT (ON CONFLICT) trigger ichidagi REPLACE'ni bekor qiladi.
  const put = (val: string, deleted: 0 | 1) => `
    DELETE FROM sync_outbox WHERE tbl = '${t}' AND uid = ${val};
    INSERT INTO sync_outbox (tbl, uid, deleted, ts) VALUES ('${t}', ${val}, ${deleted}, ${NOW_MS});`;
  return `
  CREATE TRIGGER sync_${t}_ai AFTER INSERT ON ${t} WHEN ${NOT_APPLYING}
  BEGIN
    UPDATE ${t} SET updated_at = ${NOW_MS} WHERE ${pk} = NEW.${pk} AND NEW.updated_at = 0;${put(`NEW.${uid}`, 0)}
  END;
  CREATE TRIGGER sync_${t}_au AFTER UPDATE ON ${t} WHEN ${NOT_APPLYING}
  BEGIN
    UPDATE ${t} SET updated_at = MAX(OLD.updated_at + 1, ${NOW_MS})
      WHERE ${pk} = NEW.${pk} AND NEW.updated_at = OLD.updated_at;${put(`NEW.${uid}`, 0)}
    DELETE FROM sync_outbox WHERE tbl = '${t}' AND uid = OLD.${uid} AND OLD.${uid} IS NOT NEW.${uid};
    INSERT INTO sync_outbox (tbl, uid, deleted, ts)
      SELECT '${t}', OLD.${uid}, 1, ${NOW_MS} WHERE OLD.${uid} IS NOT NEW.${uid};
  END;
  CREATE TRIGGER sync_${t}_ad AFTER DELETE ON ${t} WHEN ${NOT_APPLYING}
  BEGIN${put(`OLD.${uid}`, 1)}
  END;`;
}

/**
 * Har bir migratsiya faqat oldinga yuradi. Yangi o'zgarish kerak bo'lsa,
 * massiv oxiriga yangi element qo'shiladi (eskilarini o'zgartirmang).
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hourly_rate INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    track_stock INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    note TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('table', 'sale')),
    table_id INTEGER REFERENCES tables(id),
    customer_id INTEGER REFERENCES customers(id),
    label TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    paused_at INTEGER,
    paused_ms INTEGER NOT NULL DEFAULT 0,
    carried_ms INTEGER NOT NULL DEFAULT 0,
    carried_amount INTEGER NOT NULL DEFAULT 0,
    hourly_rate INTEGER NOT NULL DEFAULT 0,
    time_minutes INTEGER NOT NULL DEFAULT 0,
    time_amount INTEGER NOT NULL DEFAULT 0,
    items_amount INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    rounding_adj INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    paid_amount INTEGER NOT NULL DEFAULT 0,
    debt_amount INTEGER NOT NULL DEFAULT 0,
    closed_at INTEGER,
    cancel_reason TEXT
  );
  CREATE INDEX idx_bills_status ON bills(status);
  CREATE INDEX idx_bills_closed_at ON bills(closed_at);
  CREATE INDEX idx_bills_customer ON bills(customer_id);
  -- Bitta stolda bir vaqtda faqat bitta ochiq seans bo'lishi mumkin.
  CREATE UNIQUE INDEX idx_bills_open_table ON bills(table_id)
    WHERE status = 'open' AND table_id IS NOT NULL;

  CREATE TABLE bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_bill_items_bill ON bill_items(bill_id);

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER REFERENCES bills(id),
    customer_id INTEGER REFERENCES customers(id),
    amount INTEGER NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'transfer')),
    kind TEXT NOT NULL CHECK (kind IN ('bill', 'debt_repayment')),
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_payments_created ON payments(created_at);
  CREATE INDEX idx_payments_customer ON payments(customer_id);

  CREATE TABLE debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    bill_id INTEGER REFERENCES bills(id),
    amount INTEGER NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_debts_customer ON debts(customer_id);

  CREATE TABLE expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES expense_categories(id),
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'card', 'transfer')),
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_expenses_created ON expenses(created_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,

  // 2: ikki qurilma o'rtasida birlashtirish uchun — har bir yozuvga global `uid`,
  // o'zgarish vaqti (`updated_at`), o'chirish belgisi (`deleted_at`) va ombor harakatlari.
  `
  -- Birinchi ishga tushirishda yaratilgan namunaviy stol/mahsulot/xarajat turlari har bir telefonda
  -- bir xil uid oladi: egasi ularni qayta nomlasa ham ikkinchi telefonda o'sha yozuv yangilanadi.
  ALTER TABLE tables ADD COLUMN uid TEXT;
  ALTER TABLE tables ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE tables SET uid = CASE WHEN id <= ${SEED_TABLES} THEN 'seed-table-' || id ELSE ${NEW_UID} END;
  CREATE UNIQUE INDEX idx_tables_uid ON tables(uid);

  ALTER TABLE products ADD COLUMN uid TEXT;
  ALTER TABLE products ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE products SET uid = CASE WHEN id <= ${SEED_PRODUCTS.length} THEN 'seed-product-' || id ELSE ${NEW_UID} END;
  CREATE UNIQUE INDEX idx_products_uid ON products(uid);

  ALTER TABLE customers ADD COLUMN uid TEXT;
  ALTER TABLE customers ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE customers SET uid = ${NEW_UID}, updated_at = created_at;
  CREATE UNIQUE INDEX idx_customers_uid ON customers(uid);

  ALTER TABLE expense_categories ADD COLUMN uid TEXT;
  ALTER TABLE expense_categories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE expense_categories
    SET uid = CASE WHEN id <= ${SEED_EXPENSE_CATEGORIES.length} THEN 'seed-category-' || id ELSE ${NEW_UID} END;
  CREATE UNIQUE INDEX idx_expense_categories_uid ON expense_categories(uid);

  ALTER TABLE bills ADD COLUMN uid TEXT;
  ALTER TABLE bills ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE bills SET uid = ${NEW_UID}, updated_at = COALESCE(closed_at, started_at);
  CREATE UNIQUE INDEX idx_bills_uid ON bills(uid);
  CREATE INDEX idx_bills_updated ON bills(updated_at);

  ALTER TABLE bill_items ADD COLUMN uid TEXT;
  UPDATE bill_items SET uid = ${NEW_UID};
  CREATE UNIQUE INDEX idx_bill_items_uid ON bill_items(uid);

  ALTER TABLE payments ADD COLUMN uid TEXT;
  ALTER TABLE payments ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE payments ADD COLUMN deleted_at INTEGER;
  UPDATE payments SET uid = ${NEW_UID}, updated_at = created_at;
  CREATE UNIQUE INDEX idx_payments_uid ON payments(uid);

  ALTER TABLE debts ADD COLUMN uid TEXT;
  ALTER TABLE debts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE debts ADD COLUMN deleted_at INTEGER;
  UPDATE debts SET uid = ${NEW_UID}, updated_at = created_at;
  CREATE UNIQUE INDEX idx_debts_uid ON debts(uid);

  ALTER TABLE expenses ADD COLUMN uid TEXT;
  ALTER TABLE expenses ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE expenses ADD COLUMN deleted_at INTEGER;
  UPDATE expenses SET uid = ${NEW_UID}, updated_at = created_at;
  CREATE UNIQUE INDEX idx_expenses_uid ON expenses(uid);

  -- Ombor qoldig'i endi hisoblanadi: kirim/sanoq harakatlari − sotilgan mahsulotlar.
  -- Shunda ikki telefondagi savdo birlashtirilganda qoldiq o'z-o'zidan to'g'ri chiqadi.
  CREATE TABLE stock_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('restock', 'adjust')),
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_stock_moves_uid ON stock_moves(uid);
  CREATE INDEX idx_stock_moves_product ON stock_moves(product_id);

  INSERT INTO stock_moves (uid, product_id, qty, kind, note, created_at)
  SELECT ${NEW_UID}, id, qty, 'adjust', 'Boshlang''ich qoldiq', CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM (
    SELECT p.id, p.stock_qty + COALESCE((
      SELECT SUM(i.qty) FROM bill_items i JOIN bills b ON b.id = i.bill_id
      WHERE i.product_id = p.id AND b.status != 'cancelled'
    ), 0) AS qty
    FROM products p WHERE p.track_stock = 1
  ) WHERE qty != 0;

  ALTER TABLE products DROP COLUMN stock_qty;
  `,

  // 3: server bilan sinxronlash. Har bir o'zgarish trigger orqali `sync_outbox` ga tushadi
  // (servislar tegilmaydi), `updated_at` esa har o'zgarishda o'zi oshadi — server "oxirgi yozuv yutadi"
  // qoidasi bilan solishtiradi. Serverdan kelgan yozuvlar `applying = 1` paytida qo'llanadi.
  `
  ALTER TABLE bill_items ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE bill_items SET updated_at = created_at;
  ALTER TABLE stock_moves ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
  UPDATE stock_moves SET updated_at = created_at;
  ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

  -- Ikki qurilma oflaynda bitta stolni ochishi mumkin: sinxronda ikkala hisob ham saqlanishi kerak.
  DROP INDEX idx_bills_open_table;
  CREATE INDEX idx_bills_open_table ON bills(table_id) WHERE status = 'open';

  CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_rev INTEGER NOT NULL DEFAULT 0,
    epoch INTEGER NOT NULL DEFAULT 0,
    hall_id TEXT,
    applying INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO sync_state (id) VALUES (1);

  CREATE TABLE sync_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl TEXT NOT NULL,
    uid TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL DEFAULT 0,
    UNIQUE (tbl, uid)
  );

  -- Ota yozuvi hali kelmagan qatorlar (masalan chek mahsuloti chekdan oldin kelsa) — keyin qayta qo'llanadi.
  CREATE TABLE sync_pending (
    tbl TEXT NOT NULL,
    uid TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (tbl, uid)
  );

  -- Faqat shu qurilmaga tegishli (sinxronlanmaydigan) qiymatlar: obuna holati keshi va h.k.
  CREATE TABLE local_kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  ${SYNC_TABLES.map(syncTriggers).join('\n')}

  ${SYNC_TABLES.map(([t, uid]) => `INSERT INTO sync_outbox (tbl, uid) SELECT '${t}', ${uid} FROM ${t};`).join('\n')}
  `,

  // 4: vaqtli seans (PS, kompyuter — oldindan belgilangan muddat) va joy turlari.
  `
  ALTER TABLE bills ADD COLUMN planned_minutes INTEGER;
  ALTER TABLE tables ADD COLUMN kind TEXT NOT NULL DEFAULT 'billiard';
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * `target` faqat testlar uchun: eski versiyadagi bazani yangilashni tekshirish.
 * `sample` — namunaviy stollar/mahsulotlar (v1 dagidek). Ilovada endi o'chirilgan: biliardxona
 * ma'lumoti serverdan keladi yoki egasi birinchi kirishda stollarni o'zi kiritadi.
 */
export async function migrate(db: Db, target = MIGRATIONS.length, opts: { sample?: boolean } = {}): Promise<void> {
  // Kutish vaqti birinchi: Expo Go ilovani qayta yuklaganda eski ulanish bir lahza bazani band qilib turishi mumkin.
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  const mode = await db.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode', []);
  if (mode?.journal_mode !== 'wal') await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (let v = current; v < target; v++) {
    try {
      await db.execAsync(`BEGIN; ${MIGRATIONS[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
    } catch (e) {
      await db.execAsync('ROLLBACK').catch(() => {});
      throw e;
    }
    if (v === 0 && opts.sample) await seed(db);
  }
}

/** Birinchi ishga tushirishdagi namunaviy ma'lumotlar. Egasi keyin o'zgartiradi. */
async function seed(db: Db): Promise<void> {
  for (let i = 1; i <= SEED_TABLES; i++) {
    await db.runAsync('INSERT INTO tables (name, hourly_rate, sort_order) VALUES (?, ?, ?)', [`Stol ${i}`, 30000, i]);
  }
  for (const [name, category, price] of SEED_PRODUCTS) {
    await db.runAsync('INSERT INTO products (name, category, price) VALUES (?, ?, ?)', [name, category, price]);
  }
  for (const name of SEED_EXPENSE_CATEGORIES) {
    await db.runAsync('INSERT INTO expense_categories (name) VALUES (?)', [name]);
  }
}
