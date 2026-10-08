import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useQuery } from '@/db/hooks';
import { listHall } from '@/services/bills';
import {
  ALERT_PREFIX,
  getTimerSound,
  planAlerts,
  staleAlertIds,
  type AlertKind,
  type AlertSource,
} from '@/services/timerAlerts';

/** Android kanallari: tovush kanalga bog'lanadi (fayllar `app.json` dagi expo-notifications plaginida). */
const CHANNEL: Record<AlertKind, { id: string; name: string; sound: string }> = {
  warn: { id: 'session-warn', name: 'Seans tugashiga 5 daqiqa', sound: 'warn.wav' },
  end: { id: 'session-end', name: 'Seans vaqti tugadi', sound: 'balls.wav' },
};

// Ilova ochiq turganda ham bildirishnoma ko'rsatiladi va tovush chalinadi.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let channelsReady: Promise<void> | null = null;
function ensureChannels(): Promise<void> {
  channelsReady ??= (async () => {
    if (Platform.OS !== 'android') return;
    for (const c of Object.values(CHANNEL)) {
      await Notifications.setNotificationChannelAsync(c.id, {
        name: c.name,
        importance: Notifications.AndroidImportance.HIGH,
        sound: c.sound,
        vibrationPattern: [0, 300, 150, 300],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
  })();
  return channelsReady;
}

/** Ruxsat bir marta so'raladi; rad etilgan bo'lsa qayta bezovta qilinmaydi (Sozlamalarda tugma bor). */
async function hasPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Rejalashtirilgan bildirishnomalarni kerakli ro'yxatga keltiradi. Identifikatorda vaqt bor, shuning uchun
 * faqat to'plamlarni solishtirish kifoya: ortiqchasi bekor qilinadi, yangisi qo'shiladi.
 * Paneldagi eskirganlari (hisob yopilgan yoki muddat uzaytirilgan) olib tashlanadi.
 */
async function reconcile(tables: AlertSource[], enabled: boolean): Promise<void> {
  const now = Date.now();
  let plan = enabled ? planAlerts(tables, now) : [];
  await ensureChannels();
  if (plan.length > 0 && !(await hasPermission())) plan = [];
  const presented = (await Notifications.getPresentedNotificationsAsync()).map((n) => n.request.identifier);
  for (const id of staleAlertIds(presented, tables, now)) await Notifications.dismissNotificationAsync(id);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const existing = new Set(scheduled.map((n) => n.identifier).filter((id) => id.startsWith(ALERT_PREFIX)));
  const wanted = new Set(plan.map((a) => a.id));
  for (const id of existing) if (!wanted.has(id)) await Notifications.cancelScheduledNotificationAsync(id);
  for (const a of plan) {
    if (existing.has(a.id)) continue;
    const channel = CHANNEL[a.kind];
    await Notifications.scheduleNotificationAsync({
      identifier: a.id,
      content: {
        title: a.title,
        body: a.body,
        sound: channel.sound,
        data: { billId: a.billId },
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: a.at, channelId: channel.id },
    });
  }
}

// Ketma-ket bajariladi: tez-tez o'zgarishlarda bir-birining ustiga tushmasin.
let queue: Promise<void> = Promise.resolve();
const enqueue = (tables: AlertSource[], enabled: boolean) => {
  queue = queue.then(() => reconcile(tables, enabled)).catch((e: unknown) => console.warn('Taymer bildirishnomasi:', e));
};

/**
 * Vaqtli seanslar uchun mahalliy bildirishnomalar (tugashiga 5 daqiqa qolganda, tugaganda, keyin har 5 daqiqada).
 * Baza o'zgarganda (shu jumladan boshqa qurilmadan sinxron kelganda) qayta rejalashtiriladi — shuning uchun
 * ovoz barcha qurilmalarda chalinadi. Ilova yopiq bo'lsa ham Android o'zi vaqtida ko'rsatadi.
 */
export function TimerAlerts() {
  const { data } = useQuery(async (d) => ({ tables: await listHall(d), enabled: await getTimerSound(d) }), []);

  useEffect(() => {
    if (!data || Platform.OS === 'web') return;
    enqueue(data.tables, data.enabled);
  }, [data]);

  // Bildirishnoma bosilsa — o'sha stol hisobi ochiladi.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const billId = r.notification.request.content.data?.billId;
      if (typeof billId === 'number') router.push({ pathname: '/bill/[id]', params: { id: billId } });
    });
    return () => sub.remove();
  }, []);

  return null;
}

/** Sozlamalar ekrani uchun: ruxsat holati va so'rash. */
export async function notificationPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (Platform.OS === 'web') return { granted: false, canAskAgain: false };
  await ensureChannels();
  const p = await Notifications.getPermissionsAsync();
  return { granted: p.granted, canAskAgain: p.canAskAgain };
}

export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannels();
  return (await Notifications.requestPermissionsAsync()).granted;
}
