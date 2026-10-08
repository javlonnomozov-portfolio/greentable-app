import type { RootDb } from '@/db/types';
import {
  addItem,
  cancelBill,
  changeItemQty,
  closeBill,
  extendPlanned,
  getBillDetail,
  listHall,
  listOpenSales,
  openSale,
  startTableSession,
} from '@/services/bills';
import { getStock, listProducts, restockProduct, saveTable } from '@/services/catalog';
import { addManualDebt, deleteLedgerEntry, getCustomer, getLedger, listCustomers, repayDebt, saveCustomer } from '@/services/customers';
import { getReport, periodFor } from '@/services/reports';
import { getSettings, setSetting } from '@/services/settings';
import { bindHall, outboxCount, syncOnce, wipeLocal } from '@/sync/engine';
import { fakeServer } from '../test/fakeServer';
import { createEmptyDb, createMigratedDb } from '../test/nodeDb';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 8, 29, 20, 0, 0).getTime();
const rounding = { step: 1000, mode: 'up' as const };
const noPay = { cash: 0, card: 0, transfer: 0 };
const cash = (amount: number) => ({ ...noPay, cash: amount });
const dayReport = (d: RootDb, at = T0) => getReport(d, periodFor('day', 0, at, 6), 6);

const outbox = (db: RootDb) => db.getAllAsync<{ tbl: string; uid: string; deleted: number }>('SELECT tbl, uid, deleted FROM sync_outbox ORDER BY seq', []);

describe('outbox triggerlari', () => {
  it('har o‘zgarish outbox’ga tushadi, updated_at o‘zi oshadi, server yozuvlari tushmaydi', async () => {
    const db = await createEmptyDb();
    expect(await outboxCount(db)).toBe(0);

    await saveTable(db, { name: 'Stol 1', hourly_rate: 30000 }, T0);
    await setSetting(db, 'hall_name', 'Grand');
    expect((await outbox(db)).map((r) => r.tbl)).toEqual(['tables', 'settings']);
    const s = await db.getFirstAsync<{ updated_at: number }>("SELECT updated_at FROM settings WHERE key = 'hall_name'", []);
    expect(s!.updated_at).toBeGreaterThan(0); // servis vaqt yozmasa ham

    // Bitta qator ikki marta o'zgarsa outbox'da bitta yozuv qoladi.
    const bill = await openSale(db, T0);
    const item = await addItem(db, bill, 1, 1, T0).catch(() => null);
    expect(item).toBeNull(); // mahsulot yo'q
    await setSetting(db, 'hall_name', 'Grand Biliard');
    expect((await outbox(db)).filter((r) => r.tbl === 'settings')).toHaveLength(1);

    // Hisob o'chirilsa — o'chirish belgisi.
    await cancelBill(db, bill, '', T0);
    expect((await outbox(db)).find((r) => r.tbl === 'bills')).toMatchObject({ deleted: 1 });

    // Server yozuvlari (applying = 1) outbox'ga tushmaydi.
    await db.runAsync('DELETE FROM sync_outbox', []);
    await db.runAsync('UPDATE sync_state SET applying = 1', []);
    await saveTable(db, { name: 'Stol 2', hourly_rate: 30000 }, T0);
    await db.runAsync('UPDATE sync_state SET applying = 0', []);
    expect(await outboxCount(db)).toBe(0);
  });

  it('v1 dan yangilanganda mavjud ma’lumot outbox’ga tushadi (birinchi kirishda serverga chiqadi)', async () => {
    const db = await createMigratedDb();
    const n = await outboxCount(db);
    expect(n).toBe(4 + 4 + 6); // stollar, mahsulotlar, xarajat turlari
  });
});

describe('ikki qurilma server orqali', () => {
  it('egasi va sherigi: hisob, qarz, ombor, hisobot, ochiq hisob va bekor qilish', async () => {
    const server = fakeServer();
    const a = await createMigratedDb(); // egasi: v1 dan qolgan ma'lumot bilan
    const b = await createEmptyDb(); // sherigi: yangi o'rnatgan
    const A = server.device('device-a');
    const B = server.device('device-b');

    await saveTable(a, { id: 1, name: 'VIP 1', hourly_rate: 50000 }, T0);
    const aziz = await saveCustomer(a, { name: 'Aziz aka', phone: '+998901112233' }, T0);
    await restockProduct(a, { productId: 4, qty: 12, totalCost: 60000, method: 'cash', now: T0 });
    const aBill = await startTableSession(a, 1, T0);
    await addItem(a, aBill, 4, 2, T0);
    await closeBill(a, aBill, { now: T0 + HOUR, rounding, payment: cash(30000), customerId: aziz });
    const tab = await openSale(a, T0 + 2 * HOUR, { label: 'Jasur' });
    await addItem(a, tab, 1, 2, T0 + 2 * HOUR);
    await setSetting(a, 'hall_name', 'Grand Biliard');

    await syncOnce(a, A);
    expect(await outboxCount(a)).toBe(0);
    await syncOnce(b, B);

    const hallB = await listHall(b);
    expect(hallB).toHaveLength(4);
    expect(hallB.find((t) => t.name === 'VIP 1')).toMatchObject({ hourly_rate: 50000 });
    const cola = (await listProducts(b)).find((p) => p.name === 'Coca-Cola 0.5 L')!;
    expect(await getStock(b, cola.id)).toBe(10);
    const azizB = (await listCustomers(b)).find((c) => c.name === 'Aziz aka')!;
    expect(azizB.balance).toBe(40000);
    expect((await dayReport(b)).revenue).toEqual((await dayReport(a)).revenue);
    expect((await dayReport(b)).cash).toEqual((await dayReport(a)).cash);
    expect(await listOpenSales(b)).toEqual([expect.objectContaining({ label: 'Jasur', items_amount: 10000, items_count: 2 })]);
    expect((await getSettings(b)).hallName).toBe('Grand Biliard');

    // B: qarz to'landi va ochiq hisobga mahsulot qo'shdi → A ga yetadi.
    const tabB = (await listOpenSales(b))[0].id;
    await repayDebt(b, azizB.id, 10000, 'cash', '', T0 + 3 * HOUR);
    await addItem(b, tabB, 1, 1, T0 + 3 * HOUR);
    await syncOnce(b, B);
    await syncOnce(a, A);
    expect((await getCustomer(a, aziz))!.balance).toBe(30000);
    expect((await listOpenSales(a))[0]).toMatchObject({ items_count: 3 });

    // A: chek bekor qilindi, ochiq hisobdan mahsulot butunlay olib tashlandi → B da ham.
    await cancelBill(a, aBill, 'xato', T0 + 4 * HOUR);
    const detail = (await getBillDetail(a, tab))!;
    for (let i = 0; i < 3; i++) await changeItemQty(a, detail.items[0].id, -1);
    await syncOnce(a, A);
    await syncOnce(b, B);
    expect((await dayReport(b)).revenue.total).toBe(0);
    expect((await getCustomer(b, azizB.id))!.balance).toBe(-10000);
    expect(await getStock(b, cola.id)).toBe(12);
    expect(await listOpenSales(b)).toEqual([expect.objectContaining({ items_count: 0 })]);

    // Takroriy sinxron hech narsa o'zgartirmaydi.
    expect(await syncOnce(b, B)).toMatchObject({ pushed: 0 });
  });

  it('qo‘lda yozilgan qarzni o‘chirish ham boshqa qurilmaga o‘tadi', async () => {
    const server = fakeServer();
    const a = await createEmptyDb();
    const b = await createEmptyDb();
    const c = await saveCustomer(a, { name: 'Jasur' }, T0);
    await addManualDebt(a, c, 50000, 'eski qarz', T0);
    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    const jasurB = (await listCustomers(b))[0];
    expect(jasurB.balance).toBe(50000);

    await deleteLedgerEntry(a, (await getLedger(a, c))[0], T0 + HOUR);
    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    expect((await getCustomer(b, jasurB.id))!.balance).toBe(0);
  });

  it('birinchi sinxronda bir xil nomli stol va mijoz ikki marta paydo bo‘lmaydi', async () => {
    const server = fakeServer();
    const a = await createMigratedDb();
    const b = await createMigratedDb();
    await saveTable(a, { name: 'VIP', hourly_rate: 60000 }, T0);
    await saveTable(b, { name: 'vip ', hourly_rate: 55000 }, T0 - HOUR);
    await saveCustomer(a, { name: 'Aziz aka', phone: '+998901112233' }, T0);
    await saveCustomer(b, { name: 'aziz aka' }, T0 - HOUR);

    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    await syncOnce(a, server.device('a'));

    for (const db of [a, b]) {
      expect((await listHall(db)).filter((t) => t.name.trim().toLowerCase() === 'vip')).toHaveLength(1);
      expect(await listCustomers(db)).toHaveLength(1);
    }
    expect(server.count('tables')).toBe(5);
    expect(server.count('customers')).toBe(1);
    expect((await listHall(b)).find((t) => t.name === 'VIP')!.hourly_rate).toBe(60000); // A ning nusxasi yangiroq
  });

  it('joy turi va vaqtli seans muddati boshqa qurilmaga o‘tadi (ovoz u yerda ham rejalashtiriladi)', async () => {
    const server = fakeServer();
    const a = await createEmptyDb();
    const b = await createEmptyDb();
    const psId = await saveTable(a, { name: 'PS 1', hourly_rate: 20000, kind: 'ps' }, T0);
    const billId = await startTableSession(a, psId, T0, { plannedMinutes: 60 });
    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    const psB = (await listHall(b)).find((t) => t.name === 'PS 1')!;
    expect(psB).toMatchObject({ kind: 'ps', planned_minutes: 60 });

    // B da uzaytirildi → A ga yetadi.
    await extendPlanned(b, psB.bill_id!, 30, T0 + 55 * MIN);
    await syncOnce(b, server.device('b'));
    await syncOnce(a, server.device('a'));
    expect((await getBillDetail(a, billId))!.bill.planned_minutes).toBe(90);
  });

  it('oxirgi o‘zgarish yutadi', async () => {
    const server = fakeServer();
    const a = await createEmptyDb();
    const b = await createEmptyDb();
    const c = await saveCustomer(a, { name: 'Anvar' }, T0);
    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    const cb = (await listCustomers(b))[0].id;

    await saveCustomer(a, { id: c, name: 'Anvar (A)' }, T0 + MIN);
    await saveCustomer(b, { id: cb, name: 'Anvar (B)' }, T0 + 2 * MIN);
    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    await syncOnce(a, server.device('a'));
    expect((await getCustomer(a, c))!.name).toBe('Anvar (B)');
    expect((await getCustomer(b, cb))!.name).toBe('Anvar (B)');
  });

  it('chek mahsuloti chekdan oldin kelsa ham yo‘qolmaydi (sahifalarga bo‘lingan pull)', async () => {
    const server = fakeServer({ maxPull: 1 });
    const a = await createEmptyDb();
    const b = await createEmptyDb();
    const t = await saveTable(a, { name: 'Stol 1', hourly_rate: 30000 }, T0);
    const bill = await startTableSession(a, t, T0);
    await syncOnce(a, server.device('a'));
    await a.runAsync("INSERT INTO products (uid, name, category, price, track_stock) VALUES ('p1', 'Choy', '', 5000, 0)", []);
    await addItem(a, bill, 1, 2, T0 + MIN);
    await syncOnce(a, server.device('a'));
    // Chek yopildi — chek qatori serverda mahsulotdan keyingi rev oladi.
    await closeBill(a, bill, { now: T0 + HOUR, rounding, payment: cash(40000), customerId: null });
    await syncOnce(a, server.device('a'));

    const res = await syncOnce(b, server.device('b'));
    expect(res.pending).toBe(0);
    const billB = await b.getFirstAsync<{ id: number; status: string }>('SELECT id, status FROM bills', []);
    expect(billB!.status).toBe('closed');
    expect((await getBillDetail(b, billB!.id))!.items).toHaveLength(1);
  });

  it('ikki qurilma oflaynda bitta stolni ochsa ham ikkala hisob saqlanadi', async () => {
    const server = fakeServer();
    const a = await createEmptyDb();
    const b = await createEmptyDb();
    await saveTable(a, { name: 'Stol 1', hourly_rate: 30000 }, T0);
    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    await startTableSession(a, 1, T0);
    await startTableSession(b, 1, T0 + MIN);
    await syncOnce(a, server.device('a'));
    await syncOnce(b, server.device('b'));
    await syncOnce(a, server.device('a'));
    for (const db of [a, b]) {
      expect(await db.getAllAsync("SELECT id FROM bills WHERE status = 'open'", [])).toHaveLength(2);
    }
  });

  it('boshqa qurilmada tarix tozalansa lokal baza serverdan qaytadan yuklanadi', async () => {
    const server = fakeServer();
    const a = await createMigratedDb();
    const bill = await startTableSession(a, 1, T0);
    await closeBill(a, bill, { now: T0 + HOUR, rounding, payment: cash(30000), customerId: null });
    await syncOnce(a, server.device('a'));

    server.reset(['bills', 'bill_items', 'payments', 'debts', 'expenses', 'stock_moves', 'customers']);
    await syncOnce(a, server.device('a'));
    expect((await dayReport(a)).revenue.total).toBe(0);
    expect(await listHall(a)).toHaveLength(4);

    // Eski epoch bilan yuborilgan o'zgarish ham to'g'ri tiklanadi.
    await startTableSession(a, (await listHall(a))[1].id, T0 + 2 * HOUR);
    server.reset(['bills']);
    await syncOnce(a, server.device('a'));
    expect(await a.getAllAsync('SELECT id FROM bills', [])).toHaveLength(0);
  });

  it('boshqa biliardxonaga kirilsa lokal ma’lumot tozalanadi', async () => {
    const db = await createMigratedDb();
    await bindHall(db, 'hall-1');
    expect(await listHall(db)).toHaveLength(4);
    await bindHall(db, 'hall-1');
    expect(await listHall(db)).toHaveLength(4);
    await bindHall(db, 'hall-2');
    expect(await listHall(db)).toHaveLength(0);
    expect(await outboxCount(db)).toBe(0);
    await wipeLocal(db);
  });
});
