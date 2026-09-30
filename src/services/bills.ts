import type { BillItemRow, BillRow, CustomerRow, TableRow } from '@/db/models';
import { NEW_UID, transaction, type Db, type RootDb } from '@/db/types';
import {
  calcSegmentMs,
  calcTimeCharge,
  segmentCharge,
  splitPayment,
  type PaymentInput,
  type RoundingSettings,
  type TimeCharge,
} from './billing';

export class BillError extends Error {}

/** Unutilgan seansni qo'lda kiritishda eng ko'pi bilan shuncha orqaga qaytish mumkin. */
const MAX_BACKDATE_MS = 24 * 60 * 60_000;
/** Telefon soatlaridagi kichik farq uchun ruxsat. */
const CLOCK_SKEW_MS = 60_000;

function checkStartTime(startedAt: number, now: number): void {
  if (startedAt > now + CLOCK_SKEW_MS) throw new BillError("Boshlanish vaqti kelajakda bo'lishi mumkin emas");
  if (now - startedAt > MAX_BACKDATE_MS) throw new BillError("Boshlanish vaqti 24 soatdan oldin bo'lishi mumkin emas");
}

async function getOpenBill(db: Db, billId: number): Promise<BillRow> {
  const bill = await db.getFirstAsync<BillRow>('SELECT * FROM bills WHERE id = ?', [billId]);
  if (!bill) throw new BillError('Hisob topilmadi');
  if (bill.status !== 'open') throw new BillError('Bu hisob allaqachon yopilgan');
  return bill;
}

export interface OpenBillOptions {
  customerId?: number | null;
  label?: string | null;
  /** Admin seansni kiritishni unutgan bo'lsa — haqiqiy boshlanish vaqti. Bo'lmasa `now`. */
  startedAt?: number;
}

export async function startTableSession(
  db: RootDb,
  tableId: number,
  now: number,
  opts: OpenBillOptions = {},
): Promise<number> {
  return transaction(db, async (txn) => {
    const table = await txn.getFirstAsync<TableRow>('SELECT * FROM tables WHERE id = ? AND is_active = 1', [tableId]);
    if (!table) throw new BillError('Stol topilmadi');
    const busy = await txn.getFirstAsync<{ id: number }>(
      "SELECT id FROM bills WHERE table_id = ? AND status = 'open'",
      [tableId],
    );
    if (busy) throw new BillError(`${table.name} band`);
    const startedAt = opts.startedAt ?? now;
    checkStartTime(startedAt, now);
    const res = await txn.runAsync(
      `INSERT INTO bills (uid, kind, table_id, customer_id, label, started_at, hourly_rate, updated_at)
       VALUES (${NEW_UID}, 'table', ?, ?, ?, ?, ?, ?)`,
      [tableId, opts.customerId ?? null, opts.label?.trim() || null, startedAt, table.hourly_rate, now],
    );
    return res.lastInsertRowId;
  });
}

/** Stolsiz savdo: tezkor (nomsiz) yoki odam nomiga ochiq hisob. */
export async function openSale(db: Db, now: number, opts: OpenBillOptions = {}): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO bills (uid, kind, customer_id, label, started_at, updated_at) VALUES (${NEW_UID}, 'sale', ?, ?, ?, ?)`,
    [opts.customerId ?? null, opts.label?.trim() || null, now, now],
  );
  return res.lastInsertRowId;
}

export async function pauseSession(db: Db, billId: number, now: number): Promise<void> {
  const bill = await getOpenBill(db, billId);
  if (bill.kind !== 'table' || bill.paused_at != null) return;
  await db.runAsync('UPDATE bills SET paused_at = ? WHERE id = ?', [now, billId]);
}

export async function resumeSession(db: Db, billId: number, now: number): Promise<void> {
  const bill = await getOpenBill(db, billId);
  if (bill.paused_at == null) return;
  await db.runAsync('UPDATE bills SET paused_ms = paused_ms + ?, paused_at = NULL WHERE id = ?', [
    Math.max(0, now - bill.paused_at),
    billId,
  ]);
}

/** Ochiq seansning boshlanish vaqtini tuzatish (o'yin oldinroq boshlangan, lekin kiritilmagan bo'lsa). */
export async function setSessionStart(db: Db, billId: number, startedAt: number, now: number): Promise<void> {
  const bill = await getOpenBill(db, billId);
  if (bill.kind !== 'table') throw new BillError('Bu stol seansi emas');
  checkStartTime(startedAt, now);
  if (bill.paused_at != null && startedAt > bill.paused_at) {
    throw new BillError("Boshlanish vaqti pauzadan keyin bo'lishi mumkin emas");
  }
  if (startedAt + bill.paused_ms > now) throw new BillError("Boshlanish vaqti noto'g'ri");
  await db.runAsync('UPDATE bills SET started_at = ?, updated_at = ? WHERE id = ?', [startedAt, now, billId]);
}

/**
 * Seansni boshqa stolga ko'chiradi. Eski stolda o'tgan vaqt eski narxda
 * `carried_*` maydonlariga yoziladi, yangi stolda hisob yangi narxda davom etadi.
 */
export async function moveSession(db: RootDb, billId: number, newTableId: number, now: number): Promise<void> {
  await transaction(db, async (txn) => {
    const bill = await getOpenBill(txn, billId);
    if (bill.kind !== 'table') throw new BillError("Bu stol seansi emas");
    if (bill.table_id === newTableId) return;
    const table = await txn.getFirstAsync<TableRow>('SELECT * FROM tables WHERE id = ? AND is_active = 1', [newTableId]);
    if (!table) throw new BillError('Stol topilmadi');
    const busy = await txn.getFirstAsync<{ id: number }>(
      "SELECT id FROM bills WHERE table_id = ? AND status = 'open'",
      [newTableId],
    );
    if (busy) throw new BillError(`${table.name} band`);
    const segMs = calcSegmentMs(bill, now);
    await txn.runAsync(
      `UPDATE bills SET table_id = ?, hourly_rate = ?, carried_ms = carried_ms + ?, carried_amount = carried_amount + ?,
         started_at = ?, paused_ms = 0, paused_at = CASE WHEN paused_at IS NULL THEN NULL ELSE ? END
       WHERE id = ?`,
      [newTableId, table.hourly_rate, segMs, segmentCharge(segMs, bill.hourly_rate), now, now, billId],
    );
  });
}

export async function addItem(db: RootDb, billId: number, productId: number, qty: number, now: number): Promise<void> {
  if (qty <= 0) return;
  await transaction(db, async (txn) => {
    await getOpenBill(txn, billId);
    const product = await txn.getFirstAsync<{ name: string; price: number }>(
      'SELECT name, price FROM products WHERE id = ? AND is_active = 1',
      [productId],
    );
    if (!product) throw new BillError('Mahsulot topilmadi');
    const existing = await txn.getFirstAsync<{ id: number }>(
      'SELECT id FROM bill_items WHERE bill_id = ? AND product_id = ? AND unit_price = ?',
      [billId, productId, product.price],
    );
    if (existing) {
      await txn.runAsync('UPDATE bill_items SET qty = qty + ? WHERE id = ?', [qty, existing.id]);
    } else {
      await txn.runAsync(
        `INSERT INTO bill_items (uid, bill_id, product_id, name, qty, unit_price, created_at)
         VALUES (${NEW_UID}, ?, ?, ?, ?, ?, ?)`,
        [billId, productId, product.name, qty, product.price, now],
      );
    }
  });
}

/** Miqdorni o'zgartiradi; 0 ga tushsa qator o'chiriladi (ombor qoldig'i cheklardan hisoblanadi). */
export async function changeItemQty(db: RootDb, itemId: number, delta: number): Promise<void> {
  await transaction(db, async (txn) => {
    const item = await txn.getFirstAsync<BillItemRow>('SELECT * FROM bill_items WHERE id = ?', [itemId]);
    if (!item) return;
    await getOpenBill(txn, item.bill_id);
    const newQty = Math.max(0, item.qty + delta);
    if (newQty === 0) {
      await txn.runAsync('DELETE FROM bill_items WHERE id = ?', [itemId]);
    } else {
      await txn.runAsync('UPDATE bill_items SET qty = ? WHERE id = ?', [newQty, itemId]);
    }
  });
}

export async function setBillCustomer(
  db: Db,
  billId: number,
  customerId: number | null,
  label?: string | null,
): Promise<void> {
  await getOpenBill(db, billId);
  if (label === undefined) {
    await db.runAsync('UPDATE bills SET customer_id = ? WHERE id = ?', [customerId, billId]);
  } else {
    await db.runAsync('UPDATE bills SET customer_id = ?, label = ? WHERE id = ?', [customerId, label?.trim() || null, billId]);
  }
}

export interface BillDetail {
  bill: BillRow;
  table: TableRow | null;
  customer: CustomerRow | null;
  items: BillItemRow[];
  itemsAmount: number;
}

export async function getBillDetail(db: Db, billId: number): Promise<BillDetail | null> {
  const bill = await db.getFirstAsync<BillRow>('SELECT * FROM bills WHERE id = ?', [billId]);
  if (!bill) return null;
  const [table, customer, items] = await Promise.all([
    bill.table_id != null
      ? db.getFirstAsync<TableRow>('SELECT * FROM tables WHERE id = ?', [bill.table_id])
      : Promise.resolve(null),
    bill.customer_id != null
      ? db.getFirstAsync<CustomerRow>('SELECT * FROM customers WHERE id = ?', [bill.customer_id])
      : Promise.resolve(null),
    db.getAllAsync<BillItemRow>('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [billId]),
  ]);
  const itemsAmount = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  return { bill, table, customer, items, itemsAmount };
}

export interface BillTotals {
  time: TimeCharge | null;
  itemsAmount: number;
  subtotal: number;
}

/** Ochiq hisob uchun joriy summa (yopilgan hisobda saqlangan qiymatlar ishlatiladi). */
export function computeTotals(detail: BillDetail, now: number, rounding: RoundingSettings): BillTotals {
  const { bill } = detail;
  if (bill.status !== 'open') {
    return {
      time:
        bill.kind === 'table'
          ? {
              minutes: bill.time_minutes,
              raw: bill.time_amount - bill.rounding_adj,
              amount: bill.time_amount,
              roundingAdj: bill.rounding_adj,
            }
          : null,
      itemsAmount: bill.items_amount,
      subtotal: bill.time_amount + bill.items_amount,
    };
  }
  const time = bill.kind === 'table' ? calcTimeCharge(bill, now, rounding) : null;
  return { time, itemsAmount: detail.itemsAmount, subtotal: (time?.amount ?? 0) + detail.itemsAmount };
}

export interface CloseBillInput {
  /** Hozirgi vaqt: chek yopilgan va to'lov qabul qilingan payt. */
  now: number;
  /** O'yin tugagan vaqt, agar admin kechikib yopayotgan bo'lsa. Bo'lmasa `now`. */
  endedAt?: number;
  rounding: RoundingSettings;
  /**
   * Admin kelishgan yakuniy summa. Hisoblangandan kam bo'lsa farq chegirma,
   * ko'p bo'lsa ustama sifatida yoziladi. Berilmasa hisoblangan summa olinadi.
   */
  finalTotal?: number;
  payment: PaymentInput;
  customerId: number | null;
}

export interface CloseBillResult {
  total: number;
  paid: number;
  debt: number;
  change: number;
}

export async function closeBill(db: RootDb, billId: number, input: CloseBillInput): Promise<CloseBillResult> {
  return transaction(db, async (txn) => {
    const detail = await getBillDetail(txn, billId);
    if (!detail) throw new BillError('Hisob topilmadi');
    const { bill } = detail;
    if (bill.status !== 'open') throw new BillError('Bu hisob allaqachon yopilgan');
    const { now } = input;
    const endedAt = bill.kind === 'table' ? (input.endedAt ?? now) : now;
    if (endedAt > now + CLOCK_SKEW_MS) throw new BillError("Tugash vaqti kelajakda bo'lishi mumkin emas");
    if (endedAt < bill.started_at) throw new BillError("Tugash vaqti boshlanishdan oldin bo'lishi mumkin emas");
    const totals = computeTotals(detail, endedAt, input.rounding);
    if (bill.kind === 'sale' && detail.items.length === 0) throw new BillError("Hisob bo'sh");
    const total = input.finalTotal ?? totals.subtotal;
    if (!Number.isInteger(total) || total < 0) throw new BillError("To'lanadigan summa noto'g'ri");
    // Manfiy qiymat — ustama (mijoz hisoblangandan ko'p to'lagan va qaytim olmagan).
    const discount = totals.subtotal - total;
    const split = splitPayment(total, input.payment);

    const customerId = input.customerId ?? bill.customer_id;
    if (split.debt > 0) {
      if (customerId == null) throw new BillError('Qarzga yozish uchun mijozni tanlang');
      const exists = await txn.getFirstAsync<{ id: number }>('SELECT id FROM customers WHERE id = ?', [customerId]);
      if (!exists) throw new BillError('Mijoz topilmadi');
    }
    const pausedMs = bill.paused_ms + (bill.paused_at != null ? Math.max(0, endedAt - bill.paused_at) : 0);

    await txn.runAsync(
      `UPDATE bills SET status = 'closed', ended_at = ?, closed_at = ?, paused_at = NULL, paused_ms = ?,
         time_minutes = ?, time_amount = ?, rounding_adj = ?, items_amount = ?, discount = ?, total = ?,
         paid_amount = ?, debt_amount = ?, customer_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        endedAt,
        now,
        pausedMs,
        totals.time?.minutes ?? 0,
        totals.time?.amount ?? 0,
        totals.time?.roundingAdj ?? 0,
        totals.itemsAmount,
        discount,
        total,
        split.paid,
        split.debt,
        customerId,
        now,
        billId,
      ],
    );
    for (const method of ['cash', 'card', 'transfer'] as const) {
      if (split[method] > 0) {
        await txn.runAsync(
          `INSERT INTO payments (uid, bill_id, customer_id, amount, method, kind, created_at, updated_at)
           VALUES (${NEW_UID}, ?, ?, ?, ?, 'bill', ?, ?)`,
          [billId, customerId, split[method], method, now, now],
        );
      }
    }
    if (split.debt > 0) {
      await txn.runAsync(
        `INSERT INTO debts (uid, customer_id, bill_id, amount, note, created_at, updated_at)
         VALUES (${NEW_UID}, ?, ?, ?, ?, ?, ?)`,
        [customerId, billId, split.debt, billNote(detail), now, now],
      );
    }
    return { total, paid: split.paid, debt: split.debt, change: split.change };
  });
}

function billNote(detail: BillDetail): string {
  const where = detail.table ? detail.table.name : 'Savdo';
  return `${where} · chek #${detail.bill.id}`;
}

/**
 * Hisobni bekor qiladi. Ochiq bo'sh savdo hisobi shunchaki o'chiriladi.
 * Yopilgan hisob bekor qilinsa, unga tegishli to'lov va qarz yozuvlari o'chirilgan deb belgilanadi
 * (butunlay o'chirilmaydi — boshqa telefonga ham shu o'zgarish yetib borishi uchun).
 * Mahsulotlar omborga o'z-o'zidan qaytadi: bekor qilingan cheklar qoldiqdan ayirilmaydi.
 */
export async function cancelBill(db: RootDb, billId: number, reason: string, now: number): Promise<void> {
  await transaction(db, async (txn) => {
    const bill = await txn.getFirstAsync<BillRow>('SELECT * FROM bills WHERE id = ?', [billId]);
    if (!bill || bill.status === 'cancelled') return;
    const items = await txn.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM bill_items WHERE bill_id = ?', [
      billId,
    ]);
    if (bill.status === 'open' && bill.kind === 'sale' && !items?.n) {
      await txn.runAsync('DELETE FROM bills WHERE id = ?', [billId]);
      return;
    }
    await txn.runAsync(
      "UPDATE payments SET deleted_at = ?, updated_at = ? WHERE bill_id = ? AND kind = 'bill' AND deleted_at IS NULL",
      [now, now, billId],
    );
    await txn.runAsync('UPDATE debts SET deleted_at = ?, updated_at = ? WHERE bill_id = ? AND deleted_at IS NULL', [
      now,
      now,
      billId,
    ]);
    await txn.runAsync(
      `UPDATE bills SET status = 'cancelled', cancel_reason = ?, ended_at = COALESCE(ended_at, ?),
         closed_at = COALESCE(closed_at, ?), paused_at = NULL, updated_at = ?
       WHERE id = ?`,
      [reason.trim() || null, now, now, now, billId],
    );
  });
}

export interface HallTable extends TableRow {
  bill_id: number | null;
  started_at: number | null;
  ended_at: null;
  paused_at: number | null;
  paused_ms: number;
  carried_ms: number;
  carried_amount: number;
  bill_rate: number | null;
  label: string | null;
  customer_name: string | null;
  items_amount: number;
}

export async function listHall(db: Db): Promise<HallTable[]> {
  return db.getAllAsync<HallTable>(
    `SELECT t.*, b.id AS bill_id, b.started_at, NULL AS ended_at, b.paused_at,
       COALESCE(b.paused_ms, 0) AS paused_ms, COALESCE(b.carried_ms, 0) AS carried_ms,
       COALESCE(b.carried_amount, 0) AS carried_amount, b.hourly_rate AS bill_rate, b.label,
       c.name AS customer_name,
       COALESCE((SELECT SUM(qty * unit_price) FROM bill_items WHERE bill_id = b.id), 0) AS items_amount
     FROM tables t
     LEFT JOIN bills b ON b.table_id = t.id AND b.status = 'open'
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE t.is_active = 1
     ORDER BY t.sort_order, t.id`,
    [],
  );
}

export interface OpenSale {
  id: number;
  label: string | null;
  customer_id: number | null;
  customer_name: string | null;
  started_at: number;
  items_amount: number;
  items_count: number;
}

export async function listOpenSales(db: Db): Promise<OpenSale[]> {
  return db.getAllAsync<OpenSale>(
    `SELECT b.id, b.label, b.customer_id, c.name AS customer_name, b.started_at,
       COALESCE(SUM(i.qty * i.unit_price), 0) AS items_amount, COALESCE(SUM(i.qty), 0) AS items_count
     FROM bills b
     LEFT JOIN customers c ON c.id = b.customer_id
     LEFT JOIN bill_items i ON i.bill_id = b.id
     WHERE b.kind = 'sale' AND b.status = 'open'
     GROUP BY b.id
     ORDER BY b.started_at DESC`,
    [],
  );
}

export interface BillListItem {
  id: number;
  kind: 'table' | 'sale';
  status: 'closed' | 'cancelled';
  table_name: string | null;
  label: string | null;
  customer_name: string | null;
  total: number;
  debt_amount: number;
  closed_at: number;
}

/** Davr ichidagi yopilgan va bekor qilingan cheklar. */
export async function listBills(db: Db, from: number, to: number): Promise<BillListItem[]> {
  return db.getAllAsync<BillListItem>(
    `SELECT b.id, b.kind, b.status, t.name AS table_name, b.label, c.name AS customer_name,
       b.total, b.debt_amount, b.closed_at
     FROM bills b
     LEFT JOIN tables t ON t.id = b.table_id
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.status IN ('closed', 'cancelled') AND b.closed_at >= ? AND b.closed_at < ?
     ORDER BY b.closed_at DESC`,
    [from, to],
  );
}

export async function getBillPayments(db: Db, billId: number) {
  return db.getAllAsync<{ method: 'cash' | 'card' | 'transfer'; amount: number }>(
    "SELECT method, SUM(amount) AS amount FROM payments WHERE bill_id = ? AND kind = 'bill' AND deleted_at IS NULL GROUP BY method",
    [billId],
  );
}
