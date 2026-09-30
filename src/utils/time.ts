import dayjs from 'dayjs';

const pad = (n: number) => n.toString().padStart(2, '0');

/** Taymer ko'rinishi: 1:05:09 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** Daqiqalarni o'qiladigan ko'rinishda: "1 soat 5 daq" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} daq`;
  if (m === 0) return `${h} soat`;
  return `${h} soat ${m} daq`;
}

/** "hozir", "25 daq oldin", "1 soat 5 daq oldin". */
export function formatAgo(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes <= 0 ? 'hozir' : `${formatMinutes(minutes)} oldin`;
}

/**
 * Soat va daqiqani `reference` ga eng yaqin o'tgan paytga aylantiradi:
 * soat 00:30 da 23:40 tanlansa — kechagi 23:40.
 */
export function clockToTimestamp(hour: number, minute: number, reference: number): number {
  let d = dayjs(reference).hour(hour).minute(minute).second(0).millisecond(0);
  if (d.valueOf() > reference + 60_000) d = d.subtract(1, 'day');
  return d.valueOf();
}

export function formatDateTime(ts: number): string {
  return dayjs(ts).format('DD.MM.YYYY HH:mm');
}

export function formatDate(ts: number): string {
  return dayjs(ts).format('DD.MM.YYYY');
}

export function formatTime(ts: number): string {
  return dayjs(ts).format('HH:mm');
}
