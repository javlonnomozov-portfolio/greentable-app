/** So'm summalari butun son sifatida saqlanadi va ko'rsatiladi. */
export function formatSom(amount: number, withCurrency = true): string {
  const sign = amount < 0 ? '−' : '';
  const digits = Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return withCurrency ? `${sign}${digits} so'm` : `${sign}${digits}`;
}

/** Foydalanuvchi kiritgan matndan (masalan "45 000") butun son oladi. */
export function parseSom(text: string): number {
  const digits = text.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

/** Input maydonida ko'rsatish uchun: 0 bo'lsa bo'sh qator. */
export function somInputValue(amount: number): string {
  return amount > 0 ? formatSom(amount, false) : '';
}
