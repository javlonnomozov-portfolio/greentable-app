import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { MeResponse, SubscriptionInfo } from '../../server/src/contract';
import { notifyDbChanged, onDbChanged } from '@/db/events';
import { useDb } from '@/db/hooks';
import { api, ApiError, OfflineError } from '@/sync/api';
import { setSetting } from '@/services/settings';
import { bindHall, outboxCount, syncOnce } from '@/sync/engine';
import { clearToken, getToken, loadMe, saveMe, setToken } from '@/sync/session';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncContext {
  /** Token va oxirgi holat o'qildi (ungacha ekran ko'rsatilmaydi). */
  ready: boolean;
  loggedIn: boolean;
  me: MeResponse | null;
  status: SyncStatus;
  /** Serverga hali yuborilmagan o'zgarishlar. */
  pending: number;
  lastSyncAt: number | null;
  error: string | null;
  /** Telefon soati server vaqtidan farqi (ms). */
  clockSkew: number;
  /** Obuna tugagan (imtiyozdan keyin) yoki biliardxona bloklangan: yangi o'yin/savdo boshlab bo'lmaydi. */
  readOnly: boolean;
  syncNow(): Promise<void>;
  refreshMe(): Promise<void>;
  completeLogin(deviceToken: string, me: MeResponse): Promise<void>;
  logout(): Promise<void>;
  /** Qurilma tokeni bilan server so'rovi (qurilmalar, taklif, tarixni tozalash). */
  withToken<T>(fn: (token: string) => Promise<T>): Promise<T>;
}

const Ctx = createContext<SyncContext | null>(null);

export function useSync(): SyncContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('SyncProvider topilmadi');
  return ctx;
}

const SYNC_INTERVAL_MS = 15_000;
const ME_INTERVAL_MS = 5 * 60_000;
const LOCAL_CHANGE_DELAY_MS = 2_000;

/** Oflaynda: oxirgi ma'lum holatdan imtiyoz tugaganini telefon soati bo'yicha aniqlaydi. */
export function isReadOnly(sub: SubscriptionInfo | undefined, now = Date.now()): boolean {
  if (!sub) return false;
  if (sub.readOnly) return true;
  return sub.graceEndsAt != null && now > sub.graceEndsAt;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [pending, setPending] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockSkew, setClockSkew] = useState(0);
  const running = useRef(false);
  const again = useRef(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    (async () => {
      const [t, cached] = await Promise.all([getToken(), loadMe(db)]);
      tokenRef.current = t;
      setTokenState(t);
      if (t) setMe(cached);
      setPending(await outboxCount(db));
      setReady(true);
    })();
  }, [db]);

  const signOut = useCallback(async () => {
    tokenRef.current = null;
    await clearToken();
    setTokenState(null);
    setMe(null);
    await saveMe(db, null);
  }, [db]);

  /** 401 — qurilma o'chirilgan yoki a'zolikdan chiqarilgan: qayta kirish kerak (lokal ma'lumot qoladi). */
  const handleError = useCallback(
    async (e: unknown) => {
      if (e instanceof OfflineError) {
        setStatus('offline');
        setError(null);
        return;
      }
      if (e instanceof ApiError && e.code === 'unauthorized') {
        await signOut();
        return;
      }
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    },
    [signOut],
  );

  const refreshMe = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const fresh = await api.me(t);
      setMe(fresh);
      setClockSkew(fresh.serverTime - Date.now());
      await saveMe(db, fresh);
    } catch (e) {
      await handleError(e);
    }
  }, [db, handleError]);

  const syncNow = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setStatus('syncing');
    try {
      do {
        again.current = false;
        const res = await syncOnce(db, api.transport(t));
        if (res.pulled > 0) notifyDbChanged();
      } while (again.current);
      setStatus('idle');
      setError(null);
      setLastSyncAt(Date.now());
    } catch (e) {
      await handleError(e);
    } finally {
      running.current = false;
      setPending(await outboxCount(db).catch(() => 0));
    }
  }, [db, handleError]);

  const completeLogin = useCallback(
    async (deviceToken: string, fresh: MeResponse) => {
      await bindHall(db, fresh.hall.id);
      // Klub nomi (chekda chiqadi) hali kiritilmagan bo'lsa — botda yozilgan biliardxona nomi.
      const named = await db.getFirstAsync<{ key: string }>("SELECT key FROM settings WHERE key = 'hall_name'", []);
      if (!named) await setSetting(db, 'hall_name', fresh.hall.name);
      await setToken(deviceToken);
      await saveMe(db, fresh);
      setMe(fresh);
      setClockSkew(fresh.serverTime - Date.now());
      tokenRef.current = deviceToken;
      setTokenState(deviceToken);
    },
    [db],
  );

  const logout = useCallback(async () => {
    const t = tokenRef.current;
    if (t) {
      // Yuborilmagan o'zgarishlar bo'lsa avval yuboriladi.
      await syncOnce(db, api.transport(t)).catch(() => undefined);
      await api.logout(t).catch(() => undefined);
    }
    await signOut();
  }, [db, signOut]);

  const withToken = useCallback(async <T,>(fn: (token: string) => Promise<T>) => {
    const t = tokenRef.current;
    if (!t) throw new Error('Avval tizimga kiring');
    return fn(t);
  }, []);

  // Kirgandan keyin: darhol sinxron, oldinga chiqqanda, har 15 soniyada va lokal o'zgarishdan 2 soniya keyin.
  useEffect(() => {
    if (!token) return;
    const first = setTimeout(() => {
      syncNow();
      refreshMe();
    }, 0);
    let active = AppState.currentState === 'active';
    let lastMe = Date.now();
    const appSub = AppState.addEventListener('change', (s) => {
      active = s === 'active';
      if (active) {
        syncNow();
        refreshMe();
        lastMe = Date.now();
      }
    });
    const interval = setInterval(() => {
      if (!active) return;
      syncNow();
      if (Date.now() - lastMe > ME_INTERVAL_MS) {
        lastMe = Date.now();
        refreshMe();
      }
    }, SYNC_INTERVAL_MS);
    let localTimer: ReturnType<typeof setTimeout> | null = null;
    const offChange = onDbChanged(() => {
      if (running.current) return;
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(() => {
        outboxCount(db).then((n) => {
          setPending(n);
          if (n > 0) syncNow();
        });
      }, LOCAL_CHANGE_DELAY_MS);
    });
    return () => {
      clearTimeout(first);
      appSub.remove();
      clearInterval(interval);
      offChange();
      if (localTimer) clearTimeout(localTimer);
    };
  }, [token, db, syncNow, refreshMe]);

  const readOnly = isReadOnly(me?.subscription);

  const value = useMemo<SyncContext>(
    () => ({
      ready,
      loggedIn: !!token,
      me,
      status,
      pending,
      lastSyncAt,
      error,
      clockSkew,
      readOnly,
      syncNow,
      refreshMe,
      completeLogin,
      logout,
      withToken,
    }),
    [ready, token, me, status, pending, lastSyncAt, error, clockSkew, readOnly, syncNow, refreshMe, completeLogin, logout, withToken],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
