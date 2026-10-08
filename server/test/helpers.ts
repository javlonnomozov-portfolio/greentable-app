import { openDatabase, type Database } from '../src/db/client.ts';
import { upsertTelegramUser, setPhone, getUser, type User } from '../src/services/users.ts';

export const T0 = new Date('2026-10-01T09:00:00Z');
export const DAY = 86_400_000;
export const at = (days: number) => new Date(T0.getTime() + days * DAY);

/** Har test uchun toza, migratsiya qilingan xotiradagi Postgres. */
export async function testDb(): Promise<Database> {
  return openDatabase();
}

let nextTg = 1000;

export async function makeUser(db: Database['db'], opts: { phone?: string; name?: string } = {}): Promise<User> {
  const u = await upsertTelegramUser(db, { id: nextTg++, first_name: opts.name ?? 'Test' });
  if (opts.phone) await setPhone(db, u.id, opts.phone);
  return (await getUser(db, u.id))!;
}
