// Obuna hisob-kitobining sof funksiyalari (bazaga bog'liq emas — testlarda alohida tekshiriladi).
//
// Balans modeli: biliardxona hisobiga pul tushadi (tasdiqlangan cheklar), sinovdan keyin har kuni
// "30 kunlik narx / 30" yechiladi. Pul tugasa balans minusga ketadi — imtiyoz kunlari ham yechiladi,
// imtiyoz tugagach ilova faqat ko'rish rejimiga o'tadi va yechish to'xtaydi.
import type { SubState } from '../contract.ts';

export const DAY_MS = 86_400_000;
/** Admin belgilaydigan narx shuncha kunlik. */
export const MONTH_DAYS = 30;

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

const maxDate = (...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

/** Kunlik yechiladigan summa (so'm). */
export const dailyPrice = (monthly: number) => Math.max(0, Math.round(monthly / MONTH_DAYS));

export interface BillingState {
  createdAt: Date;
  trialEndsAt: Date | null;
  balance: number;
  paidThrough: Date | null;
  debtSince: Date | null;
}

/** Kunlik yechish qaysi vaqtdan boshlanadi: oxirgi yechilgan kun tugashi, bo'lmasa sinov tugashi yoki ochilgan vaqt. */
export const chargeStart = (h: BillingState) => h.paidThrough ?? h.trialEndsAt ?? h.createdAt;

export interface Status {
  state: SubState;
  /** Pul (yoki sinov) qachongacha yetadi. null — muddatsiz (kunlik narx 0). */
  endsAt: Date | null;
  graceEndsAt: Date | null;
  readOnly: boolean;
  daysLeft: number;
}

/** Muddatsiz (kunlik narx 0) holatda ko'rsatiladigan "qolgan kunlar". */
export const UNLIMITED_DAYS = 9999;

export function computeStatus(h: BillingState, graceDays: number, daily: number, now: Date): Status {
  const inTrial = !!h.trialEndsAt && now < h.trialEndsAt;
  if (h.balance >= 0) {
    if (daily <= 0) return { state: inTrial ? 'trial' : 'active', endsAt: null, graceEndsAt: null, readOnly: false, daysLeft: UNLIMITED_DAYS };
    const endsAt = addDays(chargeStart(h), Math.floor(h.balance / daily));
    return {
      state: inTrial ? 'trial' : 'active',
      endsAt,
      graceEndsAt: addDays(endsAt, graceDays),
      readOnly: false,
      daysLeft: Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS),
    };
  }
  const since = h.debtSince ?? chargeStart(h);
  const graceEndsAt = addDays(since, graceDays);
  const state: SubState = inTrial ? 'trial' : now < graceEndsAt ? 'grace' : 'expired';
  return {
    state,
    endsAt: since,
    graceEndsAt,
    readOnly: state === 'expired',
    daysLeft: Math.ceil((since.getTime() - now.getTime()) / DAY_MS),
  };
}

export interface Charge {
  /** Yechilgan kun boshlanishi. */
  from: Date;
  amount: number;
  balanceAfter: number;
}

export interface ChargeResult {
  balance: number;
  paidThrough: Date;
  debtSince: Date | null;
  charges: Charge[];
}

/**
 * Vaqti kelgan kunlarni yechadi: `paidThrough <= now` bo'lgan har kun uchun kunlik narx.
 * Sinov ichida yechilmaydi. Balans minusga o'tgan kundan imtiyoz sanaladi; imtiyoz oynasidan
 * keyingi kunlar yechilmaydi (faqat-ko'rish rejimi — `paidThrough` joyida qoladi).
 */
export function chargeDue(h: BillingState, daily: number, graceDays: number, now: Date): ChargeResult {
  let balance = h.balance;
  let debtSince = h.debtSince;
  let paidThrough = chargeStart(h);
  const charges: Charge[] = [];
  if (h.trialEndsAt && now < h.trialEndsAt) return { balance, paidThrough, debtSince, charges };
  while (paidThrough <= now) {
    if (balance < 0 && debtSince && paidThrough >= addDays(debtSince, graceDays)) break;
    balance -= daily;
    charges.push({ from: paidThrough, amount: daily, balanceAfter: balance });
    if (balance < 0 && !debtSince) debtSince = paidThrough;
    paidThrough = addDays(paidThrough, 1);
  }
  return { balance, paidThrough, debtSince, charges };
}

/**
 * To'lov tushdi: balans oshadi, qarz yopilsa `debtSince` tozalanadi. Biliardxona faqat-ko'rish rejimida
 * bo'lgan bo'lsa (yechish to'xtagan), yechish hozirdan qayta boshlanadi — o'tgan bo'sh kunlar uchun pul olinmaydi.
 */
export function applyPayment(h: BillingState, amount: number, graceDays: number, daily: number, now: Date): BillingState {
  const wasExpired = computeStatus(h, graceDays, daily, now).state === 'expired';
  const balance = h.balance + amount;
  return {
    ...h,
    balance,
    debtSince: balance >= 0 ? null : h.debtSince,
    paidThrough: wasExpired ? now : h.paidThrough,
  };
}

/** Sinovni uzaytirish: hozirgi sinov (yoki hozir) ustiga; shu davrda yechilmaydi. */
export function extendTrial(h: BillingState, days: number, now: Date): BillingState {
  const trialEndsAt = addDays(maxDate(h.trialEndsAt, now)!, days);
  const paidThrough = h.paidThrough && h.paidThrough < trialEndsAt ? trialEndsAt : h.paidThrough;
  return { ...h, trialEndsAt, paidThrough };
}

export interface DiscountLike {
  id: number;
  percent: number | null;
  amount: number | null;
}

/** Narx 1 000 so'mga yaxlitlanadi, manfiy bo'lmaydi. */
export const roundPrice = (p: number) => Math.max(0, Math.round(p / 1000) * 1000);

/** Chegirma qo'llangan 30 kunlik narx. Bir nechta chegirma bo'lsa qo'shilmaydi — eng arzon narx beradigani olinadi. */
export function effectivePrice<D extends DiscountLike>(base: number, active: D[]): { price: number; discount: D | null } {
  let best: { price: number; discount: D | null } = { price: base, discount: null };
  for (const d of active) {
    const raw = d.percent != null ? (base * (100 - d.percent)) / 100 : base - (d.amount ?? 0);
    const price = roundPrice(raw);
    if (price < best.price) best = { price, discount: d };
  }
  return best;
}
