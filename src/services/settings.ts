import type { Db } from '@/db/types';
import type { RoundingMode, RoundingSettings } from './billing';

export interface AppSettings {
  hallName: string;
  rounding: RoundingSettings;
  /** Ish kuni shu soatdan boshlanadi (tungi smena kechagi kunga yoziladi). */
  dayStartHour: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  hallName: 'Biliard klub',
  rounding: { step: 1000, mode: 'up' },
  dayStartHour: 6,
};

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings', []);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const v = map.get(key);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const mode = map.get('rounding_mode');
  return {
    hallName: map.get('hall_name') ?? DEFAULT_SETTINGS.hallName,
    rounding: {
      step: num('rounding_step', DEFAULT_SETTINGS.rounding.step),
      mode: mode === 'up' || mode === 'down' || mode === 'nearest' ? (mode as RoundingMode) : DEFAULT_SETTINGS.rounding.mode,
    },
    dayStartHour: num('day_start_hour', DEFAULT_SETTINGS.dayStartHour),
  };
}

export type SettingKey = 'hall_name' | 'rounding_step' | 'rounding_mode' | 'day_start_hour';

export async function setSetting(db: Db, key: SettingKey, value: string | number): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)],
  );
}
