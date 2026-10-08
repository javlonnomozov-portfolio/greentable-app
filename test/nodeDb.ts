import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { migrate } from '@/db/migrations';
import type { RootDb } from '@/db/types';

/** expo-sqlite o'rniga testlarda ishlatiladigan xotiradagi SQLite (Node 22.5+). */
export function createMemoryDb(): RootDb {
  const raw = new DatabaseSync(':memory:');
  const bind = (params: unknown[]) => params as SQLInputValue[];
  const db: RootDb = {
    async runAsync(sql, params) {
      const r = raw.prepare(sql).run(...bind(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async getAllAsync<T>(sql: string, params: unknown[]) {
      return raw.prepare(sql).all(...bind(params)).map((r: object) => ({ ...r })) as T[];
    },
    async getFirstAsync<T>(sql: string, params: unknown[]) {
      const row = raw.prepare(sql).get(...bind(params));
      return row ? ({ ...row } as T) : null;
    },
    async execAsync(sql) {
      raw.exec(sql);
    },
    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN EXCLUSIVE');
      try {
        await task(db);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}

/** v1 dagidek namunaviy stollar/mahsulotlar bilan (servis testlari shularga tayanadi). */
export async function createMigratedDb(): Promise<RootDb> {
  const db = createMemoryDb();
  await migrate(db, undefined, { sample: true });
  return db;
}

/** Yangi o'rnatilgan ilova: bo'sh baza. */
export async function createEmptyDb(): Promise<RootDb> {
  const db = createMemoryDb();
  await migrate(db);
  return db;
}
