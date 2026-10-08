import { isRunningInExpoGo } from 'expo';
import type * as NotificationsModule from 'expo-notifications';
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

/**
 * Expo Go (SDK 53+) Android'da expo-notifications import qilinishi bilanoq xato beradi, webda esa mahalliy
 * bildirishnoma yo'q — u yerlarda taymer ovozi o'chiq. Haqiqiy ilovada (APK) modul odatdagidek yuklanadi.
 */
const Notifications: typeof NotificationsModule | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Platform.OS === 'web' || isRunningInExpoGo() ? null : require('expo-notifications');

/** Android kanallari: tovush kanalga bog'lanadi (fayllar `app.json` dagi expo-notifications plaginida). */
const CHANNEL: Record<AlertKind, { id: string; name: string; sound: string }> = {
  warn: { id: 'session-warn', name: 'Seans tugashiga 5 daqiqa', sound: 'warn.wav' },
  end: { id: 'session-end', name: 'Seans vaqti tugadi', sound: 'balls.wav' },
};

// Ilova ochiq turganda ham bildirishnoma ko'rsatiladi va tovush chalinadi.
Notifications?.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let channelsReady: Promise<void> | null = null;
function ensureChannels(N: typeof NotificationsModule): Promise<void> {
  channelsReady ??= (async () => {
    if (Platform.OS !== 'android') return;
    for (const c of Object.values(CHANNEL)) {
      await N.setNotificationChannelAsync(c.id, {
        name: c.name,
        importance: N.AndroidImportance.HIGH,
        sound: c.sound,
        vibrationPattern: [0, 300, 150, 300],
        lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
      });
    }
  })();
  return channelsReady;
}

/** Ruxsat bir marta so'raladi; rad etilgan bo'lsa qayta bezovta qilinmaydi (Sozlamalarda tugma bor). */
async function hasPermission(N: typeof NotificationsModule): Promise<boolean> {
  const current = await N.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await N.requestPermissionsAsync()).granted;
}

/**
 * Rejalashtirilgan bildirishnomalarni kerakli ro'yxatga keltiradi. Identifikatorda vaqt bor, shuning uchun
 * faqat to'plamlarni solishtirish kifoya: ortiqchasi bekor qilinadi, yangisi qo'shiladi.
 * Paneldagi eskirganlari (hisob yopilgan yoki muddat uzaytirilgan) olib tashlanadi.
 */
async function reconcile(N: typeof NotificationsModule, tables: AlertSource[], enabled: boolean): Promise<void> {
  const now = Date.now();
  let plan = enabled ? planAlerts(tables, now) : [];
  await ensureChannels(N);
  if (plan.length > 0 && !(await hasPermission(N))) plan = [];
  const presented = (await N.getPresentedNotificationsAsync()).map((n) => n.request.identifier);
  for (const id of staleAlertIds(presented, tables, now)) await N.dismissNotificationAsync(id);
  const scheduled = await N.getAllScheduledNotificationsAsync();
  const existing = new Set(scheduled.map((n) => n.identifier).filter((id) => id.startsWith(ALERT_PREFIX)));
  const wanted = new Set(plan.map((a) => a.id));
  for (const id of existing) if (!wanted.has(id)) await N.cancelScheduledNotificationAsync(id);
  for (const a of plan) {
    if (existing.has(a.id)) continue;
    const channel = CHANNEL[a.kind];
    await N.scheduleNotificationAsync({
      identifier: a.id,
      content: {
        title: a.title,
        body: a.body,
        sound: channel.sound,
        data: { billId: a.billId },
        priority: N.AndroidNotificationPriority.MAX,
      },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: a.at, channelId: channel.id },
    });
  }
}

// Ketma-ket bajariladi: tez-tez o'zgarishlarda bir-birining ustiga tushmasin.
let queue: Promise<void> = Promise.resolve();
const enqueue = (N: typeof NotificationsModule, tables: AlertSource[], enabled: boolean) => {
  queue = queue.then(() => reconcile(N, tables, enabled)).catch((e: unknown) => console.warn('Taymer bildirishnomasi:', e));
};

/**
 * Vaqtli seanslar uchun mahalliy bildirishnomalar (tugashiga 5 daqiqa qolganda, tugaganda, keyin har 5 daqiqada).
 * Baza o'zgarganda (shu jumladan boshqa qurilmadan sinxron kelganda) qayta rejalashtiriladi — shuning uchun
 * ovoz barcha qurilmalarda chalinadi. Ilova yopiq bo'lsa ham Android o'zi vaqtida ko'rsatadi.
 */
export function TimerAlerts() {
  const { data } = useQuery(async (d) => ({ tables: await listHall(d), enabled: await getTimerSound(d) }), []);

  useEffect(() => {
    if (!data || !Notifications) return;
    enqueue(Notifications, data.tables, data.enabled);
  }, [data]);

  // Bildirishnoma bosilsa — o'sha stol hisobi ochiladi.
  useEffect(() => {
    if (!Notifications) return;
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
  if (!Notifications) return { granted: false, canAskAgain: false };
  await ensureChannels(Notifications);
  const p = await Notifications.getPermissionsAsync();
  return { granted: p.granted, canAskAgain: p.canAskAgain };
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  await ensureChannels(Notifications);
  return (await Notifications.requestPermissionsAsync()).granted;
}
