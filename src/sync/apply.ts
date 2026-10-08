import type { SyncChange } from '../../server/src/contract';
import type { BindValue, Db } from '@/db/types';
import { TABLE_ORDER, isSyncTable, type SyncTable } from './codec';

type Rec = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const optNum = (v: unknown): number | null => (v == null ? null : num(v));
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const method = (v: unknown) => (v === 'card' || v === 'transfer' ? v : 'cash');

const SETTING_KEYS = new Set(['hall_name', 'rounding_step', 'rounding_mode', 'day_start_hour']);
const CATALOG = new Set<SyncTable>(['tables', 'products', 'expense_categories', 'customers']);

/** Ota yozuvi hali yo'q — qator keyinroq qayta qo'llanadi. */
class MissingParent extends Error {}

export interface ApplyOptions {
  /**
   * Birinchi sinxron: lokal ma'lumot serverdagi bilan nomi bo'yicha moslanadi (bir xil "Stol 1"
   * ikki marta paydo bo'lmasin). Keyingi sinxronlarda o'chiq — bir xil ismli ikki xil mijoz birlashmasin.
   */
  matchByName?: boolean;
}

export interface ApplyResult {
  applied: number;
  pending: number;
}

/**
 * Serverdan kelgan qatorlarni lokal bazaga qo'llaydi. Chaqiruvchi tranzaksiya ichida va
 * `sync_state.applying = 1` holatida chaqiradi (triggerlar outbox'ga yozmasligi uchun).
 */
export async function applyChanges(txn: Db, rows: SyncChange[], opts: ApplyOptions = {}): Promise<ApplyResult> {
  const ids = new Map<string, number | null>();

  /** uid → lokal id; uid bo'sh bo'lsa null, topilmasa — MissingParent. */
  const ref = async (table: SyncTable, uid: unknown): Promise<number | null> => {
    const key = str(uid);
    if (!key) return null;
    const cacheKey = `${table}:${key}`;
    if (!ids.has(cacheKey)) {
      const row = await txn.getFirstAsync<{ id: number }>(`SELECT id FROM ${table} WHERE uid = ?`, [key]);
      ids.set(cacheKey, row?.id ?? null);
    }
    const id = ids.get(cacheKey);
    if (id == null) throw new MissingParent(`${table}:${key}`);
    return id;
  };

  /** Majburiy havola: uid bo'lmasa ham ota yo'q deb hisoblanadi. */
  const need = async (table: SyncTable, uid: unknown): Promise<number> => {
    if (!str(uid)) throw new MissingParent(table);
    return (await ref(table, uid))!;
  };

  const fieldsFor = async (tbl: SyncTable, d: Rec): Promise<Record<string, BindValue>> => {
    switch (tbl) {
      case 'tables':
        return { name: str(d.name) ?? 'Stol', hourly_rate: num(d.hourly_rate), is_active: num(d.is_active), sort_order: num(d.sort_order) };
      case 'products':
        return {
          name: str(d.name) ?? 'Mahsulot',
          category: str(d.category) ?? '',
          price: num(d.price),
          track_stock: num(d.track_stock),
          is_active: num(d.is_active),
        };
      case 'expense_categories':
        return { name: str(d.name) ?? 'Boshqa', is_active: num(d.is_active) };
      case 'customers':
        return { name: str(d.name) ?? 'Mijoz', phone: str(d.phone), note: str(d.note), created_at: num(d.created_at) };
      case 'bills':
        return {
          kind: d.kind === 'table' ? 'table' : 'sale',
          table_id: await ref('tables', d.table_uid),
          customer_id: await ref('customers', d.customer_uid),
          label: str(d.label),
          status: d.status === 'closed' || d.status === 'cancelled' ? d.status : 'open',
          started_at: num(d.started_at),
          ended_at: optNum(d.ended_at),
          paused_at: optNum(d.paused_at),
          paused_ms: num(d.paused_ms),
          carried_ms: num(d.carried_ms),
          carried_amount: num(d.carried_amount),
          hourly_rate: num(d.hourly_rate),
          time_minutes: num(d.time_minutes),
          time_amount: num(d.time_amount),
          items_amount: num(d.items_amount),
          discount: num(d.discount),
          rounding_adj: num(d.rounding_adj),
          total: num(d.total),
          paid_amount: num(d.paid_amount),
          debt_amount: num(d.debt_amount),
          closed_at: optNum(d.closed_at),
          cancel_reason: str(d.cancel_reason),
        };
      case 'bill_items':
        return {
          bill_id: await need('bills', d.bill_uid),
          product_id: await ref('products', d.product_uid),
          name: str(d.name) ?? '',
          qty: num(d.qty),
          unit_price: num(d.unit_price),
          created_at: num(d.created_at),
        };
      case 'payments':
        return {
          bill_id: await ref('bills', d.bill_uid),
          customer_id: await ref('customers', d.customer_uid),
          amount: num(d.amount),
          method: method(d.method),
          kind: d.kind === 'debt_repayment' ? 'debt_repayment' : 'bill',
          note: str(d.note),
          created_at: num(d.created_at),
          deleted_at: optNum(d.deleted_at),
        };
      case 'debts':
        return {
          customer_id: await need('customers', d.customer_uid),
          bill_id: await ref('bills', d.bill_uid),
          amount: num(d.amount),
          note: str(d.note),
          created_at: num(d.created_at),
          deleted_at: optNum(d.deleted_at),
        };
      case 'expenses':
        return {
          category_id: await ref('expense_categories', d.category_uid),
          amount: num(d.amount),
          method: method(d.method),
          note: str(d.note),
          created_at: num(d.created_at),
          deleted_at: optNum(d.deleted_at),
        };
      case 'stock_moves':
        return {
          product_id: await need('products', d.product_uid),
          qty: num(d.qty),
          kind: d.kind === 'restock' ? 'restock' : 'adjust',
          note: str(d.note),
          created_at: num(d.created_at),
        };
      case 'settings':
        return { value: String(d.value ?? '') };
    }
  };

  /** Nomi bo'yicha mos keladigan lokal qator (faqat birinchi sinxronda, uid'i serverda yo'q bo'lsa). */
  const naturalMatch = async (tbl: SyncTable, d: Rec) => {
    if (tbl === 'customers') {
      const phone = str(d.phone);
      return txn.getFirstAsync<{ id: number; uid: string; updated_at: number }>(
        `SELECT id, uid, updated_at FROM customers
         WHERE lower(trim(name)) = lower(trim(?)) AND (phone IS NULL OR ? IS NULL OR phone = ?) ORDER BY id LIMIT 1`,
        [str(d.name) ?? '', phone, phone],
      );
    }
    const active = tbl === 'tables' || tbl === 'products' || tbl === 'expense_categories' ? 'is_active DESC,' : '';
    return txn.getFirstAsync<{ id: number; uid: string; updated_at: number }>(
      `SELECT id, uid, updated_at FROM ${tbl} WHERE lower(trim(name)) = lower(trim(?)) ORDER BY ${active} id LIMIT 1`,
      [str(d.name) ?? ''],
    );
  };

  const applyOne = async (row: SyncChange): Promise<'ok' | 'pending'> => {
    const tbl = row.tbl as SyncTable;
    const key = tbl === 'settings' ? 'key' : 'uid';
    await txn.runAsync('DELETE FROM sync_pending WHERE tbl = ? AND uid = ?', [tbl, row.uid]);

    if (row.deleted) {
      try {
        await txn.runAsync(`DELETE FROM ${tbl} WHERE ${key} = ?`, [row.uid]);
      } catch {
        // Boshqa yozuvlar havola qilib turgan bo'lsa (masalan to'lovi bor chek) — qoldiriladi.
      }
      await txn.runAsync('DELETE FROM sync_outbox WHERE tbl = ? AND uid = ?', [tbl, row.uid]);
      return 'ok';
    }

    if (tbl === 'settings') {
      if (!SETTING_KEYS.has(row.uid)) return 'ok';
      const local = await txn.getFirstAsync<{ updated_at: number }>('SELECT updated_at FROM settings WHERE key = ?', [row.uid]);
      if (local && row.updatedAt <= local.updated_at) return 'ok';
      await txn.runAsync(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [row.uid, String(row.data.value ?? ''), row.updatedAt],
      );
      await txn.runAsync('DELETE FROM sync_outbox WHERE tbl = ? AND uid = ?', [tbl, row.uid]);
      return 'ok';
    }

    let local = await txn.getFirstAsync<{ id: number; uid: string; updated_at: number }>(
      `SELECT id, uid, updated_at FROM ${tbl} WHERE uid = ?`,
      [row.uid],
    );
    if (!local && opts.matchByName && CATALOG.has(tbl)) {
      const match = await naturalMatch(tbl, row.data);
      if (match) {
        // Lokal qator server uid'ini oladi; eski uid hali serverga yuborilmagan — outbox'dan olib tashlanadi.
        await txn.runAsync(`UPDATE ${tbl} SET uid = ? WHERE id = ?`, [row.uid, match.id]);
        await txn.runAsync('DELETE FROM sync_outbox WHERE tbl = ? AND uid = ?', [tbl, match.uid]);
        ids.set(`${tbl}:${row.uid}`, match.id);
        local = { ...match, uid: row.uid };
        if (row.updatedAt <= match.updated_at) {
          // Lokal nusxa yangiroq — server uid'i bilan yuboriladi.
          await txn.runAsync('INSERT OR REPLACE INTO sync_outbox (tbl, uid, deleted, ts) VALUES (?, ?, 0, ?)', [
            tbl,
            row.uid,
            match.updated_at,
          ]);
          return 'ok';
        }
      }
    }
    if (local && row.updatedAt <= local.updated_at) return 'ok';

    let fields: Record<string, BindValue>;
    try {
      fields = await fieldsFor(tbl, row.data);
    } catch (e) {
      if (e instanceof MissingParent) {
        await txn.runAsync('INSERT OR REPLACE INTO sync_pending (tbl, uid, payload) VALUES (?, ?, ?)', [
          tbl,
          row.uid,
          JSON.stringify(row),
        ]);
        return 'pending';
      }
      throw e;
    }
    const cols = Object.keys(fields);
    const values = cols.map((c) => fields[c]);
    if (local) {
      await txn.runAsync(`UPDATE ${tbl} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [
        ...values,
        row.updatedAt,
        local.id,
      ]);
    } else {
      const res = await txn.runAsync(
        `INSERT INTO ${tbl} (uid, ${cols.join(', ')}, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`,
        [row.uid, ...values, row.updatedAt],
      );
      ids.set(`${tbl}:${row.uid}`, res.lastInsertRowId);
    }
    // Lokal o'zgarish eskirdi — serverga qayta yuborilmaydi.
    await txn.runAsync('DELETE FROM sync_outbox WHERE tbl = ? AND uid = ?', [tbl, row.uid]);
    return 'ok';
  };

  const order = (t: string) => TABLE_ORDER.indexOf(t as SyncTable);
  const sorted = rows.filter((r) => isSyncTable(r.tbl)).sort((a, b) => order(a.tbl) - order(b.tbl));
  let applied = 0;
  let pending = 0;
  for (const row of sorted) {
    if ((await applyOne(row)) === 'ok') applied++;
    else pending++;
  }

  // Avval ota yozuvi yo'q bo'lgan qatorlar: endi kelgan bo'lishi mumkin.
  for (let progress = true; progress; ) {
    progress = false;
    const waiting = await txn.getAllAsync<{ payload: string }>('SELECT payload FROM sync_pending', []);
    for (const w of waiting) {
      const row = JSON.parse(w.payload) as SyncChange;
      if ((await applyOne(row)) === 'ok') {
        progress = true;
        applied++;
      }
    }
  }
  const left = await txn.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_pending', []);
  pending = left?.n ?? 0;
  return { applied, pending };
}
