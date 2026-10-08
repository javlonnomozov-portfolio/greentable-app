import { plannedEndAt, remainingMs } from '@/services/billing';
import { ALERT_PREFIX, planAlerts, type AlertSource } from '@/services/timerAlerts';

const MIN = 60_000;
const T0 = new Date(2026, 9, 8, 18, 0, 0).getTime();

const table = (over: Partial<AlertSource> = {}): AlertSource => ({
  name: 'PS 1',
  bill_id: 7,
  started_at: T0,
  paused_at: null,
  paused_ms: 0,
  carried_ms: 0,
  planned_minutes: 60,
  customer_name: null,
  label: 'Aziz',
  ...over,
});

describe('qolgan vaqt', () => {
  const timer = { started_at: T0, ended_at: null, paused_at: null, paused_ms: 0, carried_ms: 0, planned_minutes: 60 };

  it('muddatsiz seansda null, ortiqcha vaqtda manfiy', () => {
    expect(remainingMs({ ...timer, planned_minutes: null }, T0)).toBeNull();
    expect(remainingMs(timer, T0 + 45 * MIN)).toBe(15 * MIN);
    expect(remainingMs(timer, T0 + 70 * MIN)).toBe(-10 * MIN);
  });

  it('pauza va boshqa stoldan o‘tgan vaqt hisobga olinadi', () => {
    // 10 daqiqa pauza bo'lgan, oldingi stolda 20 daqiqa o'ynalgan.
    const t = { ...timer, paused_ms: 10 * MIN, carried_ms: 20 * MIN };
    expect(remainingMs(t, T0 + 30 * MIN)).toBe(20 * MIN);
    expect(plannedEndAt(t, T0 + 30 * MIN)).toBe(T0 + 50 * MIN);
    // Pauzada tugash vaqti noma'lum.
    expect(plannedEndAt({ ...t, paused_at: T0 + 30 * MIN }, T0 + 35 * MIN)).toBeNull();
    expect(remainingMs({ ...t, paused_at: T0 + 30 * MIN }, T0 + 35 * MIN)).toBe(20 * MIN);
  });
});

describe('planAlerts', () => {
  it('5 daqiqa oldin, tugaganda va keyin har 5 daqiqada bir soatgacha', () => {
    const alerts = planAlerts([table()], T0 + MIN);
    expect(alerts.map((a) => (a.at - T0) / MIN)).toEqual([55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120]);
    expect(alerts[0]).toMatchObject({ kind: 'warn', billId: 7, title: '⏳ PS 1: 5 daqiqa qoldi', body: '1 soat olingan · Aziz' });
    expect(alerts[1]).toMatchObject({ kind: 'end', title: '🎱 PS 1: vaqt tugadi' });
    expect(alerts[2].title).toBe('🎱 PS 1: +5 daqiqa ortiqcha');
    expect(alerts.every((a) => a.id.startsWith(`${ALERT_PREFIX}7-`))).toBe(true);
  });

  it('o‘tib ketganlari, pauzadagi va muddatsiz seanslar rejalashtirilmaydi', () => {
    const late = planAlerts([table()], T0 + 72 * MIN);
    expect(late.map((a) => (a.at - T0) / MIN)).toEqual([75, 80, 85, 90, 95, 100, 105, 110, 115, 120]);
    expect(planAlerts([table({ paused_at: T0 + 10 * MIN })], T0 + 20 * MIN)).toEqual([]);
    expect(planAlerts([table({ planned_minutes: null })], T0)).toEqual([]);
    expect(planAlerts([table({ bill_id: null, started_at: null })], T0)).toEqual([]);
    expect(planAlerts([table()], T0 + 3 * 60 * MIN)).toEqual([]);
  });

  it('muddat uzaytirilsa yangi vaqtlar, eski ogohlantirish rejadan chiqadi', () => {
    const before = planAlerts([table()], T0).map((a) => a.id);
    const after = planAlerts([table({ planned_minutes: 90 })], T0);
    expect(after.slice(0, 2).map((a) => (a.at - T0) / MIN)).toEqual([85, 90]);
    expect(after.map((a) => a.id)).not.toContain(before[0]);
    // Qayta hisoblash bir xil natija beradi — keraksiz qayta rejalashtirish bo'lmaydi.
    expect(planAlerts([table()], T0 + 2 * MIN).map((a) => a.id)).toEqual(before);
  });

  it('5 daqiqalik seansda oldindan ogohlantirish yo‘q', () => {
    expect(planAlerts([table({ planned_minutes: 5 })], T0)[0]).toMatchObject({ kind: 'end', at: T0 + 5 * MIN });
  });
});
