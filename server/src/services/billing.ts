import { and, desc, eq } from 'drizzle-orm';
import type { SubscriptionInfo } from '../contract.ts';
import type { Db } from '../db/client.ts';
import { halls, receipts, subscriptionEvents, users } from '../db/schema.ts';
import { computeStatus, daysForAmount, effectivePrice, extendPaidUntil, type Status } from './billing-math.ts';
import { activeHallDiscounts, discountLabel, type ActiveDiscount } from './discounts.ts';
import { getHall, type Hall } from './halls.ts';
import { getPricing, type Pricing } from './pricing.ts';

export type Receipt = typeof receipts.$inferSelect;

export interface HallBilling {
  hall: Hall;
  pricing: Pricing;
  status: Status;
  price: number;
  discount: ActiveDiscount | null;
}

export async function hallBilling(db: Db, hall: Hall, now: Date): Promise<HallBilling> {
  const pricing = await getPricing(db);
  const active = await activeHallDiscounts(db, hall.id, now);
  const { price, discount } = effectivePrice(pricing.monthlyPrice, active);
  return { hall, pricing, status: computeStatus(hall, pricing.graceDays, now), price, discount };
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
    discount: discount
      ? { percent: discount.percent, amount: discount.amount, endsAt: discount.endsAt?.getTime() ?? null, label: discountLabel(discount) }
      : null,
  };
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
  price: number;
  days: number;
  paidUntil: Date;
}

/** Summa kiritilganda: shu biliardxonaning chegirmali narxi bo'yicha necha kun va yangi muddat. */
export async function quote(db: Db, hallId: string, amount: number, now: Date, days?: number): Promise<Quote> {
  const hall = await getHall(db, hallId);
  if (!hall) throw new Error('hall not found');
  const { price } = await hallBilling(db, hall, now);
  const d = days ?? daysForAmount(amount, price);
  return { price, days: d, paidUntil: extendPaidUntil(hall, d, now) };
}

export class ReviewError extends Error {}

export interface ReviewResult {
  receipt: Receipt;
  hall: Hall;
  telegramId: number;
}

/** Chekni tasdiqlash: muddat uzaytiriladi, audit yoziladi. Faqat `pending` chek. */
export async function approveReceipt(db: Db, id: number, input: { amount: number; days: number }, now: Date): Promise<ReviewResult> {
  if (input.amount < 0 || input.days <= 0) throw new ReviewError("Summa va kunlar musbat bo'lishi kerak");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(receipts).where(eq(receipts.id, id)).for('update');
    if (!r) throw new ReviewError('Chek topilmadi');
    if (r.status !== 'pending') throw new ReviewError('Chek allaqachon ko‘rib chiqilgan');
    const [hall] = await tx.select().from(halls).where(eq(halls.id, r.hallId)).for('update');
    const { price } = await hallBilling(tx, hall, now);
    const from = hall.paidUntil;
    const paidUntil = extendPaidUntil(hall, input.days, now);
    const [updatedHall] = await tx
      .update(halls)
      .set({ paidUntil, lastReminder: null })
      .where(eq(halls.id, hall.id))
      .returning();
    const [receipt] = await tx
      .update(receipts)
      .set({ status: 'approved', amount: input.amount, daysAdded: input.days, priceAtReview: price, reviewedAt: now })
      .where(eq(receipts.id, id))
      .returning();
    await tx.insert(subscriptionEvents).values({
      hallId: hall.id,
      kind: 'payment',
      days: input.days,
      amount: input.amount,
      fromDate: from,
      toDate: paidUntil,
      receiptId: id,
      createdAt: now,
    });
    const [u] = await tx.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, r.userId));
    return { receipt, hall: updatedHall, telegramId: u.telegramId };
  });
}

export async function rejectReceipt(db: Db, id: number, reason: string, now: Date): Promise<ReviewResult> {
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

/** Admin qo'lda: kun qo'shish (manfiy — ayirish) yoki aniq sanani qo'yish. */
export async function adjustSubscription(
  db: Db,
  hallId: string,
  input: { days: number; note?: string } | { paidUntil: Date | null; note?: string },
  now: Date,
): Promise<Hall> {
  return db.transaction(async (tx) => {
    const [hall] = await tx.select().from(halls).where(eq(halls.id, hallId)).for('update');
    if (!hall) throw new ReviewError('Biliardxona topilmadi');
    const paidUntil = 'days' in input ? extendPaidUntil(hall, input.days, now) : input.paidUntil;
    const [updated] = await tx
      .update(halls)
      .set({ paidUntil, lastReminder: null })
      .where(eq(halls.id, hallId))
      .returning();
    await tx.insert(subscriptionEvents).values({
      hallId,
      kind: 'days' in input ? 'extend' : 'set',
      days: 'days' in input ? input.days : null,
      fromDate: hall.paidUntil,
      toDate: paidUntil,
      note: input.note?.slice(0, 500) ?? null,
      createdAt: now,
    });
    return updated;
  });
}

export async function hallEvents(db: Db, hallId: string) {
  return db
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.hallId, hallId))
    .orderBy(desc(subscriptionEvents.createdAt))
    .limit(200);
}

export async function pendingReceiptCount(db: Db, hallId: string): Promise<number> {
  const rows = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.hallId, hallId), eq(receipts.status, 'pending')));
  return rows.length;
}
