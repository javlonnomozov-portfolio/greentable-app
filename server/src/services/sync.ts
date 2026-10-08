import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PullResponse, SyncChange } from '../contract.ts';
import type { Db } from '../db/client.ts';
import { halls, syncRows } from '../db/schema.ts';

/** Ilovadagi sinxronlanadigan jadvallar. Boshqa nom kelsa so'rov rad etiladi. */
export const SYNC_TABLES = [
  'tables',
  'products',
  'expense_categories',
  'customers',
  'bills',
  'bill_items',
  'payments',
  'debts',
  'expenses',
  'stock_moves',
  'settings',
] as const;

export const MAX_PUSH = 500;
export const MAX_PULL = 1000;

export class EpochMismatch extends Error {
  readonly epoch: number;
  constructor(epoch: number) {
    super('epoch');
    this.epoch = epoch;
  }
}

/** Bitta biliardxonaning yozuvlari navbat bilan yoziladi: `rev` tartibi commit tartibiga mos keladi. */
const lockHall = (tx: Db, hallId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hallId}, 0))`);

/**
 * Qurilmadan kelgan o'zgarishlar. Har qator uchun oxirgi yozuv yutadi: serverdagidan yangiroq
 * (`updatedAt` katta, teng bo'lsa qurilma id bo'yicha) bo'lsa yoziladi va yangi `rev` oladi.
 */
export async function pushChanges(
  db: Db,
  ctx: { hallId: string; deviceId: string },
  epoch: number,
  changes: SyncChange[],
): Promise<number> {
  // Bitta so'rovda bir qator ikki marta kelsa, eng yangisi qoladi (ON CONFLICT bir qatorni ikki marta yangilay olmaydi).
  const latest = new Map<string, SyncChange>();
  for (const c of changes) {
    const key = `${c.tbl}\u0000${c.uid}`;
    const prev = latest.get(key);
    if (!prev || c.updatedAt >= prev.updatedAt) latest.set(key, c);
  }
  return db.transaction(async (tx) => {
    await lockHall(tx, ctx.hallId);
    const [hall] = await tx.select({ epoch: halls.dataEpoch }).from(halls).where(eq(halls.id, ctx.hallId));
    if (!hall || hall.epoch !== epoch) throw new EpochMismatch(hall?.epoch ?? 0);
    const values = [...latest.values()].map((c) => ({
      hallId: ctx.hallId,
      tbl: c.tbl,
      uid: c.uid,
      data: c.data,
      updatedAt: c.updatedAt,
      deleted: c.deleted,
      deviceId: ctx.deviceId,
    }));
    if (!values.length) return 0;
    const written = await tx
      .insert(syncRows)
      .values(values)
      .onConflictDoUpdate({
        target: [syncRows.hallId, syncRows.tbl, syncRows.uid],
        set: {
          data: sql`excluded.data`,
          updatedAt: sql`excluded.updated_at`,
          deleted: sql`excluded.deleted`,
          deviceId: sql`excluded.device_id`,
          rev: sql`nextval(pg_get_serial_sequence('sync_rows', 'rev'))`,
        },
        setWhere: sql`${syncRows.updatedAt} < excluded.updated_at
          OR (${syncRows.updatedAt} = excluded.updated_at
              AND coalesce(${syncRows.deviceId}::text, '') < coalesce(excluded.device_id::text, ''))`,
      })
      .returning({ uid: syncRows.uid });
    return written.length;
  });
}

export async function pullChanges(db: Db, hallId: string, since: number, limit: number, now: Date): Promise<PullResponse> {
  const [hall] = await db.select({ epoch: halls.dataEpoch }).from(halls).where(eq(halls.id, hallId));
  const rows = await db
    .select()
    .from(syncRows)
    .where(and(eq(syncRows.hallId, hallId), gt(syncRows.rev, since)))
    .orderBy(asc(syncRows.rev))
    .limit(limit + 1);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return {
    epoch: hall?.epoch ?? 0,
    rows: page.map((r) => ({ tbl: r.tbl, uid: r.uid, updatedAt: r.updatedAt, deleted: r.deleted, data: r.data, rev: r.rev })),
    nextRev: page.length ? page[page.length - 1].rev : since,
    more,
    serverTime: now.getTime(),
  };
}

/** "Tarixni tozalash": tanlangan jadvallar o'chiriladi, epoch oshadi — barcha qurilmalar qaytadan yuklaydi. */
export async function resetHallData(db: Db, hallId: string, tables: string[]): Promise<number> {
  return db.transaction(async (tx) => {
    await lockHall(tx, hallId);
    if (tables.length) {
      await tx.delete(syncRows).where(and(eq(syncRows.hallId, hallId), inArray(syncRows.tbl, tables)));
    }
    const [hall] = await tx
      .update(halls)
      .set({ dataEpoch: sql`${halls.dataEpoch} + 1` })
      .where(eq(halls.id, hallId))
      .returning({ epoch: halls.dataEpoch });
    return hall.epoch;
  });
}
