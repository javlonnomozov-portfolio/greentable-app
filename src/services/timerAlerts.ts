import type { Db } from '@/db/types';
import { WARN_BEFORE_MS, plannedEndAt, remainingMs, type TimerState } from './billing';
import { formatMinutes } from '@/utils/time';

const MINUTE = 60_000;
/** Vaqt tugagach shar ovozi shuncha oraliqda takrorlanadi… */
export const REPEAT_EVERY_MS = 5 * MINUTE;
/** …shuncha vaqt davomida (keyin admin baribir ko'rgan bo'ladi). */
export const REPEAT_FOR_MS = 60 * MINUTE;

export const ALERT_PREFIX = 'gt-timer-';

export type AlertKind = 'warn' | 'end';

export interface TimerAlert {
  /** Vaqt identifikatorga kiradi: muddat o'zgarsa — yangi bildirishnoma, eskisi bekor qilinadi. */
  id: string;
  at: number;
  kind: AlertKind;
  billId: number;
  title: string;
  body: string;
}

export interface AlertSource {
  name: string;
  bill_id: number | null;
  started_at: number | null;
  ended_at?: number | null;
  paused_at: number | null;
  paused_ms: number | null;
  carried_ms: number | null;
  planned_minutes: number | null;
  customer_name: string | null;
  label: string | null;
}

type TimedSession = TimerState & { bill_id: number; planned_minutes: number };

function timedSession(t: AlertSource): TimedSession | null {
  if (t.bill_id == null || t.started_at == null || t.planned_minutes == null) return null;
  return {
    bill_id: t.bill_id,
    started_at: t.started_at,
    ended_at: t.ended_at ?? null,
    paused_at: t.paused_at,
    paused_ms: t.paused_ms ?? 0,
    carried_ms: t.carried_ms ?? 0,
    planned_minutes: t.planned_minutes,
  };
}

/** Vaqtlar soniyagacha yaxlitlanadi — har qayta hisoblashda identifikator bir xil chiqsin. */
const toSecond = (ms: number) => Math.round(ms / 1000) * 1000;

/**
 * Ochiq vaqtli seanslar uchun kelajakdagi bildirishnomalar: tugashdan 5 daqiqa oldin,
 * tugaganda va keyin har 5 daqiqada bir soatgacha. Pauzadagi seansga rejalashtirilmaydi.
 */
export function planAlerts(tables: AlertSource[], now: number): TimerAlert[] {
  const out: TimerAlert[] = [];
  for (const t of tables) {
    const timer = timedSession(t);
    const raw = timer && plannedEndAt(timer, now);
    if (!timer || raw == null) continue;
    const end = toSecond(raw);
    const billId = timer.bill_id;
    const who = t.customer_name ?? t.label;
    const taken = `${formatMinutes(timer.planned_minutes)} olingan${who ? ` · ${who}` : ''}`;
    const add = (at: number, kind: AlertKind, title: string, body: string) => {
      if (at > now) out.push({ id: `${ALERT_PREFIX}${billId}-${at}`, at, kind, billId, title, body });
    };
    if (timer.planned_minutes * MINUTE > WARN_BEFORE_MS) add(end - WARN_BEFORE_MS, 'warn', `⏳ ${t.name}: 5 daqiqa qoldi`, taken);
    add(end, 'end', `🎱 ${t.name}: vaqt tugadi`, `${taken}. Vaqt hisoblanishda davom etmoqda.`);
    for (let extra = REPEAT_EVERY_MS; extra <= REPEAT_FOR_MS; extra += REPEAT_EVERY_MS) {
      add(end + extra, 'end', `🎱 ${t.name}: +${extra / MINUTE} daqiqa ortiqcha`, taken);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const ALERT_ID = new RegExp(`^${ALERT_PREFIX}(\\d+)-(\\d+)$`);

/**
 * Ko'rsatib bo'lingan, lekin endi dolzarb bo'lmagan bildirishnomalar — paneldan olib tashlanadi:
 * hisob yopilgan, muddat olib tashlangan yoki uzaytirilgan (o'yin vaqtidan 5 daqiqadan ko'p qolgan).
 */
export function staleAlertIds(ids: string[], tables: AlertSource[], now: number): string[] {
  const remaining = new Map<number, number>();
  for (const t of tables) {
    const timer = timedSession(t);
    if (timer) remaining.set(timer.bill_id, remainingMs(timer, now) ?? 0);
  }
  return ids.filter((id) => {
    const m = ALERT_ID.exec(id);
    if (!m) return false;
    const left = remaining.get(Number(m[1]));
    return left == null || left > WARN_BEFORE_MS;
  });
}

/** Har bir telefonning o'z sozlamasi (sinxronlanmaydi): vaqt tugaganda ovozli bildirishnoma. */
export async function getTimerSound(db: Db): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM local_kv WHERE key = 'timer_sound'", []);
  return row?.value !== '0';
}

export async function setTimerSound(db: Db, on: boolean): Promise<void> {
  await db.runAsync(
    "INSERT INTO local_kv (key, value) VALUES ('timer_sound', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [on ? '1' : '0'],
  );
}
