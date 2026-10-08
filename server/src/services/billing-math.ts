// Obuna hisob-kitobining sof funksiyalari (bazaga bog'liq emas — testlarda alohida tekshiriladi).
import type { SubState } from '../contract.ts';

export const DAY_MS = 86_400_000;
/** To'lov summasini kunga aylantirishda bir oy shuncha kun deb olinadi. */
export const MONTH_DAYS = 30;

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

/** Oy qo'shish: 31-yanvar + 1 oy = 28/29-fevral (keyingi oyga o'tib ketmaydi). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

const maxDate = (...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

export interface StatusInput {
  trialEndsAt: Date | null;
  paidUntil: Date | null;
}

export interface Status {
  state: SubState;
  endsAt: Date | null;
  graceEndsAt: Date | null;
  readOnly: boolean;
  daysLeft: number;
}

/**
 * Obuna holati: to'langan muddat ichida — `active`, sinov ichida — `trial`,
 * tugagach `graceDays` kun — `grace` (hali ishlaydi), keyin — `expired` (faqat ko'rish).
 */
export function computeStatus(h: StatusInput, graceDays: number, now: Date): Status {
  const endsAt = maxDate(h.trialEndsAt, h.paidUntil);
  if (!endsAt) return { state: 'expired', endsAt: null, graceEndsAt: null, readOnly: true, daysLeft: 0 };
  const graceEndsAt = addDays(endsAt, graceDays);
  const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS);
  let state: SubState;
  if (h.paidUntil && h.paidUntil > now) state = 'active';
  else if (h.trialEndsAt && h.trialEndsAt > now) state = 'trial';
  else if (graceEndsAt > now) state = 'grace';
  else state = 'expired';
  return { state, endsAt, graceEndsAt, readOnly: state === 'expired', daysLeft };
}

export interface DiscountLike {
  id: number;
  percent: number | null;
  amount: number | null;
}

/** Narx 1 000 so'mga yaxlitlanadi, manfiy bo'lmaydi. */
export const roundPrice = (p: number) => Math.max(0, Math.round(p / 1000) * 1000);

/** Chegirma qo'llangan narx. Bir nechta chegirma bo'lsa qo'shilmaydi — eng arzon narx beradigani olinadi. */
export function effectivePrice<D extends DiscountLike>(base: number, active: D[]): { price: number; discount: D | null } {
  let best: { price: number; discount: D | null } = { price: base, discount: null };
  for (const d of active) {
    const raw = d.percent != null ? (base * (100 - d.percent)) / 100 : base - (d.amount ?? 0);
    const price = roundPrice(raw);
    if (price < best.price) best = { price, discount: d };
  }
  return best;
}

/** To'langan summa necha kunga yetadi (oylik narx bo'yicha). Narx 0 bo'lsa kunni admin o'zi kiritadi. */
export function daysForAmount(amount: number, monthlyPrice: number): number {
  if (monthlyPrice <= 0 || amount <= 0) return 0;
  return Math.round((amount * MONTH_DAYS) / monthlyPrice);
}

/** Yangi to'langan muddat: hozirgi muddat (sinov ham) tugamagan bo'lsa uning ustiga qo'shiladi. */
export function extendPaidUntil(h: StatusInput, days: number, now: Date): Date {
  const base = maxDate(now, h.paidUntil, h.trialEndsAt) ?? now;
  return addDays(base, days);
}
