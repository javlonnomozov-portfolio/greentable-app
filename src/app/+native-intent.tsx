/**
 * Tashqaridan kelgan havolalarni ilova ichidagi sahifaga yo'naltiradi.
 * Telegram yoki fayl menejerida zaxira fayli (.json) "Open with → GreenTable" orqali ochilsa,
 * Android `content://...` (yoki `file://...`) manzilni beradi — u zaxira sahifasiga uzatiladi
 * va o'sha yerda faylni birlashtirish so'raladi.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.startsWith('content://') || path.startsWith('file://')) {
      return `/settings/backup?import=${encodeURIComponent(path)}`;
    }
    return path;
  } catch {
    // Bu funksiya ichida xato ilovani yiqitmasligi kerak.
    return '/';
  }
}
