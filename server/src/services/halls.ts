import { and, asc, eq, gt, isNotNull, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { devices, hallMembers, halls, invites, subscriptionEvents, users, type Role } from '../db/schema.ts';
import { addDays } from './billing-math.ts';
import { attachCampaigns } from './discounts.ts';
import { getPricing, type Pricing } from './pricing.ts';
import { readableCode } from './util.ts';
import type { User } from './users.ts';

export type Hall = typeof halls.$inferSelect;
export type Device = typeof devices.$inferSelect;

const INVITE_DAYS = 7;

/** Sinov faqat bir marta: shu Telegram akkaunt yoki shu telefon raqami avval olmagan bo'lsa. */
async function trialEligible(db: Db, user: User): Promise<boolean> {
  if (user.trialUsedAt) return false;
  if (!user.phone) return true;
  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, user.phone), isNotNull(users.trialUsedAt), ne(users.id, user.id)))
    .limit(1);
  return !other;
}

/** Yangi biliardxona: egasi a'zo bo'ladi, sinov muddati va ochiq kampaniyalar beriladi. */
export async function createHall(db: Db, user: User, name: string, now: Date): Promise<Hall> {
  const pricing = await getPricing(db);
  return db.transaction(async (tx) => {
    const trial = pricing.trialDays > 0 && (await trialEligible(tx, user));
    const trialEndsAt = trial ? addDays(now, pricing.trialDays) : null;
    const [hall] = await tx
      .insert(halls)
      .values({ name: name.trim().slice(0, 80) || 'Biliard klub', ownerUserId: user.id, trialEndsAt, createdAt: now })
      .returning();
    await tx.insert(hallMembers).values({ hallId: hall.id, userId: user.id, role: 'owner', createdAt: now });
    if (trial) {
      await tx.update(users).set({ trialUsedAt: now }).where(eq(users.id, user.id));
      await tx
        .insert(subscriptionEvents)
        .values({ hallId: hall.id, kind: 'trial', days: pricing.trialDays, fromDate: now, toDate: trialEndsAt });
    }
    await attachCampaigns(tx, hall.id, now);
    await tx.update(users).set({ activeHallId: hall.id }).where(eq(users.id, user.id));
    return hall;
  });
}

export async function getHall(db: Db, id: string): Promise<Hall | undefined> {
  const [row] = await db.select().from(halls).where(eq(halls.id, id));
  return row;
}

export async function memberships(db: Db, userId: number): Promise<{ hall: Hall; role: Role }[]> {
  const rows = await db
    .select({ hall: halls, role: hallMembers.role })
    .from(hallMembers)
    .innerJoin(halls, eq(halls.id, hallMembers.hallId))
    .where(eq(hallMembers.userId, userId))
    .orderBy(asc(hallMembers.createdAt));
  return rows;
}

export async function memberRole(db: Db, hallId: string, userId: number): Promise<Role | null> {
  const [row] = await db
    .select({ role: hallMembers.role })
    .from(hallMembers)
    .where(and(eq(hallMembers.hallId, hallId), eq(hallMembers.userId, userId)));
  return row?.role ?? null;
}

export const deviceLimit = (hall: Pick<Hall, 'deviceLimit'>, pricing: Pick<Pricing, 'defaultDeviceLimit'>) =>
  hall.deviceLimit ?? pricing.defaultDeviceLimit;

export interface DeviceRow extends Device {
  userName: string;
}

export async function activeDevices(db: Db, hallId: string): Promise<DeviceRow[]> {
  const rows = await db
    .select({ d: devices, u: users })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(and(eq(devices.hallId, hallId), isNull(devices.revokedAt)))
    .orderBy(asc(devices.createdAt));
  return rows.map(({ d, u }) => ({
    ...d,
    userName: [u.firstName, u.lastName].filter(Boolean).join(' ') || (u.username ? `@${u.username}` : `#${u.telegramId}`),
  }));
}

/** Shu o'rnatishdan (installId) qayta kirish limitga hisoblanmaydi — eski token almashtiriladi. */
export async function hasDeviceSlot(db: Db, hall: Hall, installId: string): Promise<boolean> {
  const pricing = await getPricing(db);
  const list = await activeDevices(db, hall.id);
  return list.filter((d) => d.installId !== installId).length < deviceLimit(hall, pricing);
}

export async function revokeDevice(db: Db, hallId: string, deviceId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(devices)
    .set({ revokedAt: now })
    .where(and(eq(devices.id, deviceId), eq(devices.hallId, hallId), isNull(devices.revokedAt)))
    .returning({ id: devices.id });
  return rows.length > 0;
}

export async function createInvite(db: Db, hallId: string, userId: number, now: Date) {
  const code = readableCode(10);
  const expiresAt = addDays(now, INVITE_DAYS);
  await db.insert(invites).values({ code, hallId, createdBy: userId, expiresAt, createdAt: now });
  return { code, expiresAt };
}

export type JoinResult = { ok: true; hall: Hall; already: boolean } | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/** Sherik taklif havolasi bilan biliardxonaga `admin` bo'lib qo'shiladi. */
export async function acceptInvite(db: Db, code: string, user: User, now: Date): Promise<JoinResult> {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invites).where(eq(invites.code, code)).for('update');
    if (!inv) return { ok: false, reason: 'invalid' };
    const [hall] = await tx.select().from(halls).where(eq(halls.id, inv.hallId));
    if (!hall) return { ok: false, reason: 'invalid' };
    const role = await memberRole(tx, hall.id, user.id);
    if (role) {
      await tx.update(users).set({ activeHallId: hall.id }).where(eq(users.id, user.id));
      return { ok: true, hall, already: true };
    }
    if (inv.usedAt) return { ok: false, reason: 'used' };
    if (inv.expiresAt <= now) return { ok: false, reason: 'expired' };
    await tx.insert(hallMembers).values({ hallId: hall.id, userId: user.id, role: 'admin', createdAt: now });
    await tx.update(invites).set({ usedBy: user.id, usedAt: now }).where(eq(invites.code, code));
    await tx.update(users).set({ activeHallId: hall.id }).where(eq(users.id, user.id));
    return { ok: true, hall, already: false };
  });
}

/** Faol taklif havolasi bormi (bot qayta-qayta yangi kod yaratmasligi uchun). */
export async function openInvite(db: Db, hallId: string, now: Date) {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.hallId, hallId), isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .limit(1);
  return row;
}
