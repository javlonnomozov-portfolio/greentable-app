import { describe, expect, it } from 'vitest';
import {
  UNLIMITED_DAYS,
  applyPayment,
  chargeDue,
  computeStatus,
  dailyPrice,
  effectivePrice,
  extendTrial,
  type BillingState,
} from '../src/services/billing-math.ts';
import { at } from './helpers.ts';

const DAILY = dailyPrice(90_000); // 3 000
const GRACE = 3;
const base: BillingState = { createdAt: at(0), trialEndsAt: at(14), balance: 0, paidThrough: null, debtSince: null };

describe('kunlik narx va holat', () => {
  it('30 kunlik narx / 30', () => {
    expect(dailyPrice(90_000)).toBe(3000);
    expect(dailyPrice(100_000)).toBe(3333);
    expect(dailyPrice(0)).toBe(0);
  });

  it('sinov ichida to‘langan pul sinovdan keyin sanaladi', () => {
    expect(computeStatus(base, GRACE, DAILY, at(1))).toMatchObject({ state: 'trial', endsAt: at(14), daysLeft: 13 });
    const paid = { ...base, balance: 90_000 };
    expect(computeStatus(paid, GRACE, DAILY, at(1))).toMatchObject({ state: 'trial', endsAt: at(44) });
  });

  it('kunlik narx 0 (100% chegirma) — muddatsiz', () => {
    expect(computeStatus({ ...base, trialEndsAt: null }, GRACE, 0, at(20))).toMatchObject({ state: 'active', endsAt: null, daysLeft: UNLIMITED_DAYS });
  });
});

describe('kunlik yechish', () => {
  it('sinov ichida yechilmaydi, keyin har kuni; minusga o‘tgach imtiyoz, keyin to‘xtaydi', () => {
    expect(chargeDue(base, DAILY, GRACE, at(10)).charges).toHaveLength(0);

    let h: BillingState = { ...base, balance: 6000 };
    let r = chargeDue(h, DAILY, GRACE, at(15.5)); // 14-kun va 15-kun
    expect(r).toMatchObject({ balance: 0, paidThrough: at(16), debtSince: null });
    expect(r.charges.map((c) => c.balanceAfter)).toEqual([3000, 0]);
    h = { ...h, ...r };
    expect(computeStatus(h, GRACE, DAILY, at(15.5))).toMatchObject({ state: 'active', endsAt: at(16) });

    r = chargeDue(h, DAILY, GRACE, at(16.2)); // pul tugadi → minus, imtiyoz boshlandi
    expect(r).toMatchObject({ balance: -3000, debtSince: at(16) });
    h = { ...h, ...r };
    expect(computeStatus(h, GRACE, DAILY, at(17))).toMatchObject({ state: 'grace', graceEndsAt: at(19), readOnly: false });

    r = chargeDue(h, DAILY, GRACE, at(30)); // imtiyoz kunlari (17, 18) yechiladi, keyin to'xtaydi
    expect(r).toMatchObject({ balance: -9000, paidThrough: at(19) });
    h = { ...h, ...r };
    expect(computeStatus(h, GRACE, DAILY, at(30))).toMatchObject({ state: 'expired', readOnly: true });
    expect(chargeDue(h, DAILY, GRACE, at(40)).charges).toHaveLength(0);
  });

  it('to‘lov avval qarzni yopadi; faqat-ko‘rishdan keyin yechish hozirdan qayta boshlanadi', () => {
    const expired: BillingState = { ...base, balance: -9000, paidThrough: at(19), debtSince: at(16) };
    const paid = applyPayment(expired, 99_000, GRACE, DAILY, at(30));
    expect(paid).toMatchObject({ balance: 90_000, debtSince: null, paidThrough: at(30) });
    const r = chargeDue(paid, DAILY, GRACE, at(30));
    expect(r).toMatchObject({ balance: 87_000, paidThrough: at(31) });
    expect(computeStatus({ ...paid, ...r }, GRACE, DAILY, at(30))).toMatchObject({ state: 'active', endsAt: at(60) });

    // Imtiyoz ichida to'lansa — yechish tartibi saqlanadi.
    const grace: BillingState = { ...base, balance: -3000, paidThrough: at(17), debtSince: at(16) };
    expect(applyPayment(grace, 2000, GRACE, DAILY, at(17))).toMatchObject({ balance: -1000, debtSince: at(16), paidThrough: at(17) });
  });

  it('sinovni uzaytirish', () => {
    expect(extendTrial(base, 7, at(3)).trialEndsAt).toEqual(at(21));
    const running: BillingState = { ...base, paidThrough: at(20) };
    expect(extendTrial(running, 10, at(19))).toMatchObject({ trialEndsAt: at(29), paidThrough: at(29) });
  });
});

describe('chegirma', () => {
  it('eng katta chegirma olinadi, qo‘shilmaydi, 1 000 ga yaxlitlanadi', () => {
    const d = [
      { id: 1, percent: 15, amount: null },
      { id: 2, percent: null, amount: 20_000 },
      { id: 3, percent: 33, amount: null },
    ];
    expect(effectivePrice(100_000, d)).toEqual({ price: 67_000, discount: d[2] });
    expect(effectivePrice(99_000, [{ id: 1, percent: 15, amount: null }]).price).toBe(84_000);
    expect(effectivePrice(100_000, [])).toEqual({ price: 100_000, discount: null });
  });
});
