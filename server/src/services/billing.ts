import { and, desc, eq } from 'drizzle-orm';
import type { SubscriptionInfo } from '../contract.ts';
import type { Db } from '../db/client.ts';
import { halls, receipts, subscriptionEvents, users } from '../db/schema.ts';
import {
  applyPayment,
  chargeDue,
  computeStatus,
  dailyPrice,
  effectivePrice,
  extendTrial,
  type BillingState,
  type Charge,
  type Status,
} from './billing-math.ts';
import { activeHallDiscounts, discountLabel, type ActiveDiscount } from './discounts.ts';
import { getHall, type Hall } from './halls.ts';
import { getPricing, type Pricing } from './pricing.ts';

export type Receipt = typeof receipts.$inferSelect;

export interface HallBilling {
  hall: Hall;
  pricing: Pricing;
  status: Status;
  /** Chegirma bilan 30 kunlik narx. */
  price: number;
  daily: number;
  discount: ActiveDiscount | null;
}

export async function hallBilling(db: Db, hall: Hall, now: Date): Promise<HallBilling> {
  const pricing = await getPricing(db);
  const active = await activeHallDiscounts(db, hall.id, now);
  const { price, discount } = effectivePrice(pricing.monthlyPrice, active);
  const daily = dailyPrice(price);
  return { hall, pricing, status: computeStatus(hall, pricing.graceDays, daily, now), price, daily, discount };
}

export function toSubscriptionInfo(b: HallBilling): SubscriptionInfo {
  const { status, discount } = b;
  return {
    state: status.state,
    endsAt: status.endsAt?.getTime() ?? null,
    graceEndsAt: status.graceEndsAt?.getTime() ?? null,
    readOnly: status.readOnly || b.hall.blocked,
    daysLeft: status.daysLeft,
    monthlyPrice: b.pricing.monthlyPrice,
    price: b.price,
    dailyPrice: b.daily,
    balance: b.hall.balance,
    discount: discount
      ? { percent: discount.percent, amount: discount.amount, endsAt: discount.endsAt?.getTime() ?? null, label: discountLabel(discount) }
      : null,
  };
}

const stateOf = (h: Hall): BillingState => ({
  createdAt: h.createdAt,
  trialEndsAt: h.trialEndsAt,
  balance: h.balance,
  paidThrough: h.paidThrough,
  debtSince: h.debtSince,
});

/** Yechimlar va yangi holat bazaga yoziladi (tranzaksiya ichida, biliardxona qatori qulflangan holda). */
async function saveBilling(tx: Db, hallId: string, next: BillingState, charges: Charge[], now: Date): Promise<Hall> {
  const [hall] = await tx
    .update(halls)
    .set({ balance: next.balance, paidThrough: next.paidThrough, debtSince: next.debtSince, trialEndsAt: next.trialEndsAt })
    .where(eq(halls.id, hallId))
    .returning();
  if (charges.length) {
    await tx.insert(subscriptionEvents).values(
      charges.map((c) => ({ hallId, kind: 'charge' as const, amount: c.amount, fromDate: c.from, balanceAfter: c.balanceAfter, createdAt: now })),
    );
  }
  return hall;
}

/** Bitta biliardxonaning vaqti kelgan kunlarini yechadi. */
export async function chargeHall(db: Db, hallId: string, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const [hall] = await tx.select().from(halls).where(eq(halls.id, hallId)).for('update');
    if (!hall || hall.blocked) return 0;
    const { daily, pricing } = await hallBilling(tx, hall, now);
    const r = chargeDue(stateOf(hall), daily, pricing.graceDays, now);
    const changed = r.charges.length > 0 || hall.paidThrough?.getTime() !== r.paidThrough.getTime();
    if (changed && !(hall.trialEndsAt && now < hall.trialEndsAt)) {
      await saveBilling(tx, hall.id, { ...stateOf(hall), ...r }, r.charges, now);
    }
    return r.charges.length;
  });
}

/** Soatlik job: barcha biliardxonalarning kunlik to'lovi. */
export async function runBilling(db: Db, now: Date): Promise<number> {
  const rows = await db.select({ id: halls.id }).from(halls).where(eq(halls.blocked, false));
  let total = 0;
  for (const r of rows) total += await chargeHall(db, r.id, now);
  return total;
}

export async function createReceipt(
  db: Db,
  input: Pick<Receipt, 'hallId' | 'userId' | 'fileId' | 'fileKind' | 'mimeType' | 'caption'>,
  now: Date,
): Promise<Receipt> {
  const [row] = await db
    .insert(receipts)
    .values({ ...input, createdAt: now })
    .returning();
  return row;
}

export interface Quote {
  /** Chegirmali 30 kunlik narx. */
  price: number;
  daily: number;
  balanceBefore: number;
  balanceAfter: number;
  /** To'lovdan keyin pul qachongacha yetadi (null — muddatsiz). */
  endsAt: Date | null;
}

/** Summa kiritilganda: balans qancha bo'ladi va qachongacha yetadi (bazaga yozilmaydi). */
export async function quote(db: Db, hallId: string, amount: number, now: Date): Promise<Quote> {
  const hall = await getHall(db, hallId);
  if (!hall) throw new ReviewError('Biliardxona topilmadi');
  const b = await hallBilling(db, hall, now);
  const paid = applyPayment(stateOf(hall), amount, b.pricing.graceDays, b.daily, now);
  const r = chargeDue(paid, b.daily, b.pricing.graceDays, now);
  const next = { ...paid, ...r };
  return {
    price: b.price,
    daily: b.daily,
    balanceBefore: hall.balance,
    balanceAfter: next.balance,
    endsAt: computeStatus(next, b.pricing.graceDays, b.daily, now).endsAt,
  };
}

export class ReviewError extends Error {}

export interface ReviewResult {
  receipt: Receipt;
  hall: Hall;
  telegramId: number;
  status: Status;
}

/** Chekni tasdiqlash: tushgan summa balansga qo'shiladi (avval qarz yopiladi), kerak bo'lsa darhol yechiladi. */
export async function approveReceipt(db: Db, id: number, input: { amount: number }, now: Date): Promise<ReviewResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new ReviewError("Summa musbat bo'lishi kerak");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(receipts).where(eq(receipts.id, id)).for('update');
    if (!r) throw new ReviewError('Chek topilmadi');
    if (r.status !== 'pending') throw new ReviewError('Chek allaqachon ko‘rib chiqilgan');
    const [hall] = await tx.select().from(halls).where(eq(halls.id, r.hallId)).for('update');
    const b = await hallBilling(tx, hall, now);
    const paid = applyPayment(stateOf(hall), input.amount, b.pricing.graceDays, b.daily, now);
    const charged = chargeDue(paid, b.daily, b.pricing.graceDays, now);
    const inTrial = !!hall.trialEndsAt && now < hall.trialEndsAt;
    const next = inTrial ? paid : { ...paid, ...charged };
    const [receipt] = await tx
      .update(receipts)
      .set({ status: 'approved', amount: input.amount, priceAtReview: b.price, reviewedAt: now })
      .where(eq(receipts.id, id))
      .returning();
    await tx.insert(subscriptionEvents).values({
      hallId: hall.id,
      kind: 'payment',
      amount: input.amount,
      receiptId: id,
      balanceAfter: paid.balance,
      createdAt: now,
    });
    const updated = await saveBilling(tx, hall.id, next, inTrial ? [] : charged.charges, now);
    const [u] = await tx.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, r.userId));
    return { receipt, hall: updated, telegramId: u.telegramId, status: computeStatus(updated, b.pricing.graceDays, b.daily, now) };
  });
}

export async function rejectReceipt(db: Db, id: number, reason: string, now: Date) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(receipts).where(eq(receipts.id, id)).for('update');
    if (!r) throw new ReviewError('Chek topilmadi');
    if (r.status !== 'pending') throw new ReviewError('Chek allaqachon ko‘rib chiqilgan');
    const [receipt] = await tx
      .update(receipts)
      .set({ status: 'rejected', rejectReason: reason.trim().slice(0, 500) || null, reviewedAt: now })
      .where(eq(receipts.id, id))
      .returning();
    const [hall] = await tx.select().from(halls).where(eq(halls.id, r.hallId));
    const [u] = await tx.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, r.userId));
    return { receipt, hall, telegramId: u.telegramId };
  });
}

/** Admin qo'lda balansni o'zgartiradi (manfiy — ayirish), masalan naqd to'lov yoki tuzatish. */
export async function adjustBalance(db: Db, hallId: string, amount: number, note: string | undefined, now: Date): Promise<Hall> {
  return db.transaction(async (tx) => {
    const [hall] = await tx.select().from(halls).where(eq(halls.id, hallId)).for('update');
    if (!hall) throw new ReviewError('Biliardxona topilmadi');
    const b = await hallBilling(tx, hall, now);
    let next: BillingState;
    if (amount >= 0) next = applyPayment(stateOf(hall), amount, b.pricing.graceDays, b.daily, now);
    else {
      const balance = hall.balance + amount;
      next = { ...stateOf(hall), balance, debtSince: balance < 0 ? (hall.debtSince ?? now) : null };
    }
    await tx.insert(subscriptionEvents).values({
      hallId,
      kind: 'adjust',
      amount,
      balanceAfter: next.balance,
      note: note?.slice(0, 500) ?? null,
      createdAt: now,
    });
    const r = chargeDue(next, b.daily, b.pricing.graceDays, now);
    const inTrial = !!hall.trialEndsAt && now < hall.trialEndsAt;
    return saveBilling(tx, hallId, inTrial ? next : { ...next, ...r }, inTrial ? [] : r.charges, now);
  });
}

/** Admin sinov muddatini uzaytiradi (shu davrda kunlik to'lov yechilmaydi). */
export async function extendHallTrial(db: Db, hallId: string, days: number, note: string | undefined, now: Date): Promise<Hall> {
  return db.transaction(async (tx) => {
    const [hall] = await tx.select().from(halls).where(eq(halls.id, hallId)).for('update');
    if (!hall) throw new ReviewError('Biliardxona topilmadi');
    const next = extendTrial(stateOf(hall), days, now);
    await tx.insert(subscriptionEvents).values({
      hallId,
      kind: 'trial_extend',
      days,
      toDate: next.trialEndsAt,
      note: note?.slice(0, 500) ?? null,
      createdAt: now,
    });
    return saveBilling(tx, hallId, next, [], now);
  });
}

export async function hallEvents(db: Db, hallId: string) {
  return db
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.hallId, hallId))
    .orderBy(desc(subscriptionEvents.createdAt), desc(subscriptionEvents.id))
    .limit(500);
}

export async function pendingReceiptCount(db: Db, hallId: string): Promise<number> {
  const rows = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.hallId, hallId), eq(receipts.status, 'pending')));
  return rows.length;
}
