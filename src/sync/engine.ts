import type { PullResponse, PushRequest, PushResponse } from '../../server/src/contract';
import { transaction, type Db, type RootDb } from '@/db/types';
import { applyChanges } from './apply';
import { serialize, type OutboxEntry } from './codec';

const PUSH_BATCH = 500;
const PULL_BATCH = 500;

/** Server bilan aloqa (testlarda xotiradagi soxta server). */
export interface Transport {
  push(req: PushRequest): Promise<PushResponse>;
  pull(since: number, limit: number): Promise<PullResponse>;
}

/** Boshqa qurilmada "Tarixni tozalash" bajarilgan: lokal ma'lumot tozalanib, qaytadan yuklanadi. */
export class EpochError extends Error {
  readonly epoch: number;
  constructor(epoch: number) {
    super('epoch');
    this.epoch = epoch;
  }
}

export interface SyncState {
  last_rev: number;
  epoch: number;
  hall_id: string | null;
}

export async function getSyncState(db: Db): Promise<SyncState> {
  const row = await db.getFirstAsync<SyncState>('SELECT last_rev, epoch, hall_id FROM sync_state WHERE id = 1', []);
  return row ?? { last_rev: 0, epoch: 0, hall_id: null };
}

/** Serverga hali yuborilmagan o'zgarishlar soni. */
export async function outboxCount(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox', []);
  return row?.n ?? 0;
}

/** Triggerlar ishlamaydigan holatda (`applying = 1`) tranzaksiya. */
function applying<T>(db: RootDb, task: (txn: Db) => Promise<T>): Promise<T> {
  return transaction(db, async (txn) => {
    await txn.runAsync('UPDATE sync_state SET applying = 1 WHERE id = 1', []);
    const result = await task(txn);
    await txn.runAsync('UPDATE sync_state SET applying = 0 WHERE id = 1', []);
    return result;
  });
}

const HISTORY = ['bill_items', 'payments', 'debts', 'expenses', 'stock_moves', 'bills', 'customers'];
const CATALOG = ['tables', 'products', 'expense_categories'];

/**
 * Lokal ma'lumotni o'chiradi (serverga o'chirish yuborilmaydi). Epoch o'zgarganda yoki
 * boshqa biliardxonaga kirilganda — keyin serverdan to'liq yuklanadi.
 */
export async function wipeLocal(db: RootDb): Promise<void> {
  await applying(db, async (txn) => {
    for (const t of [...HISTORY, ...CATALOG, 'settings', 'sync_outbox', 'sync_pending']) {
      await txn.runAsync(`DELETE FROM ${t}`, []);
    }
    await txn.runAsync('UPDATE sync_state SET last_rev = 0, epoch = 0 WHERE id = 1', []);
  });
}

/**
 * Kirishdan keyin: boshqa biliardxonaning ma'lumoti bo'lsa tozalanadi. Birinchi kirishda
 * (v1 dan qolgan lokal ma'lumot) — saqlanadi va serverga yuklanadi.
 */
export async function bindHall(db: RootDb, hallId: string): Promise<void> {
  const state = await getSyncState(db);
  if (state.hall_id && state.hall_id !== hallId) await wipeLocal(db);
  await db.runAsync('UPDATE sync_state SET hall_id = ? WHERE id = 1', [hallId]);
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  pending: number;
}

/**
 * Bitta to'liq sinxron: avval serverdagi o'zgarishlar olinadi (ziddiyatda server nusxasi yangiroq bo'lsa
 * lokal qator yangilanadi), keyin lokal o'zgarishlar yuboriladi.
 */
export async function syncOnce(db: RootDb, transport: Transport, retried = false): Promise<SyncResult> {
  const state = await getSyncState(db);
  let since = state.last_rev;
  let epoch = state.epoch;
  const initial = since === 0;
  let pulled = 0;
  let pending = 0;

  for (;;) {
    const page = await transport.pull(since, PULL_BATCH);
    if (page.epoch !== epoch) {
      // epoch 0 — hali sinxronlanmagan qurilma: shunchaki serverdagini qabul qiladi.
      const wasSynced = epoch !== 0;
      epoch = page.epoch;
      if (wasSynced) await wipeLocal(db);
      await db.runAsync('UPDATE sync_state SET epoch = ? WHERE id = 1', [epoch]);
      if (wasSynced && since !== 0) {
        since = 0;
        continue;
      }
    }
    const res = await applying(db, async (txn) => {
      const r = await applyChanges(txn, page.rows, { matchByName: initial });
      await txn.runAsync('UPDATE sync_state SET last_rev = ? WHERE id = 1', [page.nextRev]);
      return r;
    });
    pulled += res.applied;
    pending = res.pending;
    since = page.nextRev;
    if (!page.more) break;
  }

  let pushed = 0;
  for (;;) {
    const entries = await db.getAllAsync<OutboxEntry>(
      'SELECT seq, tbl, uid, deleted, ts FROM sync_outbox ORDER BY seq LIMIT ?',
      [PUSH_BATCH],
    );
    if (!entries.length) break;
    const changes = [];
    for (const e of entries) {
      const c = await serialize(db, e);
      if (c) changes.push(c);
    }
    try {
      if (changes.length) await transport.push({ epoch, changes });
    } catch (e) {
      if (e instanceof EpochError && !retried) {
        await wipeLocal(db);
        return syncOnce(db, transport, true);
      }
      throw e;
    }
    await db.runAsync('DELETE FROM sync_outbox WHERE seq <= ?', [entries[entries.length - 1].seq]);
    pushed += changes.length;
  }
  return { pulled, pushed, pending };
}
