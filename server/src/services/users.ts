import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { users, type BotState } from '../db/schema.ts';

export type User = typeof users.$inferSelect;

export interface TelegramFrom {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** Telegram'dan kelgan foydalanuvchini yaratadi yoki ism/username'ni yangilaydi. */
export async function upsertTelegramUser(db: Db, from: TelegramFrom): Promise<User> {
  const values = { firstName: from.first_name, lastName: from.last_name ?? null, username: from.username ?? null };
  const [row] = await db
    .insert(users)
    .values({ telegramId: from.id, ...values })
    .onConflictDoUpdate({ target: users.telegramId, set: values })
    .returning();
  return row;
}

export async function getUser(db: Db, id: number): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

export async function setBotState(db: Db, userId: number, state: BotState | null): Promise<void> {
  await db.update(users).set({ botState: state }).where(eq(users.id, userId));
}

/** Telefon raqamini bir xil ko'rinishga keltiradi: +998901234567 */
export function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d ? `+${d}` : '';
}

export async function setPhone(db: Db, userId: number, phone: string): Promise<void> {
  await db.update(users).set({ phone: normalizePhone(phone) }).where(eq(users.id, userId));
}

export async function setActiveHall(db: Db, userId: number, hallId: string): Promise<void> {
  await db.update(users).set({ activeHallId: hallId }).where(eq(users.id, userId));
}

export function displayName(u: Pick<User, 'firstName' | 'lastName' | 'username' | 'telegramId'>): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  return u.username ? `@${u.username}` : `#${u.telegramId}`;
}
