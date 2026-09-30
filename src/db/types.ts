/**
 * expo-sqlite `SQLiteDatabase` ning biz ishlatadigan qismi. Servislar shu interfeysga
 * yoziladi, shuning uchun testlarda Node'ning `node:sqlite` moduli bilan almashtiriladi.
 */
export type BindValue = string | number | null;

/**
 * Yangi global identifikator uchun SQL ifoda. Ikki telefondagi yozuvlar birlashtirilganda
 * lokal `id` lar to'qnashadi, `uid` esa har doim noyob.
 */
export const NEW_UID = 'lower(hex(randomblob(16)))';

export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface Db {
  runAsync(sql: string, params: BindValue[]): Promise<RunResult>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
  execAsync(sql: string): Promise<void>;
}

export interface RootDb extends Db {
  /** Barcha so'rovlar `txn` orqali bajarilishi kerak. */
  withExclusiveTransactionAsync(task: (txn: Db) => Promise<void>): Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Tranzaksiyani bajaradi va natijasini qaytaradi.
 *
 * expo-sqlite har bir eksklyuziv tranzaksiya uchun alohida ulanish ochadi. Kassir tugmani
 * tez-tez bossa, parallel tranzaksiyalar bir-birini "database is locked" bilan to'sib qo'yadi,
 * shuning uchun ular navbat bilan bajariladi.
 */
export function transaction<T>(db: RootDb, task: (txn: Db) => Promise<T>): Promise<T> {
  const run = async () => {
    let result: T | undefined;
    await db.withExclusiveTransactionAsync(async (txn) => {
      // Yangi ulanishda kutish vaqti o'rnatilmagan: asosiy ulanish yozayotgan bo'lsa kutsin.
      await txn.execAsync('PRAGMA busy_timeout = 3000');
      result = await task(txn);
    });
    return result as T;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
