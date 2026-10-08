import type { SubState } from '../../src/contract.ts';

export const som = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;

const pad = (n: number) => String(n).padStart(2, '0');

export function date(v: string | number | Date | null | undefined): string {
  if (v == null) return '—';
  const d = new Date(v);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function dateTime(v: string | number | Date | null | undefined): string {
  if (v == null) return '—';
  const d = new Date(v);
  return `${date(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="date"> qiymati → ISO (kun oxiri emas, 23:59 — "shu kungacha" ma'nosida). */
export const dateInputToIso = (v: string, endOfDay = false) => (v ? new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString() : null);
export function isoToDateInput(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const STATE: Record<SubState, { label: string; color: string }> = {
  trial: { label: 'Sinov', color: 'blue' },
  active: { label: 'Faol', color: 'emerald' },
  grace: { label: 'Imtiyoz', color: 'yellow' },
  expired: { label: 'Tugagan', color: 'red' },
};

export const tgLink = (u: { username: string | null; telegramId: number }) =>
  u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.telegramId}`;
