// Lokal ishlab chiqish uchun namunaviy ma'lumot (.data/pg) va admin sessiya tokeni.
// Foydalanish: node scripts/dev-seed.ts  → chiqqan tokenni brauzerda `gt_admin` cookie sifatida qo'ying.
import { openDatabase } from '../src/db/client.ts';
import { adminSessions } from '../src/db/schema.ts';
import { approveReceipt, createReceipt } from '../src/services/billing.ts';
import { createDiscount, redeemPromo } from '../src/services/discounts.ts';
import { createHall } from '../src/services/halls.ts';
import { updatePricing } from '../src/services/pricing.ts';
import { getUser, setPhone, upsertTelegramUser } from '../src/services/users.ts';
import { randomToken, sha256 } from '../src/services/util.ts';

if (process.env.DATABASE_URL) throw new Error('Faqat lokal PGlite uchun');

const { db, close } = await openDatabase({ dataDir: '.data/pg' });
const DAY = 86_400_000;
const now = new Date();
const ago = (d: number) => new Date(now.getTime() - d * DAY);

await updatePricing(db, {
  monthlyPrice: 99_000,
  trialDays: 14,
  graceDays: 3,
  defaultDeviceLimit: 3,
  paymentText: 'Karta: 8600 0000 0000 0000\nQabul qiluvchi: Ism Familiya',
  supportText: 'Savollar uchun: @greentable_admin',
});
const base = { code: null, percent: null, amount: null, validFrom: null, validTo: null, benefitMonths: null, maxUses: null, newOnly: false, active: true, note: null };
await createDiscount(db, { ...base, kind: 'campaign', percent: 30, validFrom: ago(40), validTo: ago(20), benefitMonths: 3, note: 'Ochilish aksiyasi' });
await createDiscount(db, { ...base, kind: 'promo', code: 'YANGI20', percent: 20, benefitMonths: 2, maxUses: 100, note: 'Instagram' });
await createDiscount(db, { ...base, kind: 'promo', code: 'DO‘ST', amount: 15_000, newOnly: true });

const people = [
  ['Sardor', 'Grand Biliard', 30],
  ['Anvar', 'VIP Club', 25],
  ['Dilshod', 'Piramida', 16],
  ['Javohir', 'Shar Arena', 5],
  ['Bobur', 'Kiy Biliard', 2],
] as const;
let tg = 900_000;
for (const [name, hallName, daysAgo] of people) {
  const u0 = await upsertTelegramUser(db, { id: tg++, first_name: name, username: name.toLowerCase() });
  await setPhone(db, u0.id, `+99890${String(tg).slice(-7)}`);
  const u = (await getUser(db, u0.id))!;
  const hall = await createHall(db, u, hallName, ago(daysAgo));
  if (name === 'Anvar') await redeemPromo(db, hall.id, 'YANGI20', ago(20));
  if (name === 'Sardor') {
    const r = await createReceipt(db, { hallId: hall.id, userId: u.id, fileId: 'demo', fileKind: 'photo', mimeType: null, caption: null }, ago(15));
    await approveReceipt(db, r.id, { amount: 198_000, days: 60 }, ago(15));
  }
  if (name === 'Anvar' || name === 'Dilshod') {
    await createReceipt(db, { hallId: hall.id, userId: u.id, fileId: 'demo', fileKind: 'photo', mimeType: null, caption: name === 'Anvar' ? 'Oktyabr uchun' : null }, ago(0.1));
  }
}

const token = randomToken(32);
await db.insert(adminSessions).values({ tokenHash: sha256(token), expiresAt: new Date(now.getTime() + 30 * DAY) });
console.log(token);
await close();
