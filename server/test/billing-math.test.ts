import { describe, expect, it } from 'vitest';
import { addMonths, computeStatus, daysForAmount, effectivePrice, extendPaidUntil } from '../src/services/billing-math.ts';
import { at, T0 } from './helpers.ts';

describe('obuna holati', () => {
  it('sinov → imtiyoz → faqat ko‘rish', () => {
    const h = { trialEndsAt: at(14), paidUntil: null };
    expect(computeStatus(h, 3, at(0))).toMatchObject({ state: 'trial', readOnly: false, daysLeft: 14 });
    expect(computeStatus(h, 3, at(15))).toMatchObject({ state: 'grace', readOnly: false, daysLeft: -1 });
    expect(computeStatus(h, 3, at(17.5))).toMatchObject({ state: 'expired', readOnly: true });
  });

  it('to‘langan muddat sinovdan ustun', () => {
    expect(computeStatus({ trialEndsAt: at(14), paidUntil: at(40) }, 3, at(1)).state).toBe('active');
    expect(computeStatus({ trialEndsAt: null, paidUntil: null }, 3, at(1))).toMatchObject({ state: 'expired', endsAt: null });
  });
});

describe('narx va chegirma', () => {
  it('eng katta chegirma olinadi, qo‘shilmaydi, 1 000 ga yaxlitlanadi', () => {
    const d = [
      { id: 1, percent: 15, amount: null },
      { id: 2, percent: null, amount: 20_000 },
      { id: 3, percent: 33, amount: null },
    ];
    expect(effectivePrice(100_000, d)).toEqual({ price: 67_000, discount: d[2] });
    expect(effectivePrice(99_000, [{ id: 1, percent: 15, amount: null }]).price).toBe(84_000); // 84 150
    expect(effectivePrice(100_000, [])).toEqual({ price: 100_000, discount: null });
    expect(effectivePrice(10_000, [{ id: 1, percent: null, amount: 50_000 }]).price).toBe(0);
  });

  it('summa → kunlar', () => {
    expect(daysForAmount(100_000, 100_000)).toBe(30);
    expect(daysForAmount(150_000, 100_000)).toBe(45);
    expect(daysForAmount(80_000, 80_000)).toBe(30);
    expect(daysForAmount(50_000, 0)).toBe(0);
  });

  it('muddat sinov yoki eski muddat ustiga qo‘shiladi', () => {
    expect(extendPaidUntil({ trialEndsAt: at(10), paidUntil: null }, 30, at(2))).toEqual(at(40));
    expect(extendPaidUntil({ trialEndsAt: at(10), paidUntil: null }, 30, at(20))).toEqual(at(50));
    expect(extendPaidUntil({ trialEndsAt: null, paidUntil: at(5) }, 30, at(1))).toEqual(at(35));
  });

  it('oy qo‘shish oy oxirida keyingi oyga o‘tib ketmaydi', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(T0, 3).toISOString()).toBe('2027-01-01T09:00:00.000Z');
  });
});
