import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { MeResponse } from '../../server/src/contract';
import type { Db } from '@/db/types';

const TOKEN_KEY = 'gt_device_token';
const INSTALL_KEY = 'gt_install_id';

/** Ilova o'rnatilganda bir marta yaratiladi: qayta kirishda server eski tokenni almashtiradi. */
export async function getInstallId(): Promise<string> {
  let id = await SecureStore.getItemAsync(INSTALL_KEY);
  if (!id) {
    id = randomUUID();
    await SecureStore.setItemAsync(INSTALL_KEY, id);
  }
  return id;
}

export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const setToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

/** Oxirgi ma'lum obuna holati — oflaynda ham faqat-ko'rish rejimini aniqlash uchun. */
export async function loadMe(db: Db): Promise<MeResponse | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM local_kv WHERE key = 'me'", []);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as MeResponse;
  } catch {
    return null;
  }
}

export async function saveMe(db: Db, me: MeResponse | null): Promise<void> {
  if (!me) await db.runAsync("DELETE FROM local_kv WHERE key = 'me'", []);
  else
    await db.runAsync(
      "INSERT INTO local_kv (key, value) VALUES ('me', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(me)],
    );
}
