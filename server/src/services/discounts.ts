import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { discountTargets, discounts, hallDiscounts, halls, receipts, subscriptionEvents } from '../db/schema.ts';
import { addDays } from './billing-math.ts';
import { formatSom } from './util.ts';

export type Discount = typeof discounts.$inferSelect;
export type DiscountInput = Omit<Discount, 'id' | 'usedCount' | 'createdAt'> & { hallIds?: string[] };

export interface ActiveDiscount extends Discount {
  /** Biriktirilgan bo'lsa — hall_discounts id (global chegirmada null). */
  hallDiscountId: number | null;
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
  if (d.kind === 'promo' && d.code) return `${value} (promo ${d.code})`;
  if (d.kind === 'global') return `${value} (aksiya)`;
  return value;
}

export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** Biliardxona hali birorta ham tasdiqlangan to'lov qilmaganmi ("yangi" auditoriya). */
export async function isNewHall(db: Db, hallId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.hallId, hallId), eq(receipts.status, 'approved')))
    .limit(1);
  return !row;
}

/** Chegirma auditoriyasi shu biliardxonani o'z ichiga oladimi. */
export async function inAudience(db: Db, d: Discount, hallId: string): Promise<boolean> {
  if (d.audience === 'new') return isNewHall(db, hallId);
  if (d.audience === 'selected') {
    const [t] = await db
      .select({ id: discountTargets.discountId })
      .from(discountTargets)
      .where(and(eq(discountTargets.discountId, d.id), eq(discountTargets.hallId, hallId)));
    return !!t;
  }
  return true;
}

/** Biliardxonaga hozir amal qilayotgan chegirmalar: biriktirilganlar va hammaga (global) aksiyalar. */
export async function activeHallDiscounts(db: Db, hallId: string, now: Date): Promise<ActiveDiscount[]> {
  const attached = await db
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
  const result: ActiveDiscount[] = attached.map((r) => ({ ...r.d, hallDiscountId: r.hd.id, startsAt: r.hd.startsAt, endsAt: r.hd.endsAt }));
  const globals = await db.select().from(discounts).where(and(eq(discounts.kind, 'global'), eq(discounts.active, true)));
  for (const g of globals) {
    const open = (!g.validFrom || g.validFrom <= now) && (!g.validTo || now <= g.validTo);
    if (open && (await inAudience(db, g, hallId))) {
      result.push({ ...g, hallDiscountId: null, startsAt: g.validFrom ?? g.createdAt, endsAt: g.validTo });
    }
  }
  return result;
}

/** Chegirmani biliardxonaga biriktiradi (muddati `benefitDays` dan). Avval biriktirilgan bo'lsa `false`. */
export async function attachDiscount(db: Db, hallId: string, d: Discount, now: Date, note?: string): Promise<boolean> {
  const endsAt = d.benefitDays != null ? addDays(now, d.benefitDays) : null;
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
  await db.insert(subscriptionEvents).values({ hallId, kind: 'discount', toDate: endsAt, note: note ?? discountLabel(d), createdAt: now });
  return true;
}

/** Yangi biliardxona: shu paytda ochiq kampaniyalar avtomatik biriktiriladi. */
export async function attachCampaigns(db: Db, hallId: string, now: Date): Promise<void> {
  const campaigns = await db.select().from(discounts).where(eq(discounts.kind, 'campaign'));
  for (const d of campaigns) {
    if (isDiscountOpen(d, now) && (await inAudience(db, d, hallId))) {
      await attachDiscount(db, hallId, d, now, `Kampaniya: ${discountLabel(d)}`);
    }
  }
}

export type RedeemResult =
  | { ok: true; discount: Discount }
  | { ok: false; reason: 'not_found' | 'closed' | 'already' | 'not_allowed' };

/** Botda kiritilgan promo kod: oyna, limit va auditoriya tekshiriladi. */
export async function redeemPromo(db: Db, hallId: string, code: string, now: Date): Promise<RedeemResult> {
  return db.transaction(async (tx) => {
    const [d] = await tx
      .select()
      .from(discounts)
      .where(and(eq(discounts.kind, 'promo'), eq(discounts.code, normalizeCode(code))))
      .for('update');
    if (!d) return { ok: false, reason: 'not_found' };
    if (!isDiscountOpen(d, now)) return { ok: false, reason: 'closed' };
    if (!(await inAudience(tx, d, hallId))) return { ok: false, reason: 'not_allowed' };
    const attached = await attachDiscount(tx, hallId, d, now, `Promo kod ${d.code}: ${discountLabel(d)}`);
    return attached ? { ok: true, discount: d } : { ok: false, reason: 'already' };
  });
}

/** Admin: bitta biliardxonaga shaxsiy chegirma (`days` — necha kun, null — cheksiz). */
export async function createPersonalDiscount(
  db: Db,
  hallId: string,
  input: { percent: number | null; amount: number | null; days: number | null; note: string | null },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(discounts)
      .values({
        kind: 'personal',
        code: null,
        percent: input.percent,
        amount: input.amount,
        validFrom: null,
        validTo: null,
        benefitDays: input.days,
        audience: 'selected',
        maxUses: 1,
        active: true,
        note: input.note,
        createdAt: now,
      })
      .returning();
    await tx.insert(discountTargets).values({ discountId: d.id, hallId });
    await attachDiscount(tx, hallId, d, now, `Shaxsiy chegirma: ${discountLabel(d)}${input.note ? ` — ${input.note}` : ''}`);
  });
}

export interface DiscountRow extends Discount {
  targets: { hallId: string; name: string }[];
}

export async function listDiscounts(db: Db): Promise<DiscountRow[]> {
  const rows = await db.select().from(discounts).orderBy(desc(discounts.createdAt));
  const targets = await db
    .select({ discountId: discountTargets.discountId, hallId: halls.id, name: halls.name })
    .from(discountTargets)
    .innerJoin(halls, eq(halls.id, discountTargets.hallId));
  return rows.map((d) => ({ ...d, targets: targets.filter((t) => t.discountId === d.id).map(({ hallId, name }) => ({ hallId, name })) }));
}

async function setTargets(db: Db, discountId: number, hallIds: string[] | undefined) {
  if (!hallIds) return;
  await db.delete(discountTargets).where(eq(discountTargets.discountId, discountId));
  if (hallIds.length) await db.insert(discountTargets).values(hallIds.map((hallId) => ({ discountId, hallId })));
}

export async function createDiscount(db: Db, input: DiscountInput): Promise<Discount> {
  const { hallIds, ...values } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(discounts)
      .values({ ...values, code: values.code ? normalizeCode(values.code) : null })
      .returning();
    await setTargets(tx, row.id, values.audience === 'selected' ? hallIds ?? [] : []);
    return row;
  });
}

export async function updateDiscount(db: Db, id: number, patch: Partial<DiscountInput>): Promise<Discount | undefined> {
  const { hallIds, ...values } = patch;
  if (values.code !== undefined) values.code = values.code ? normalizeCode(values.code) : null;
  return db.transaction(async (tx) => {
    const [row] = await tx.update(discounts).set(values).where(eq(discounts.id, id)).returning();
    if (row) await setTargets(tx, id, row.audience === 'selected' ? hallIds : []);
    return row;
  });
}

/** Biliardxonadagi biriktirilgan chegirmani hozirdan to'xtatish. */
export async function stopHallDiscount(db: Db, hallDiscountId: number, now: Date): Promise<void> {
  await db.update(hallDiscounts).set({ endsAt: now }).where(eq(hallDiscounts.id, hallDiscountId));
}

