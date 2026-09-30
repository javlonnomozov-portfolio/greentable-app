import { addDatabaseChangeListener, useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { onDbChanged } from './events';
import type { RootDb } from './types';

export const DB_NAME = 'biliard.db';

export function useDb(): RootDb {
  return useSQLiteContext();
}

/**
 * So'rov natijasini qaytaradi va bazadagi har qanday o'zgarishdan keyin
 * (qisqa kechikish bilan, bir nechta o'zgarishni birlashtirib) qayta yuklaydi.
 * `deps` — so'rov parametrlari; ular o'zgarsa so'rov qayta bajariladi.
 */
export function useQuery<T>(
  fetcher: (db: RootDb) => Promise<T>,
  deps: readonly unknown[],
): { data: T | undefined; error: Error | null; reload: () => void } {
  const db = useDb();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const depsKey = JSON.stringify(deps);
  const fetchLatest = useEffectEvent(() => fetcher(db));

  useEffect(() => {
    let cancelled = false;
    fetchLatest().then(
      (result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, depsKey, tick]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setTick((t) => t + 1), 60);
    };
    const sub = addDatabaseChangeListener(schedule);
    const off = onDbChanged(schedule);
    return () => {
      sub.remove();
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}
