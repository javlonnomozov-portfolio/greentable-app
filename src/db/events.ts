/**
 * Yozuvdan keyin ekranlarni yangilash signali. SQLite o'zgarish hodisalari
 * tranzaksiya tugashidan oldin kelishi mumkin, shuning uchun har bir amal
 * muvaffaqiyatli tugagach bu signal ham yuboriladi.
 */
const listeners = new Set<() => void>();

export function onDbChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyDbChanged(): void {
  listeners.forEach((l) => l());
}
