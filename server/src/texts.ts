// Bot va bildirishnomalarning umumiy matnlari (o'zbek lotinida).
import type { SubState } from './contract.ts';
import type { HallBilling } from './services/billing.ts';
import { discountLabel } from './services/discounts.ts';
import { escapeHtml, formatDate, formatSom } from './services/util.ts';

export const STATE_LABEL: Record<SubState, string> = {
  trial: '🎁 Sinov muddati',
  active: '✅ Faol',
  grace: '⚠️ Muddat tugadi (imtiyoz kunlari)',
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
  const lines = [`Holat: ${STATE_LABEL[s.state]}`];
  if (s.endsAt) {
    if (s.state === 'trial' || s.state === 'active') lines.push(`Muddat: ${formatDate(s.endsAt)} gacha (${s.daysLeft} kun)`);
    else if (s.state === 'grace' && s.graceEndsAt) lines.push(`Imtiyoz: ${formatDate(s.graceEndsAt)} gacha, keyin ilova faqat ko'rish rejimiga o'tadi`);
    else lines.push(`Muddat tugagan: ${formatDate(s.endsAt)}`);
  }
  lines.push(`Oylik narx: ${priceLine(b)}`);
  return lines.join('\n');
}
