import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { halls, users } from '../db/schema.ts';
import type { Notifier } from '../notifier.ts';
import { hallBilling, runBilling } from '../services/billing.ts';
import { escapeHtml, formatDate, formatSom } from '../services/util.ts';

/**
 * Pul (yoki sinov) tugashiga 3 kun va 1 kun qolganda, imtiyozga va faqat-ko'rish rejimiga
 * o'tganda egasiga bitta xabar. `lastReminder` takror yubormaslik uchun: kalit + taxminiy tugash sanasi
 * (to'lovdan keyin sana o'zgaradi — eslatmalar qaytadan ishlaydi).
 */
export async function runReminders(db: Db, notifier: Notifier, now: Date): Promise<number> {
  if (!notifier.botUsername) return 0;
  const rows = await db
    .select({ hall: halls, telegramId: users.telegramId })
    .from(halls)
    .innerJoin(users, eq(users.id, halls.ownerUserId))
    .where(eq(halls.blocked, false));
  let sent = 0;
  for (const { hall, telegramId } of rows) {
    const b = await hallBilling(db, hall, now);
    const s = b.status;
    if (!s.endsAt) continue;
    let key: string | null = null;
    let text = '';
    const name = escapeHtml(hall.name);
    const pay = "\nTo'ldirish uchun botda «💳 To'lov» ni bosing.";
    if ((s.state === 'trial' || s.state === 'active') && s.daysLeft <= 3) {
      key = s.daysLeft <= 1 ? 'd1' : 'd3';
      const when = s.daysLeft <= 1 ? 'ertaga' : `${s.daysLeft} kundan keyin`;
      text =
        s.state === 'trial' && hall.balance < b.daily
          ? `⏳ <b>${name}</b>: sinov muddati ${when} tugaydi (${formatDate(s.endsAt)}). Keyin kuniga ${formatSom(b.daily)} yechiladi.${pay}`
          : `⏳ <b>${name}</b>: balansdagi pul ${when} tugaydi (${formatSom(hall.balance)}, kuniga ${formatSom(b.daily)}).${pay}`;
    } else if (s.state === 'grace') {
      key = 'grace';
      text = `⚠️ <b>${name}</b>: balans tugadi (${formatSom(hall.balance)}). ${formatDate(s.graceEndsAt!)} gacha to'lov qilinmasa, ilova faqat ko'rish rejimiga o'tadi.${pay}`;
    } else if (s.state === 'expired' && now.getTime() - s.graceEndsAt!.getTime() < 7 * 86_400_000) {
      key = 'expired';
      text = `🔒 <b>${name}</b>: ilova faqat ko'rish rejimida. Ma'lumotlaringiz saqlangan — to'lovdan keyin hammasi ochiladi.${pay}`;
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

/** Har soatda: avval kunlik to'lovlar yechiladi, keyin eslatmalar. */
export function startReminders(db: Db, notifier: Notifier, now: () => Date) {
  const tick = async () => {
    try {
      await runBilling(db, now());
      await runReminders(db, notifier, now());
    } catch (e) {
      console.error('billing/reminders', e);
    }
  };
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, 60 * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
