import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { halls, users } from '../db/schema.ts';
import type { Notifier } from '../notifier.ts';
import { computeStatus } from '../services/billing-math.ts';
import { getPricing } from '../services/pricing.ts';
import { escapeHtml, formatDate } from '../services/util.ts';

/**
 * Sinov yoki obuna tugashiga 3 kun va 1 kun qolganda, imtiyozga va faqat-ko'rish rejimiga
 * o'tganda egasiga bitta xabar. `lastReminder` takror yubormaslik uchun: kalit + tugash sanasi.
 */
export async function runReminders(db: Db, notifier: Notifier, now: Date): Promise<number> {
  if (!notifier.botUsername) return 0;
  const pricing = await getPricing(db);
  const rows = await db
    .select({ hall: halls, telegramId: users.telegramId })
    .from(halls)
    .innerJoin(users, eq(users.id, halls.ownerUserId))
    .where(eq(halls.blocked, false));
  let sent = 0;
  for (const { hall, telegramId } of rows) {
    const s = computeStatus(hall, pricing.graceDays, now);
    if (!s.endsAt) continue;
    let key: string | null = null;
    let text = '';
    const what = s.state === 'trial' ? 'Sinov muddati' : 'Obuna';
    const name = escapeHtml(hall.name);
    if ((s.state === 'trial' || s.state === 'active') && s.daysLeft <= 3) {
      key = s.daysLeft <= 1 ? 'd1' : 'd3';
      text = `⏳ <b>${name}</b>: ${what} ${s.daysLeft <= 1 ? 'ertaga' : `${s.daysLeft} kundan keyin`} tugaydi (${formatDate(s.endsAt)}).\nDavom ettirish uchun «💳 To'lov» ni bosing.`;
    } else if (s.state === 'grace') {
      key = 'grace';
      text = `⚠️ <b>${name}</b>: obuna muddati tugadi. ${formatDate(s.graceEndsAt!)} gacha to'lov qilinmasa, ilova faqat ko'rish rejimiga o'tadi.\n«💳 To'lov» ni bosing.`;
    } else if (s.state === 'expired' && now.getTime() - s.graceEndsAt!.getTime() < 7 * 86_400_000) {
      key = 'expired';
      text = `🔒 <b>${name}</b>: ilova faqat ko'rish rejimida. Ma'lumotlaringiz saqlangan — to'lovdan keyin hammasi ochiladi.\n«💳 To'lov» ni bosing.`;
    }
    if (!key) continue;
    const full = `${key}:${s.endsAt.toISOString().slice(0, 10)}`;
    if (hall.lastReminder === full) continue;
    await notifier.toUser(telegramId, text);
    await db.update(halls).set({ lastReminder: full }).where(eq(halls.id, hall.id));
    sent++;
  }
  return sent;
}

export function startReminders(db: Db, notifier: Notifier, now: () => Date) {
  const tick = () => runReminders(db, notifier, now()).catch((e) => console.error('reminders', e));
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, 60 * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
