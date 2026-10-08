// Bot va bildirishnomalarning umumiy matnlari (o'zbek lotinida).
import type { SubState } from './contract.ts';
import type { HallBilling } from './services/billing.ts';
import { discountLabel } from './services/discounts.ts';
import { escapeHtml, formatDate, formatSom } from './services/util.ts';

export const STATE_LABEL: Record<SubState, string> = {
  trial: '🎁 Sinov muddati',
  active: '✅ Faol',
  grace: '⚠️ Balans tugadi (imtiyoz kunlari)',
  expired: "🔒 Faqat ko'rish rejimi",
};

/** "80 000 so'm (−20%, 01.12.2026 gacha)" yoki "100 000 so'm" */
export function priceLine(b: HallBilling): string {
  if (!b.discount) return formatSom(b.price);
  const until = b.discount.endsAt ? `, ${formatDate(b.discount.endsAt)} gacha` : '';
  return `<s>${formatSom(b.pricing.monthlyPrice)}</s> ${formatSom(b.price)} (${escapeHtml(discountLabel(b.discount))}${until})`;
}

export function statusLines(b: HallBilling): string {
  const s = b.status;
  const h = b.hall;
  const lines = [`Holat: ${STATE_LABEL[s.state]}`];
  if (s.state === 'trial' && h.trialEndsAt) lines.push(`Sinov: ${formatDate(h.trialEndsAt)} gacha bepul`);
  lines.push(`Balans: <b>${formatSom(h.balance)}</b> (kuniga ${formatSom(b.daily)})`);
  if ((s.state === 'trial' || s.state === 'active') && s.endsAt) {
    lines.push(`Pul taxminan ${formatDate(s.endsAt)} gacha yetadi (${Math.max(0, s.daysLeft)} kun)`);
  } else if (s.state === 'grace' && s.graceEndsAt) {
    lines.push(`${formatDate(s.graceEndsAt)} gacha to'lov qilinmasa, ilova faqat ko'rish rejimiga o'tadi`);
  }
  lines.push(`30 kunlik narx: ${priceLine(b)}`);
  return lines.join('\n');
}
