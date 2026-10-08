import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** URL va Telegram start parametriga mos tasodifiy token (A-Z a-z 0-9 _ -). */
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Odam o'qib, qo'lda yozsa ham adashmaydigan kod (0/O, 1/I yo'q). */
export function readableCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

export const digits = (length: number) => String(randomInt(10 ** length)).padStart(length, '0');

/** 1234567 → "1 234 567 so'm" */
export const formatSom = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;

/** Toshkent vaqti bilan sana: 08.10.2026 */
export function formatDate(d: Date): string {
  const t = new Date(d.getTime() + 5 * 3_600_000);
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${t.getUTCFullYear()}`;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Oddiy xotiradagi cheklovchi: `key` bo'yicha `windowMs` ichida `max` ta so'rov. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()): boolean => {
    const h = hits.get(key);
    if (!h || h.reset <= now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= max;
  };
}
