import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { adminOtps, adminSessions } from '../db/schema.ts';
import { digits, randomToken, safeEqual, sha256 } from './util.ts';

const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 30_000;
const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 86_400_000;

export class AdminAuthError extends Error {}

/** Admin panelga kirish kodi. Kod bot orqali adminlarning Telegram'iga yuboriladi. */
export async function requestOtp(db: Db, now: Date): Promise<string> {
  const [last] = await db.select().from(adminOtps).orderBy(desc(adminOtps.createdAt)).limit(1);
  if (last && now.getTime() - last.createdAt.getTime() < OTP_RESEND_MS) {
    throw new AdminAuthError('Kod yaqinda yuborildi, 30 soniyadan keyin qayta urining');
  }
  const code = digits(6);
  await db.insert(adminOtps).values({ codeHash: sha256(code), expiresAt: new Date(now.getTime() + OTP_TTL_MS), createdAt: now });
  return code;
}

/** Kod to'g'ri bo'lsa sessiya tokeni (cookie uchun) qaytariladi. Har kodga 5 ta urinish. */
export async function verifyOtp(db: Db, code: string, now: Date): Promise<string> {
  const [otp] = await db
    .select()
    .from(adminOtps)
    .where(and(isNull(adminOtps.usedAt), gt(adminOtps.expiresAt, now)))
    .orderBy(desc(adminOtps.createdAt))
    .limit(1);
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw new AdminAuthError('Kod eskirgan, yangisini oling');
  await db.update(adminOtps).set({ attempts: otp.attempts + 1 }).where(eq(adminOtps.id, otp.id));
  if (!safeEqual(sha256(code.trim()), otp.codeHash)) throw new AdminAuthError("Kod noto'g'ri");
  await db.update(adminOtps).set({ usedAt: now }).where(eq(adminOtps.id, otp.id));
  const token = randomToken(32);
  await db.insert(adminSessions).values({ tokenHash: sha256(token), expiresAt: new Date(now.getTime() + SESSION_TTL_MS), createdAt: now });
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  return token;
}

export async function validSession(db: Db, token: string | undefined, now: Date): Promise<boolean> {
  if (!token) return false;
  const [s] = await db
    .select({ hash: adminSessions.tokenHash })
    .from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, sha256(token)), gt(adminSessions.expiresAt, now)));
  return !!s;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, sha256(token)));
}
