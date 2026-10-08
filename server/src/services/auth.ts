import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { devices, loginRequests, type Role } from '../db/schema.ts';
import { getHall, memberRole, type Device, type Hall } from './halls.ts';
import { getUser, type User } from './users.ts';
import { randomToken, sha256 } from './util.ts';

export const LOGIN_TTL_MS = 15 * 60_000;
const SEEN_THROTTLE_MS = 5 * 60_000;

export type LoginRequest = typeof loginRequests.$inferSelect;

export async function startLogin(db: Db, input: { installId: string; model?: string }, now: Date) {
  const token = randomToken(24);
  const expiresAt = new Date(now.getTime() + LOGIN_TTL_MS);
  await db.insert(loginRequests).values({
    token,
    installId: input.installId,
    model: input.model?.slice(0, 80) ?? null,
    expiresAt,
    createdAt: now,
  });
  return { token, expiresAt };
}

/** Kutilayotgan (muddati o'tmagan) kirish so'rovi. */
export async function pendingLogin(db: Db, token: string, now: Date): Promise<LoginRequest | undefined> {
  const [row] = await db
    .select()
    .from(loginRequests)
    .where(and(eq(loginRequests.token, token), eq(loginRequests.status, 'pending'), gt(loginRequests.expiresAt, now)));
  return row;
}

/** Bot foydalanuvchi va biliardxonani aniqlagach so'rovni tasdiqlaydi. */
export async function confirmLogin(db: Db, token: string, userId: number, hallId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(loginRequests)
    .set({ status: 'confirmed', userId, hallId })
    .where(and(eq(loginRequests.token, token), eq(loginRequests.status, 'pending'), gt(loginRequests.expiresAt, now)))
    .returning({ token: loginRequests.token });
  return rows.length > 0;
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'ok'; deviceToken: string; deviceId: string; hallId: string; userId: number };

/**
 * Ilova so'raydi: tasdiqlangan bo'lsa qurilma tokeni bir marta beriladi (keyingi so'rovda — `expired`).
 * Shu o'rnatishdagi eski qurilma tokeni bekor qilinadi.
 */
export async function pollLogin(db: Db, token: string, now: Date): Promise<PollResult> {
  const [req] = await db.select().from(loginRequests).where(eq(loginRequests.token, token));
  if (!req || req.status === 'consumed') return { status: 'expired' };
  if (req.status === 'pending') return req.expiresAt > now ? { status: 'pending' } : { status: 'expired' };
  return db.transaction(async (tx) => {
    const taken = await tx
      .update(loginRequests)
      .set({ status: 'consumed' })
      .where(and(eq(loginRequests.token, token), eq(loginRequests.status, 'confirmed')))
      .returning();
    const r = taken[0];
    if (!r || !r.userId || !r.hallId) return { status: 'expired' } as const;
    await tx
      .update(devices)
      .set({ revokedAt: now })
      .where(and(eq(devices.hallId, r.hallId), eq(devices.installId, r.installId), isNull(devices.revokedAt)));
    const deviceToken = randomToken(32);
    const [device] = await tx
      .insert(devices)
      .values({
        hallId: r.hallId,
        userId: r.userId,
        installId: r.installId,
        model: r.model,
        tokenHash: sha256(deviceToken),
        lastSeenAt: now,
        createdAt: now,
      })
      .returning();
    return { status: 'ok', deviceToken, deviceId: device.id, hallId: r.hallId, userId: r.userId } as const;
  });
}

export interface DeviceAuth {
  device: Device;
  hall: Hall;
  user: User;
  role: Role;
}

/** Ilova so'rovidagi qurilma tokenini tekshiradi. A'zolikdan chiqarilgan yoki bekor qilingan bo'lsa — null. */
export async function authenticate(db: Db, token: string, now: Date): Promise<DeviceAuth | null> {
  if (!token) return null;
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.tokenHash, sha256(token)), isNull(devices.revokedAt)));
  if (!device) return null;
  const [hall, user, role] = await Promise.all([
    getHall(db, device.hallId),
    getUser(db, device.userId),
    memberRole(db, device.hallId, device.userId),
  ]);
  if (!hall || !user || !role || user.blocked) return null;
  if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > SEEN_THROTTLE_MS) {
    await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
  }
  return { device, hall, user, role };
}
