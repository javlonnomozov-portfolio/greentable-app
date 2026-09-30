import { migrate } from '@/db/migrations';
import type { RootDb } from '@/db/types';
import { clearHistory, exportData, importData, parseBackup } from '@/services/backup';
import {
  addItem,
  BillError,
  cancelBill,
  changeItemQty,
  closeBill,
  getBillDetail,
  listHall,
  listOpenSales,
  moveSession,
  openSale,
  pauseSession,
  resumeSession,
  setSessionStart,
  startTableSession,
} from '@/services/bills';
import { getStock, listProducts, restockProduct, saveProduct, saveTable, setStock } from '@/services/catalog';
import { addManualDebt, deleteLedgerEntry, getCustomer, getLedger, listCustomers, repayDebt, saveCustomer } from '@/services/customers';
import { addExpense, deleteExpense } from '@/services/expenses';
import { getReport, periodFor } from '@/services/reports';
import { createMemoryDb, createMigratedDb } from '../test/nodeDb';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 8, 29, 20, 0, 0).getTime();
const rounding = { step: 1000, mode: 'up' as const };
const noPay = { cash: 0, card: 0, transfer: 0 };
const cash = (amount: number) => ({ ...noPay, cash: amount });

let db: RootDb;

beforeEach(async () => {
  db = await createMigratedDb();
});

/** Butun kunlik hisobot (sinxronlashdan keyin ikki telefonni solishtirish uchun). */
const dayReport = (d: RootDb, at = T0) => getReport(d, periodFor('day', 0, at, 6), 6);

describe('migratsiya', () => {
  it('namunaviy stollar va mahsulotlar doimiy uid bilan yaratiladi', async () => {
    const hall = await listHall(db);
    expect(hall).toHaveLength(4);
    expect(hall.every((t) => t.bill_id == null)).toBe(true);
    const uids = await db.getAllAsync<{ uid: string }>('SELECT uid FROM tables ORDER BY id', []);
    expect(uids.map((r) => r.uid)).toEqual(['seed-table-1', 'seed-table-2', 'seed-table-3', 'seed-table-4']);
  });

  it('1-versiyadagi bazani yangilaydi va ombor qoldig‘ini saqlaydi', async () => {
    const old = createMemoryDb();
    await migrate(old, 1);
    // Eski sxema: qoldiq ustunda saqlanardi, sotuvda kamaytirilardi.
    await old.runAsync('UPDATE products SET track_stock = 1, stock_qty = 7 WHERE id = 1', []);
    await old.runAsync(
      "INSERT INTO bills (kind, table_id, status, started_at, closed_at, total) VALUES ('table', 1, 'closed', ?, ?, 15000)",
      [T0, T0 + HOUR],
    );
    await old.runAsync(
      'INSERT INTO bill_items (bill_id, product_id, name, qty, unit_price, created_at) VALUES (1, 1, ?, 3, 5000, ?)',
      ['Choy', T0],
    );
    await old.runAsync(
      "INSERT INTO payments (bill_id, amount, method, kind, created_at) VALUES (1, 15000, 'cash', 'bill', ?)",
      [T0 + HOUR],
    );

    await migrate(old);
    expect(await getStock(old, 1)).toBe(7);
    const bill = (await getBillDetail(old, 1))!.bill;
    expect(bill.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(bill.updated_at).toBe(T0 + HOUR);
    const report = await dayReport(old);
    expect(report.cash.income.cash).toBe(15000);
  });
});

describe('stol seansi', () => {
  it('pauza, mahsulot va qisman to‘lov bilan yopish → qarz daftari', async () => {
    const billId = await startTableSession(db, 1, T0);
    await expect(startTableSession(db, 1, T0)).rejects.toThrow(BillError);

    await addItem(db, billId, 1, 2, T0 + MIN); // Choy × 2 = 10 000
    await addItem(db, billId, 1, 1, T0 + 2 * MIN); // bir qatorga qo'shiladi
    await pauseSession(db, billId, T0 + 30 * MIN);
    await resumeSession(db, billId, T0 + 40 * MIN);

    const detail = (await getBillDetail(db, billId))!;
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].qty).toBe(3);

    // 70 daqiqa o'tdi, 10 daqiqa pauza → 60 daqiqa × 30 000 = 30 000; choy 15 000
    await expect(
      closeBill(db, billId, { now: T0 + 70 * MIN, rounding, payment: cash(20000), customerId: null }),
    ).rejects.toThrow('mijozni tanlang');

    const customerId = await saveCustomer(db, { name: 'Aziz aka', phone: '+998901234567' }, T0);
    const res = await closeBill(db, billId, { now: T0 + 70 * MIN, rounding, payment: cash(20000), customerId });
    expect(res).toEqual({ total: 45000, paid: 20000, debt: 25000, change: 0 });

    const closed = (await getBillDetail(db, billId))!.bill;
    expect(closed).toMatchObject({ status: 'closed', time_minutes: 60, time_amount: 30000, items_amount: 15000 });
    expect((await getCustomer(db, customerId))!.balance).toBe(25000);

    await repayDebt(db, customerId, 25000, 'card', '', T0 + 24 * HOUR);
    expect((await getCustomer(db, customerId))!.balance).toBe(0);
    expect(await getLedger(db, customerId)).toHaveLength(2);
  });

  it('stol almashtirish eski narxni saqlaydi', async () => {
    await saveTable(db, { id: 2, name: 'VIP', hourly_rate: 60000 });
    const billId = await startTableSession(db, 1, T0);
    await moveSession(db, billId, 2, T0 + 30 * MIN); // 30 daq × 30 000 = 15 000
    const hall = await listHall(db);
    expect(hall.find((t) => t.id === 1)!.bill_id).toBeNull();
    expect(hall.find((t) => t.id === 2)!.bill_id).toBe(billId);

    // yana 30 daq × 60 000 = 30 000 → jami 45 000
    const res = await closeBill(db, billId, { now: T0 + HOUR, rounding, payment: cash(45000), customerId: null });
    expect(res.total).toBe(45000);
  });

  it('esdan chiqqan seans: boshlanish va tugash vaqti qo‘lda kiritiladi', async () => {
    // Admin 20:30 da eslab qoldi: o'yin 20:00 da boshlangan edi.
    const billId = await startTableSession(db, 1, T0 + 30 * MIN, { startedAt: T0 });
    expect((await getBillDetail(db, billId))!.bill.started_at).toBe(T0);
    await expect(startTableSession(db, 2, T0, { startedAt: T0 + HOUR })).rejects.toThrow('kelajakda');
    await expect(startTableSession(db, 2, T0 + 25 * HOUR, { startedAt: T0 })).rejects.toThrow('24 soat');

    // Keyin aniqlandi: aslida 19:50 da boshlangan.
    await setSessionStart(db, billId, T0 - 10 * MIN, T0 + 40 * MIN);
    // O'yin 21:10 da tugagan, admin 21:30 da yopyapti → 80 daqiqa hisoblanadi.
    await expect(
      closeBill(db, billId, { now: T0 + 90 * MIN, endedAt: T0 - 20 * MIN, rounding, payment: noPay, customerId: null }),
    ).rejects.toThrow('boshlanishdan oldin');
    const res = await closeBill(db, billId, {
      now: T0 + 90 * MIN,
      endedAt: T0 + 70 * MIN,
      rounding,
      payment: cash(40000),
      customerId: null,
    });
    expect(res.total).toBe(40000);
    const bill = (await getBillDetail(db, billId))!.bill;
    expect(bill).toMatchObject({ ended_at: T0 + 70 * MIN, closed_at: T0 + 90 * MIN, time_minutes: 80 });
  });

  it('yakuniy summani admin o‘zgartiradi: chegirma yoki ustama', async () => {
    const b1 = await startTableSession(db, 1, T0);
    await addItem(db, b1, 2, 1, T0); // 10 000
    // hisoblangan: 60 daq = 30 000 + 10 000 = 40 000, admin "35 000 bering" dedi
    const r1 = await closeBill(db, b1, { now: T0 + HOUR, rounding, finalTotal: 35000, payment: cash(35000), customerId: null });
    expect(r1).toMatchObject({ total: 35000, debt: 0 });

    const b2 = await startTableSession(db, 2, T0);
    // hisoblangan 30 000, mijoz 32 000 berdi va qaytim olmadi
    const r2 = await closeBill(db, b2, { now: T0 + HOUR, rounding, finalTotal: 32000, payment: cash(32000), customerId: null });
    expect(r2).toMatchObject({ total: 32000, change: 0 });
    expect((await getBillDetail(db, b2))!.bill.discount).toBe(-2000);

    const report = await dayReport(db);
    expect(report.revenue).toMatchObject({ total: 67000, discount: 5000, extra: 2000 });
  });

  it('tez-tez bosilgan mahsulotlar navbat bilan yoziladi', async () => {
    const billId = await startTableSession(db, 1, T0);
    await Promise.all([1, 2, 3, 4, 5].map(() => addItem(db, billId, 1, 1, T0)));
    const detail = (await getBillDetail(db, billId))!;
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].qty).toBe(5);
  });

  it('bekor qilish omborni tiklaydi va to‘lovlarni hisobdan chiqaradi', async () => {
    await restockProduct(db, { productId: 3, qty: 10, totalCost: 30000, method: 'cash', now: T0 });
    const billId = await startTableSession(db, 1, T0);
    await addItem(db, billId, 3, 4, T0);
    expect(await getStock(db, 3)).toBe(6);
    await changeItemQty(db, (await getBillDetail(db, billId))!.items[0].id, -1);
    expect(await getStock(db, 3)).toBe(7);

    await closeBill(db, billId, { now: T0 + 30 * MIN, rounding, payment: cash(30000), customerId: null });
    expect((await dayReport(db)).cash.income.cash).toBe(30000);
    await cancelBill(db, billId, 'xato', T0 + 31 * MIN);
    expect(await getStock(db, 3)).toBe(10);
    expect((await dayReport(db)).cash.income.cash).toBe(0);
    expect((await getBillDetail(db, billId))!.bill.status).toBe('cancelled');
  });
});

describe('ombor', () => {
  it('kirim, sotuv va sanoq', async () => {
    const id = await saveProduct(db, { name: 'Pepsi', category: 'Ichimliklar', price: 8000, track_stock: true });
    await restockProduct(db, { productId: id, qty: 24, totalCost: 0, method: 'cash', now: T0 });
    const b = await openSale(db, T0);
    await addItem(db, b, id, 5, T0);
    expect(await getStock(db, id)).toBe(19);
    await setStock(db, id, 17, T0 + HOUR); // 2 ta yo'qolgan
    expect(await getStock(db, id)).toBe(17);
    expect((await listProducts(db)).find((p) => p.id === id)!.stock_qty).toBe(17);
  });
});

describe('stolsiz savdo', () => {
  it('odam nomiga ochiq hisob qarzga yopiladi', async () => {
    const customerId = await saveCustomer(db, { name: 'Sardor' }, T0);
    const billId = await openSale(db, T0, { customerId, label: 'Sardor' });
    await addItem(db, billId, 2, 1, T0);
    await addItem(db, billId, 4, 2, T0 + HOUR);
    const open = await listOpenSales(db);
    expect(open).toEqual([expect.objectContaining({ id: billId, items_amount: 30000, items_count: 3 })]);

    const res = await closeBill(db, billId, { now: T0 + 90 * MIN, rounding, payment: noPay, customerId: null });
    expect(res.debt).toBe(30000);
    expect((await listCustomers(db))[0]).toMatchObject({ name: 'Sardor', balance: 30000 });
  });

  it('bo‘sh tezkor savdo bekor qilinsa o‘chib ketadi', async () => {
    const billId = await openSale(db, T0);
    await expect(closeBill(db, billId, { now: T0, rounding, payment: noPay, customerId: null })).rejects.toThrow("bo'sh");
    await cancelBill(db, billId, '', T0);
    expect(await getBillDetail(db, billId)).toBeNull();
  });
});

describe('hisobot', () => {
  it('tushum, pul oqimi va qarzlar', async () => {
    const customerId = await saveCustomer(db, { name: 'Aziz' }, T0);
    const b1 = await startTableSession(db, 1, T0);
    await addItem(db, b1, 1, 2, T0);
    await closeBill(db, b1, { now: T0 + HOUR, rounding, payment: cash(40000), customerId });
    const b2 = await openSale(db, T0);
    await addItem(db, b2, 2, 1, T0);
    await closeBill(db, b2, { now: T0 + 5 * MIN, rounding, payment: { ...noPay, card: 10000 }, customerId: null });
    await addExpense(db, { categoryId: 1, amount: 15000, method: 'cash', note: '', now: T0 + 10 * MIN });
    const deleted = await addExpense(db, { categoryId: 1, amount: 99000, method: 'cash', note: 'xato', now: T0 });
    await deleteExpense(db, deleted, T0 + MIN);
    await repayDebt(db, customerId, 5000, 'cash', '', T0 + 2 * HOUR);

    const r = await dayReport(db, T0 + 3 * HOUR);
    expect(r.revenue).toMatchObject({ tableTime: 30000, tableBar: 10000, sales: 10000, total: 50000, billCount: 2 });
    expect(r.cash.income).toEqual({ cash: 45000, card: 10000, transfer: 0, total: 55000 });
    expect(r.cash.net.cash).toBe(30000);
    expect(r.debts).toEqual({ given: 0, repaid: 5000, outstanding: -5000 });
    expect(r.profit).toBe(35000);
    expect(r.tables[0]).toMatchObject({ name: 'Stol 1', sessions: 1, minutes: 60 });
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0].total).toBe(50000);
  });

  it('tungi o‘yin kechagi ish kuniga yoziladi', () => {
    const at2am = new Date(2026, 8, 30, 2, 0).getTime();
    const p = periodFor('day', 0, at2am, 6);
    expect(new Date(p.from).getDate()).toBe(29);
    expect(p.to - p.from).toBe(24 * HOUR);
  });
});

describe('ikki telefon: zaxira orqali birlashtirish', () => {
  /** A telefondan eksport qilib B ga import qiladi (JSON orqali, xuddi fayldagidek). */
  const sync = async (from: RootDb, to: RootDb, period: { from: number; to: number } | null = null, at = T0 + 12 * HOUR) =>
    importData(to, parseBackup(JSON.stringify(await exportData(from, at, period))));

  it('egasining kuni sherigining telefoniga qo‘shiladi, qayta import takrorlamaydi', async () => {
    const a = db;
    const b = await createMigratedDb();

    // Sherik (B) o'z kunida ishladi
    const bBill = await startTableSession(b, 3, T0 - 24 * HOUR);
    await closeBill(b, bBill, { now: T0 - 23 * HOUR, rounding, payment: cash(30000), customerId: null });

    // Egasi (A): stolni qayta nomladi, qarz, xarajat, ombor kirimi
    await saveTable(a, { id: 1, name: 'VIP 1', hourly_rate: 50000 }, T0);
    const aziz = await saveCustomer(a, { name: 'Aziz aka', phone: '+998901112233' }, T0);
    await restockProduct(a, { productId: 4, qty: 12, totalCost: 60000, method: 'cash', now: T0 });
    const aBill = await startTableSession(a, 1, T0);
    await addItem(a, aBill, 4, 2, T0);
    await closeBill(a, aBill, { now: T0 + HOUR, rounding, payment: cash(30000), customerId: aziz });
    await openSale(a, T0 + 2 * HOUR); // ochiq hisob — faylga kirmaydi

    const stats = await sync(a, b);
    expect(stats.added).toMatchObject({ bills: 1, customers: 1, debts: 1, expenses: 1, stockMoves: 1, tables: 0 });
    expect(stats.updated.tables).toBe(1);

    // B endi A ning kunini ham ko'radi
    const hallB = await listHall(b);
    expect(hallB.find((t) => t.id === 1)).toMatchObject({ name: 'VIP 1', hourly_rate: 50000 });
    expect(hallB).toHaveLength(4);
    expect(await getStock(b, 4)).toBe(10);
    const azizB = (await listCustomers(b)).find((c) => c.name === 'Aziz aka')!;
    expect(azizB.balance).toBe(40000); // 50 000 + 20 000 − 30 000
    const reportA = await dayReport(a);
    const reportB = await dayReport(b);
    expect(reportB.revenue).toEqual(reportA.revenue);
    expect(reportB.cash).toEqual(reportA.cash);
    expect(await listOpenSales(b)).toHaveLength(0);

    // Xuddi shu faylni ikkinchi marta import qilish hech narsa qo'shmaydi
    const again = await sync(a, b);
    expect(Object.values(again.added).every((n) => n === 0)).toBe(true);
    expect(Object.values(again.updated).every((n) => n === 0)).toBe(true);
    expect(await getStock(b, 4)).toBe(10);
    const aUid = (await getBillDetail(a, aBill))!.bill.uid;
    const itemsOnB = await b.getAllAsync('SELECT i.id FROM bill_items i JOIN bills x ON x.id = i.bill_id WHERE x.uid = ?', [aUid]);
    expect(itemsOnB).toHaveLength(1);

    // B da: qarz to'landi va A ning chekidagi xato qarz yozuvi o'chirildi → A ga qaytadi
    await repayDebt(b, azizB.id, 10000, 'cash', '', T0 + 20 * HOUR);
    await sync(b, a, null, T0 + 21 * HOUR);
    expect((await getCustomer(a, aziz))!.balance).toBe(30000);
    expect((await dayReport(a, T0 - 23 * HOUR)).revenue.total).toBe(30000); // B ning kuni A da ham bor

    // A da chek bekor qilindi → B da ham bekor bo'ladi, qarz va to'lov hisobdan chiqadi
    await cancelBill(a, aBill, 'xato', T0 + 22 * HOUR);
    await sync(a, b, null, T0 + 23 * HOUR);
    expect((await dayReport(b)).revenue.total).toBe(0);
    expect((await getCustomer(b, azizB.id))!.balance).toBe(-10000);
    expect(await getStock(b, 4)).toBe(12);
  });

  it('qo‘lda yozilgan qarzni o‘chirish ham boshqa telefonga o‘tadi', async () => {
    const b = await createMigratedDb();
    const c = await saveCustomer(db, { name: 'Jasur' }, T0);
    await addManualDebt(db, c, 50000, 'eski qarz', T0);
    await sync(db, b);
    const jasurB = (await listCustomers(b))[0];
    expect(jasurB.balance).toBe(50000);

    const entry = (await getLedger(db, c))[0];
    await deleteLedgerEntry(db, entry, T0 + HOUR);
    await sync(db, b);
    expect((await getCustomer(b, jasurB.id))!.balance).toBe(0);
  });

  it('bir xil ismli mijoz ikki telefonda bitta bo‘ladi', async () => {
    const b = await createMigratedDb();
    await saveCustomer(db, { name: 'Aziz aka', phone: '+998901112233' }, T0);
    await saveCustomer(b, { name: 'aziz aka ' }, T0 - HOUR);
    await sync(db, b);
    const list = await listCustomers(b);
    expect(list).toHaveLength(1);
    expect(list[0].phone).toBe('+998901112233');
  });

  it('davr tanlansa faqat o‘sha kundagi o‘zgarishlar yoziladi', async () => {
    const yesterday = await startTableSession(db, 1, T0 - 24 * HOUR);
    await closeBill(db, yesterday, { now: T0 - 23 * HOUR, rounding, payment: cash(30000), customerId: null });
    const today = await startTableSession(db, 2, T0);
    await closeBill(db, today, { now: T0 + HOUR, rounding, payment: cash(30000), customerId: null });

    const file = await exportData(db, T0 + 2 * HOUR, periodFor('day', 0, T0 + 2 * HOUR, 6));
    expect(file.bills).toHaveLength(1);
    expect(file.payments).toHaveLength(1);
    expect(file.tables).toHaveLength(4);
  });

  it('begona va eski formatdagi fayllarni rad etadi', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow('zaxira nusxasi emas');
    expect(() => parseBackup('{"app":"biliard-pos","schemaVersion":1,"tables":{}}')).toThrow('eski versiyasida');
  });
});

describe('tarixni tozalash', () => {
  it('tarix o‘chadi, stollar va mahsulotlar qoladi', async () => {
    const c = await saveCustomer(db, { name: 'Aziz' }, T0);
    const b = await startTableSession(db, 1, T0);
    await closeBill(db, b, { now: T0 + HOUR, rounding, payment: noPay, customerId: c });
    await addExpense(db, { categoryId: 1, amount: 1000, method: 'cash', note: '', now: T0 });

    await clearHistory(db, { includeCatalog: false });
    expect(await listCustomers(db)).toHaveLength(0);
    expect((await dayReport(db)).revenue.total).toBe(0);
    expect(await listHall(db)).toHaveLength(4);

    await clearHistory(db, { includeCatalog: true });
    expect(await listHall(db)).toHaveLength(0);
    expect(await listProducts(db)).toHaveLength(0);
  });
});
