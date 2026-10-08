import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { pricing } from '../db/schema.ts';

export type Pricing = typeof pricing.$inferSelect;
export type PricingPatch = Partial<Omit<Pricing, 'id' | 'updatedAt'>>;

/** Birinchi ishga tushishdagi qiymatlar — admin panelda o'zgartiriladi. */
export const DEFAULT_PRICING = {
  monthlyPrice: 100_000,
  trialDays: 14,
  graceDays: 3,
  defaultDeviceLimit: 3,
  paymentText: '',
  supportText: '',
};

export async function getPricing(db: Db): Promise<Pricing> {
  const [row] = await db.select().from(pricing).where(eq(pricing.id, 1));
  if (row) return row;
  await db
    .insert(pricing)
    .values({ id: 1, ...DEFAULT_PRICING })
    .onConflictDoNothing();
  const [created] = await db.select().from(pricing).where(eq(pricing.id, 1));
  return created;
}

export async function updatePricing(db: Db, patch: PricingPatch): Promise<Pricing> {
  await getPricing(db);
  const [row] = await db
    .update(pricing)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(pricing.id, 1))
    .returning();
  return row;
}
