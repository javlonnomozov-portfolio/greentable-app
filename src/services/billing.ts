/**
 * Hisob-kitobning sof funksiyalari. Ma'lumotlar bazasiga bog'liq emas,
 * shuning uchun alohida test qilinadi.
 */

export type RoundingMode = 'up' | 'nearest' | 'down';

export interface RoundingSettings {
  /** 0 — yaxlitlanmaydi. */
  step: number;
  mode: RoundingMode;
}

export interface TimerState {
  started_at: number;
  ended_at: number | null;
  paused_at: number | null;
  paused_ms: number;
  /** Stol almashtirilganda oldingi stolda o'tgan vaqt. */
  carried_ms: number;
}

const MINUTE = 60_000;

/** Joriy stoldagi sof o'yin vaqti (pauzalarsiz). */
export function calcSegmentMs(t: TimerState, now: number): number {
  const end = t.ended_at ?? now;
  const openPause = t.paused_at != null ? Math.max(0, end - t.paused_at) : 0;
  return Math.max(0, end - t.started_at - t.paused_ms - openPause);
}

/** Butun seans davomidagi o'yin vaqti (stol almashtirishlar bilan). */
export function calcElapsedMs(t: TimerState, now: number): number {
  return t.carried_ms + calcSegmentMs(t, now);
}

/** Boshlangan har bir daqiqa to'liq hisoblanadi. */
export function billableMinutes(ms: number): number {
  return Math.ceil(ms / MINUTE);
}

/** Bitta stoldagi vaqt narxi (yaxlitlashsiz). */
export function segmentCharge(ms: number, hourlyRate: number): number {
  return Math.round((billableMinutes(ms) * hourlyRate) / 60);
}

export function applyRounding(amount: number, { step, mode }: RoundingSettings): number {
  if (step <= 0 || amount <= 0) return amount;
  const units = amount / step;
  const rounded = mode === 'up' ? Math.ceil(units) : mode === 'down' ? Math.floor(units) : Math.round(units);
  return rounded * step;
}

export interface TimeCharge {
  minutes: number;
  raw: number;
  amount: number;
  roundingAdj: number;
}

export function calcTimeCharge(
  t: TimerState & { hourly_rate: number; carried_amount: number },
  now: number,
  rounding: RoundingSettings,
): TimeCharge {
  const minutes = billableMinutes(calcElapsedMs(t, now));
  const raw = t.carried_amount + segmentCharge(calcSegmentMs(t, now), t.hourly_rate);
  const amount = applyRounding(raw, rounding);
  return { minutes, raw, amount, roundingAdj: amount - raw };
}

/**
 * Admin kelishishi mumkin bo'lgan yaxlit summalar (masalan 112 000 → 100 000, 110 000, 115 000, 120 000).
 * Hisoblangan summaning o'zi ro'yxatga kirmaydi.
 */
export function amountSuggestions(amount: number): number[] {
  if (amount <= 0) return [];
  const floor = (step: number) => Math.floor(amount / step) * step;
  const ceil = (step: number) => Math.ceil(amount / step) * step;
  const candidates = [floor(50_000), floor(10_000), floor(5_000), ceil(5_000), ceil(10_000)];
  return [...new Set(candidates)].filter((v) => v > 0 && v !== amount).sort((a, b) => a - b);
}

export interface PaymentInput {
  cash: number;
  card: number;
  transfer: number;
}

export interface PaymentSplit {
  /** Kassaga haqiqatda tushadigan summalar (qaytim ayirilgan). */
  cash: number;
  card: number;
  transfer: number;
  paid: number;
  debt: number;
  /** Mijozga qaytariladigan naqd pul. */
  change: number;
}

export class PaymentError extends Error {}

/**
 * To'lovni taqsimlaydi: ortiqcha summa faqat naqddan qaytim sifatida qaytariladi,
 * yetmagan qismi qarzga yoziladi.
 */
export function splitPayment(total: number, input: PaymentInput): PaymentSplit {
  const { cash, card, transfer } = input;
  if (cash < 0 || card < 0 || transfer < 0) throw new PaymentError("To'lov summasi manfiy bo'lishi mumkin emas");
  const given = cash + card + transfer;
  const change = Math.max(0, given - total);
  if (change > cash) {
    throw new PaymentError("Karta yoki o'tkazma orqali hisobdan ortiq to'lab bo'lmaydi");
  }
  const netCash = cash - change;
  const paid = netCash + card + transfer;
  return { cash: netCash, card, transfer, paid, debt: total - paid, change };
}
