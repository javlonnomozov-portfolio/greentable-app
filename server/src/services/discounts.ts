import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { discounts, hallDiscounts, halls, subscriptionEvents } from '../db/schema.ts';
import { addMonths } from './billing-math.ts';
import { formatSom } from './util.ts';

export type Discount = typeof discounts.$inferSelect;
export type DiscountInput = Omit<Discount, 'id' | 'usedCount' | 'createdAt'>;

export interface ActiveDiscount extends Discount {
  hallDiscountId: number;
  startsAt: Date;
  endsAt: Date | null;
}

/** Chegirmani shu paytda berish mumkinmi (faol, oyna ichida, limit tugamagan). */
export function isDiscountOpen(d: Discount, now: Date): boolean {
  return (
    d.active &&
    (!d.validFrom || d.validFrom <= now) &&
    (!d.validTo || now <= d.validTo) &&
    (d.maxUses == null || d.usedCount < d.maxUses)
  );
}

export function discountLabel(d: Pick<Discount, 'kind' | 'code' | 'percent' | 'amount'>): string {
  const value = d.percent != null ? `−${d.percent}%` : `−${formatSom(d.amount ?? 0)}`;
  return d.kind === 'promo' && d.code ? `${value} (promo ${d.code})` : value;
}

export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** Biliardxonaga hozir amal qilayotgan chegirmalar. */
export async function activeHallDiscounts(db: Db, hallId: string, now: Date): Promise<ActiveDiscount[]> {
  const rows = await db
    .select({ d: discounts, hd: hallDiscounts })
    .from(hallDiscounts)
    .innerJoin(discounts, eq(discounts.id, hallDiscounts.discountId))
    .where(
      and(
        eq(hallDiscounts.hallId, hallId),
        lte(hallDiscounts.startsAt, now),
        or(isNull(hallDiscounts.endsAt), gt(hallDiscounts.endsAt, now)),
      ),
    );
  return rows.map((r) => ({ ...r.d, hallDiscountId: r.hd.id, startsAt: r.hd.startsAt, endsAt: r.hd.endsAt }));
}

/** Chegirmani biliardxonaga biriktiradi. Avval biriktirilgan bo'lsa `false`. */
export async function attachDiscount(db: Db, hallId: string, d: Discount, now: Date, note?: string): Promise<boolean> {
  const endsAt = d.benefitMonths != null ? addMonths(now, d.benefitMonths) : null;
  const inserted = await db
    .insert(hallDiscounts)
    .values({ hallId, discountId: d.id, startsAt: now, endsAt })
    .onConflictDoNothing()
    .returning({ id: hallDiscounts.id });
  if (!inserted.length) return false;
  await db
    .update(discounts)
    .set({ usedCount: sql`${discounts.usedCount} + 1` })
    .where(eq(discounts.id, d.id));
  await db.insert(subscriptionEvents).values({
    hallId,
    kind: 'discount',
    toDate: endsAt,
    note: note ?? discountLabel(d),
  });
  return true;
}

/** Yangi biliardxona: shu paytda ochiq kampaniyalar avtomatik biriktiriladi. */
export async function attachCampaigns(db: Db, hallId: string, now: Date): Promise<void> {
  const campaigns = await db.select().from(discounts).where(eq(discounts.kind, 'campaign'));
  for (const d of campaigns) if (isDiscountOpen(d, now)) await attachDiscount(db, hallId, d, now, `Kampaniya: ${discountLabel(d)}`);
}

export type RedeemResult =
  | { ok: true; discount: Discount }
  | { ok: false; reason: 'not_found' | 'closed' | 'already' | 'not_new' };

/** Botda kiritilgan promo kod. */
export async function redeemPromo(db: Db, hallId: string, code: string, now: Date): Promise<RedeemResult> {
  return db.transaction(async (tx) => {
    const [d] = await tx
      .select()
      .from(discounts)
      .where(and(eq(discounts.kind, 'promo'), eq(discounts.code, normalizeCode(code))))
      .for('update');
    if (!d) return { ok: false, reason: 'not_found' };
    if (!isDiscountOpen(d, now)) return { ok: false, reason: 'closed' };
    if (d.newOnly) {
      const [h] = await tx.select({ paidUntil: halls.paidUntil }).from(halls).where(eq(halls.id, hallId));
      if (h?.paidUntil) return { ok: false, reason: 'not_new' };
    }
    const attached = await attachDiscount(tx, hallId, d, now, `Promo kod ${d.code}: ${discountLabel(d)}`);
    return attached ? { ok: true, discount: d } : { ok: false, reason: 'already' };
  });
}

export async function listDiscounts(db: Db): Promise<Discount[]> {
  return db.select().from(discounts).orderBy(sql`${discounts.createdAt} desc`);
}

export async function createDiscount(db: Db, input: DiscountInput): Promise<Discount> {
  const [row] = await db
    .insert(discounts)
    .values({ ...input, code: input.code ? normalizeCode(input.code) : null })
    .returning();
  return row;
}

export async function updateDiscount(db: Db, id: number, patch: Partial<DiscountInput>): Promise<Discount | undefined> {
  const values = { ...patch };
  if (patch.code !== undefined) values.code = patch.code ? normalizeCode(patch.code) : null;
  const [row] = await db.update(discounts).set(values).where(eq(discounts.id, id)).returning();
  return row;
}
