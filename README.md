# GreenTable

Biliardxona boshqaruv tizimi — bilyard zalini boshqarish va pul oqimini kuzatish uchun mobil ilova
(Expo SDK 57, React Native, TypeScript) va uning serveri (oylik obuna, Telegram bot, admin panel).

Ilova **oflayn ham ishlaydi**: ma'lumot telefondagi SQLite bazasida, internet bo'lganda server orqali biliardxonaning
barcha qurilmalari bilan avtomatik sinxronlanadi.

## Imkoniyatlar

- **Zal** — stollar gridi: bo'sh / band / pauza, jonli taymer va joriy summa. Seansni boshlash, pauza,
  boshqa stolga ko'chirish (eski vaqt eski narxda hisoblanadi), mahsulot qo'shish. Stollar soni erkin:
  "Stol qo'shish" kartasi, sozlamalarda olib tashlash/qaytarish (tarixi saqlanadi). Bo'sh biliardxonada — tez sozlash.
- **Unutilgan seans** — boshlanish vaqtini boshlashda yoki keyin, tugash vaqtini to'lovda qo'lda kiritish
  ("15 daqiqa oldin" tugmalari yoki aniq soat, 24 soatgacha orqaga).
- **Savdo** — stolsiz savdo: *tezkor savdo* (darhol to'lanadi) yoki *odam nomiga ochiq hisob*.
- **To'lov** — hisoblangan summa ko'rsatiladi, admin yakuniy summani o'zgartira oladi; farq chegirma/ustama
  bo'lib chiqadi. Naqd / karta / o'tkazma aralash, qaytim, qolgan summani qarzga yozish.
- **Qarz daftari**, **Kassa (hisobot)**, **Xarajatlar**, **Chek** (rasm sifatida ulashiladi).
- **Bir nechta qurilma** — egasi va sheriklari bitta biliardxonada ishlaydi: o'zgarishlar 15 soniya ichida
  boshqa telefonlarda ko'rinadi (ochiq stollar ham).
- **Obuna** — biliardxona uchun oylik to'lov, birinchi marta bepul sinov; muddat tugasa imtiyoz kunlari, keyin
  faqat ko'rish rejimi (ma'lumot yo'qolmaydi). Kirish, to'lov cheki va promo kod — Telegram bot orqali.

## Tuzilma

```
src/                ilova (Expo Router)
  app/              ekranlar: (tabs)/ Zal, Savdo, Qarzlar, Kassa, Sozlamalar; login, settings/account, ...
  components/       UI: SyncProvider (kirish va sinxron holati), SubscriptionStatus, QuickSetup, ...
  db/               SQLite sxema/migratsiyalar (3-migratsiya: sinxron triggerlari), useQuery
  services/         biznes mantiq (testlanadi)
  sync/             server bilan sinxron: codec, apply, engine, api, session
server/             server (Railway)
  src/              Hono API, grammY bot, Drizzle sxema, obuna/chegirma/sinxron servislari
  admin/            admin panel (Vite + React + Mantine), /admin da
  drizzle/          Postgres migratsiyalari (drizzle-kit generate)
  test/             vitest + PGlite (xotiradagi Postgres)
__tests__/          ilova testlari (jest + node:sqlite); test/fakeServer.ts — server sinxron mantiqining nusxasi
```

## Ilovani ishga tushirish

```sh
npm install
npx expo start
```

USB orqali (Wi-Fi'siz), Git Bash'da:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first npx expo start --localhost
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent
```

Server manzili `EXPO_PUBLIC_API_URL` (`.env` yoki `eas.json` → `build.base.env`); bo'lmasa Railway'dagi asosiy server.

## Server

```sh
cd server
npm install
npm test                      # vitest: obuna, chegirma, kirish, sinxron, HTTP
npm run typecheck
npm run build                 # admin panel → dist/admin
npm run dev                   # lokal: PGlite (.data/pg), BOT_TOKEN bo'lsa bot polling rejimida
node scripts/dev-seed.ts      # lokal namunaviy ma'lumot + admin sessiya tokeni
npm run db:generate           # sxema o'zgarsa yangi migratsiya
```

Node 24+ (TypeScript fayllar to'g'ridan-to'g'ri ishlaydi, build kerak emas — faqat admin panel yig'iladi).

**Railway** (`greentable` loyihasi): `server` servisi + Postgres. Deploy: `cd server && railway up`.
O'zgaruvchilar:

| Nomi | Ma'nosi |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_URL` | serverning https manzili (webhook va panel havolalari) |
| `BOT_TOKEN` | @BotFather tokeni — faqat Railway'da, repoga yozilmaydi |
| `TG_WEBHOOK_SECRET` | Telegram webhook so'rovini tekshirish uchun tasodifiy qator |
| `ADMIN_TELEGRAM_IDS` | admin panel kodi yuboriladigan Telegram ID'lar (vergul bilan); botga `/id` yozib bilinadi |

**Admin panel**: `<PUBLIC_URL>/admin` — kirish kodi botdan keladi (admin avval botga `/start` yozgan bo'lishi kerak).
Bo'limlar: bosh sahifa, cheklar (summa → kunlar, tasdiqlash/rad etish), biliardxonalar (muddat, qurilma limiti,
bloklash, chegirma), narxlar (oylik narx, sinov va imtiyoz kunlari, to'lov rekvizitlari), chegirmalar (promo kod va kampaniya).

## Tekshiruvlar

```sh
npm test          # ilova: hisob-kitob, servislar, ikki qurilma sinxroni
npm run typecheck
npm run lint
cd server && npm test && npm run typecheck
```

## APK

Yig'ish va chiqarish — `.claude/skills/android-release` (EAS, kerak bo'lsa lokal Gradle).
Har yangi versiyada `app.json` dagi `version` va `android.versionCode` oshiriladi va **aynan shu kalit** bilan imzolanadi.

## Brend

- Logo manbasi: `assets/brand/greentable-logo.png`.
- Ranglar `src/theme.ts` da: grafit fon `#121417`, zumrad `#00C853`, oltin `#D4AF37`, oq, kulrang `#8C929D`,
  xavfli amallar uchun qizil `#FF5A5F`. Admin panel ham shu ranglarda.

## Muhim qarorlar

- Summalar so'mda **butun son**. Taymer vaqt belgilaridan hisoblanadi. Stol narxi seans boshida yozib qo'yiladi.
- Har bir yozuvda global `uid` va `updated_at`. **Sinxron**: triggerlar har o'zgarishni `sync_outbox` ga yozadi va
  `updated_at` ni oshiradi (servislar sinxron haqida bilmaydi). Server yozuvlarni JSON ko'rinishida saqlaydi
  (`sync_rows`), har yozuvga `rev` beradi; qurilma avval `rev` bo'yicha yangilarini oladi, keyin o'zinikini yuboradi.
  Bir xil yozuvda **oxirgi o'zgarish yutadi** — shuning uchun telefon soati to'g'ri bo'lishi kerak (farq bo'lsa ilova ogohlantiradi).
- Birinchi sinxronda stol/mahsulot/xarajat turi/mijoz nomi bo'yicha moslanadi (v1 dan qolgan ma'lumot ikki marta
  paydo bo'lmasin); keyin — faqat `uid` bo'yicha.
- "Tarixni tozalash" serverda bajariladi (faqat egasi): biliardxonaning `data_epoch` i oshadi va barcha qurilmalar
  lokal bazani tozalab, serverdan qaytadan yuklaydi.
- Ombor qoldig'i hisoblanadi: kirim/sanoq (`stock_moves`) − bekor qilinmagan cheklardagi sotuv.
- Obuna biliardxonaga bog'liq; narx — oylik narx minus eng katta faol chegirma (chegirmalar qo'shilmaydi).
  Chek tasdiqlanganda kunlar = summa ÷ chegirmali narx × 30, muddat joriy muddat (sinov ham) ustiga qo'shiladi.
- Ish kuni sukut bo'yicha 06:00 da boshlanadi: tungi o'yinlar kechagi kun hisobotiga tushadi (sozlanadi).

### Yangi migratsiya qo'shish

Ilova: `src/db/migrations.ts` dagi `MIGRATIONS` oxiriga yangi SQL (eskilarini o'zgartirmang; yangi sinxron jadval
bo'lsa `SYNC_TABLES`, `src/sync/codec.ts`, `src/sync/apply.ts` va `server/src/services/sync.ts` dagi ro'yxatga qo'shing).
Server: `server/src/db/schema.ts` ni o'zgartirib, `npm run db:generate`.
