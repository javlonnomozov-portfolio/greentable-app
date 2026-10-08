import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { authenticate, bindLogin, confirmLogin, pollLogin, rejectLogin, startLogin } from '../src/services/auth.ts';
import { adjustSubscription, approveReceipt, createReceipt, hallBilling, quote, rejectReceipt } from '../src/services/billing.ts';
import { createDiscount, redeemPromo } from '../src/services/discounts.ts';
import { acceptInvite, createHall, createInvite, hasDeviceSlot, memberRole, revokeDevice } from '../src/services/halls.ts';
import { updatePricing } from '../src/services/pricing.ts';
import { EpochMismatch, pullChanges, pushChanges, resetHallData } from '../src/services/sync.ts';
import { at, makeUser, testDb, T0 } from './helpers.ts';

let database: Database;
let db: Database['db'];

beforeEach(async () => {
  database = await testDb();
  db = database.db;
  await updatePricing(db, { monthlyPrice: 100_000, trialDays: 14, graceDays: 3, defaultDeviceLimit: 2 });
});
afterEach(() => database.close());

const discountBase = {
  code: null,
  percent: null,
  amount: null,
  validFrom: null,
  validTo: null,
  benefitMonths: null,
  maxUses: null,
  newOnly: false,
  active: true,
  note: null,
};

describe('biliardxona va sinov', () => {
  it('sinov bir marta: telegram akkaunt yoki telefon bo‘yicha', async () => {
    const u = await makeUser(db, { phone: '+998 90 111-22-33' });
    const h1 = await createHall(db, u, 'Grand', T0);
    expect(h1.trialEndsAt).toEqual(at(14));
    expect(await memberRole(db, h1.id, u.id)).toBe('owner');

    const again = await createHall(db, { ...u, trialUsedAt: T0 }, 'Ikkinchi', T0);
    expect(again.trialEndsAt).toBeNull();

    const samePhone = await makeUser(db, { phone: '998901112233' });
    expect((await createHall(db, samePhone, 'Boshqa akkaunt', T0)).trialEndsAt).toBeNull();
  });

  it('kampaniya oynasida ro‘yxatdan o‘tganlarga chegirma muddat bilan', async () => {
    await createDiscount(db, { ...discountBase, kind: 'campaign', percent: 30, validFrom: at(-1), validTo: at(5), benefitMonths: 2 });
    const inWindow = await createHall(db, await makeUser(db), 'A', T0);
    const late = await createHall(db, await makeUser(db), 'B', at(6));
    expect((await hallBilling(db, inWindow, at(1))).price).toBe(70_000);
    expect((await hallBilling(db, inWindow, at(70))).price).toBe(100_000); // 2 oydan keyin
    expect((await hallBilling(db, late, at(6))).price).toBe(100_000);
  });

  it('promo kod: oyna, limit, faqat yangilar, takror', async () => {
    await createDiscount(db, { ...discountBase, kind: 'promo', code: 'start50', percent: 50, maxUses: 1, validTo: at(10), newOnly: true });
    const a = await createHall(db, await makeUser(db), 'A', T0);
    const b = await createHall(db, await makeUser(db), 'B', T0);
    expect(await redeemPromo(db, a.id, 'nope', T0)).toEqual({ ok: false, reason: 'not_found' });
    expect((await redeemPromo(db, a.id, ' Start50 ', T0)).ok).toBe(true);
    expect((await hallBilling(db, a, T0)).price).toBe(50_000);
    expect(await redeemPromo(db, b.id, 'START50', T0)).toEqual({ ok: false, reason: 'closed' }); // limit 1

    await createDiscount(db, { ...discountBase, kind: 'promo', code: 'LOYAL', amount: 10_000 });
    expect((await redeemPromo(db, a.id, 'loyal', T0)).ok).toBe(true);
    expect(await redeemPromo(db, a.id, 'loyal', T0)).toEqual({ ok: false, reason: 'already' });
    expect((await hallBilling(db, a, T0)).price).toBe(50_000); // eng kattasi
  });
});

/** Bot: havolani ochgan foydalanuvchiga bog'laydi, u «Ha, bu men» ni bosadi. */
async function approve(token: string, userId: number, hallId: string, at: Date): Promise<boolean> {
  await bindLogin(db, token, userId, hallId, at);
  return !!(await confirmLogin(db, token, userId, at));
}

describe('kirish xavfsizligi', () => {
  it('havola bosilishi bilan kirilmaydi: faqat havolani ochgan odam tasdiqlaydi, rad etsa ilova kira olmaydi', async () => {
    const owner = await makeUser(db);
    const hall = await createHall(db, owner, 'Grand', T0);
    // Firibgar ilovada havola oldi va uni egaga yubordi; ega havolani ochdi.
    const { token } = await startLogin(db, { installId: 'firibgar-telefoni' }, T0);
    expect(await bindLogin(db, token, owner.id, hall.id, T0)).toBeTruthy();
    expect(await pollLogin(db, token, T0)).toEqual({ status: 'pending' });

    const stranger = await makeUser(db);
    expect(await confirmLogin(db, token, stranger.id, T0)).toBeUndefined();
    expect(await bindLogin(db, token, stranger.id, hall.id, T0)).toBeUndefined();

    expect(await rejectLogin(db, token, owner.id)).toBe(true);
    expect(await pollLogin(db, token, T0)).toEqual({ status: 'rejected' });
    expect(await confirmLogin(db, token, owner.id, T0)).toBeUndefined();

    // Bog'lanmagan so'rovni tasdiqlab bo'lmaydi.
    const fresh = await startLogin(db, { installId: 'x-1234567' }, T0);
    expect(await confirmLogin(db, fresh.token, owner.id, T0)).toBeUndefined();
  });
});

describe('kirish va qurilmalar', () => {
  it('login token bir martalik, qurilma limiti va bekor qilish', async () => {
    const u = await makeUser(db);
    const hall = await createHall(db, u, 'Grand', T0);

    const { token } = await startLogin(db, { installId: 'phone-1', model: 'S22' }, T0);
    expect(await pollLogin(db, token, T0)).toEqual({ status: 'pending' });
    expect(await approve(token, u.id, hall.id, T0)).toBe(true);
    const ok = await pollLogin(db, token, T0);
    expect(ok.status).toBe('ok');
    expect(await pollLogin(db, token, T0)).toEqual({ status: 'expired' });
    if (ok.status !== 'ok') throw new Error();
    expect((await authenticate(db, ok.deviceToken, T0))?.role).toBe('owner');

    // Muddati o'tgan so'rov tasdiqlanmaydi.
    const late = await startLogin(db, { installId: 'x' }, T0);
    expect(await approve(late.token, u.id, hall.id, new Date(T0.getTime() + 16 * 60_000))).toBe(false);

    // Limit 2: shu o'rnatishdan qayta kirish hisoblanmaydi.
    expect(await hasDeviceSlot(db, hall, 'phone-1')).toBe(true);
    const second = await startLogin(db, { installId: 'phone-2' }, T0);
    await approve(second.token, u.id, hall.id, T0);
    const s = await pollLogin(db, second.token, T0);
    expect(await hasDeviceSlot(db, hall, 'phone-3')).toBe(false);
    if (s.status !== 'ok') throw new Error();
    await revokeDevice(db, hall.id, s.deviceId, T0);
    expect(await authenticate(db, s.deviceToken, T0)).toBeNull();
    expect(await hasDeviceSlot(db, hall, 'phone-3')).toBe(true);

    // Qayta kirish eski tokenni bekor qiladi.
    const again = await startLogin(db, { installId: 'phone-1' }, T0);
    await approve(again.token, u.id, hall.id, T0);
    await pollLogin(db, again.token, T0);
    expect(await authenticate(db, ok.deviceToken, T0)).toBeNull();
  });

  it('taklif havolasi: sherik admin bo‘ladi, bir marta ishlaydi', async () => {
    const owner = await makeUser(db);
    const hall = await createHall(db, owner, 'Grand', T0);
    const { code } = await createInvite(db, hall.id, owner.id, T0);
    const partner = await makeUser(db);
    expect(await acceptInvite(db, code, partner, T0)).toMatchObject({ ok: true, already: false });
    expect(await memberRole(db, hall.id, partner.id)).toBe('admin');
    expect(await acceptInvite(db, code, await makeUser(db), T0)).toEqual({ ok: false, reason: 'used' });
    const old = await createInvite(db, hall.id, owner.id, T0);
    expect(await acceptInvite(db, old.code, await makeUser(db), at(8))).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('to‘lov cheki', () => {
  it('summa → kunlar (chegirma bilan), muddat sinov ustiga, qayta ko‘rib bo‘lmaydi', async () => {
    const u = await makeUser(db);
    const hall = await createHall(db, u, 'Grand', T0);
    await createDiscount(db, { ...discountBase, kind: 'promo', code: 'P20', percent: 20 });
    await redeemPromo(db, hall.id, 'P20', T0);

    const r = await createReceipt(db, { hallId: hall.id, userId: u.id, fileId: 'f1', fileKind: 'photo', mimeType: null, caption: null }, T0);
    const q = await quote(db, hall.id, 160_000, at(2));
    expect(q).toMatchObject({ price: 80_000, days: 60 });
    expect(q.paidUntil).toEqual(at(14 + 60));

    const res = await approveReceipt(db, r.id, { amount: 160_000, days: q.days }, at(2));
    expect(res.hall.paidUntil).toEqual(at(74));
    expect(res.receipt).toMatchObject({ status: 'approved', priceAtReview: 80_000, daysAdded: 60 });
    expect(res.telegramId).toBe(u.telegramId);
    await expect(approveReceipt(db, r.id, { amount: 1, days: 1 }, at(2))).rejects.toThrow('ko‘rib chiqilgan');

    const r2 = await createReceipt(db, { hallId: hall.id, userId: u.id, fileId: 'f2', fileKind: 'document', mimeType: 'application/pdf', caption: null }, at(3));
    expect((await rejectReceipt(db, r2.id, '  Summa ko‘rinmayapti ', at(3))).receipt).toMatchObject({ status: 'rejected', rejectReason: 'Summa ko‘rinmayapti' });

    const set = await adjustSubscription(db, hall.id, { paidUntil: at(100), note: 'kelishuv' }, at(3));
    expect(set.paidUntil).toEqual(at(100));
  });
});

describe('sinxronlash', () => {
  const change = (uid: string, updatedAt: number, data: Record<string, unknown> = {}, tbl = 'bills') => ({
    tbl,
    uid,
    updatedAt,
    deleted: false,
    data,
  });

  it('oxirgi yozuv yutadi, rev kursor, biliardxonalar ajratilgan, epoch', async () => {
    const hall = await createHall(db, await makeUser(db), 'A', T0);
    const other = await createHall(db, await makeUser(db), 'B', T0);
    const d1 = { hallId: hall.id, deviceId: '00000000-0000-0000-0000-000000000001' };
    const d2 = { hallId: hall.id, deviceId: '00000000-0000-0000-0000-000000000002' };

    expect(await pushChanges(db, d1, 1, [change('b1', 100, { v: 1 }), change('b2', 100, { v: 1 })])).toBe(2);
    expect(await pushChanges(db, d2, 1, [change('b1', 90, { v: 'old' })])).toBe(0); // eskirgan
    expect(await pushChanges(db, d2, 1, [change('b1', 200, { v: 2 }), change('b1', 150, { v: 'dup' })])).toBe(1);
    await pushChanges(db, { ...d1, hallId: other.id }, 1, [change('x', 1)]);

    const all = await pullChanges(db, hall.id, 0, 10, T0);
    expect(all.rows.map((r) => [r.uid, r.data.v])).toEqual([
      ['b2', 1],
      ['b1', 2],
    ]);
    const page = await pullChanges(db, hall.id, 0, 1, T0);
    expect(page).toMatchObject({ more: true });
    const rest = await pullChanges(db, hall.id, page.nextRev, 10, T0);
    expect(rest.rows.map((r) => r.uid)).toEqual(['b1']);
    expect((await pullChanges(db, hall.id, all.nextRev, 10, T0)).rows).toEqual([]);

    const epoch = await resetHallData(db, hall.id, ['bills']);
    expect(epoch).toBe(2);
    await expect(pushChanges(db, d1, 1, [change('b3', 1)])).rejects.toBeInstanceOf(EpochMismatch);
    const after = await pullChanges(db, hall.id, 0, 10, T0);
    expect(after).toMatchObject({ epoch: 2, rows: [] });
    expect((await pullChanges(db, other.id, 0, 10, T0)).rows).toHaveLength(1);
  });
});
