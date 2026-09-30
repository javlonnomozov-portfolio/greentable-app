# GreenTable

Biliardxona boshqaruv tizimi — bilyard zalini boshqarish va pul oqimini kuzatish uchun mobil ilova
(Expo SDK 57, React Native, TypeScript).
Internetsiz ishlaydi — barcha ma'lumotlar qurilmadagi SQLite bazasida saqlanadi.

## Imkoniyatlar

- **Zal** — stollar gridi: bo'sh / band / pauza, jonli taymer va joriy summa. Seansni boshlash, pauza,
  boshqa stolga ko'chirish (eski vaqt eski narxda hisoblanadi), mahsulot qo'shish. Stollar soni erkin:
  "Stol qo'shish" kartasi, sozlamalarda olib tashlash/qaytarish (tarixi saqlanadi).
- **Unutilgan seans** — boshlanish vaqtini boshlashda yoki keyin, tugash vaqtini to'lovda qo'lda kiritish
  ("15 daqiqa oldin" tugmalari yoki aniq soat, 24 soatgacha orqaga).
- **Savdo** — stolsiz savdo: *tezkor savdo* (darhol to'lanadi) yoki *odam nomiga ochiq hisob*
  (vaqt o'tishi bilan mahsulot qo'shiladi, keyin yopiladi).
- **To'lov** — hisoblangan summa ko'rsatiladi, lekin admin yakuniy summani o'zgartira oladi (112 000 → 100 000
  yoki 115 000); farq chekda va hisobotda chegirma/ustama bo'lib chiqadi. Naqd / karta / o'tkazma aralash,
  qaytim, qolgan summani qarzga yozish.
- **Qarz daftari** — mijozlar, balans, qarz tarixi, qarzni to'lash, qo'lda qarz yozish.
- **Kassa (hisobot)** — kun / hafta / oy: tushum (stol vaqti, stoldagi bar, stolsiz savdo), kassa bo'yicha
  kirim-chiqim, xarajatlar, qarzlar, sof foyda, kunlik grafik, stollar va top mahsulotlar, cheklar ro'yxati.
- **Xarajatlar** — turlari bo'yicha; ombor kirimi xarid summasi bilan avtomatik xarajatga yoziladi.
- **Sozlamalar** — stollar va soatlik narx, mahsulotlar va ombor, yaxlitlash (qadam va yo'nalish),
  ish kuni boshlanish soati, klub nomi, egasi PIN kodi, zaxira va almashish, tarixni tozalash.
- **Ikki telefon** — egasi va sherigi kunma-kun ishlaydi: kun (hafta, oy yoki butun tarix) uchun zaxira fayli
  olinadi, Telegram orqali yuboriladi va ikkinchi telefonda **birlashtiriladi** (hech narsa o'chmaydi,
  qayta import takrorlamaydi, bekor qilingan chek va to'langan qarz ham o'tadi).
- **Chek** — ekranda ko'rsatiladi va rasm sifatida ulashiladi (printer talab qilinmaydi).

## Ishga tushirish

```sh
npm install
npx expo start
```

Telefonga **Expo Go** ilovasini o'rnating (SDK 57 ni qo'llab-quvvatlaydigan versiya) va terminaldagi QR kodni skanerlang.
Telefon va kompyuter bitta Wi-Fi tarmog'ida bo'lishi kerak.

USB orqali (Wi-Fi'siz), Git Bash'da:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first npx expo start --localhost
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent
```

`NODE_OPTIONS` shart: Windows'da Metro aks holda faqat IPv6 (`::1`) da tinglaydi, `adb reverse` esa IPv4 ga ulanadi.

## Tekshiruvlar

```sh
npm test          # hisob-kitob va servislar testlari (Node'ning node:sqlite moduli bilan haqiqiy SQL)
npm run typecheck
npm run lint
```

Testlar Node 22.5+ talab qiladi (`node:sqlite`).

## APK yig'ish (mijozga berish uchun)

Tayyor APK'lar: [Releases](../../releases) bo'limida.

### Shu kompyuterda (akkauntsiz)

Kerak: JDK 17 va Android SDK (command-line tools). Git Bash'da:

```sh
export JAVA_HOME=~/.jdks/jdk-17.0.20.1+1 ANDROID_HOME=~/Android/Sdk
npx expo prebuild --platform android --clean     # android/ papkasi app.json'dan yaratiladi (git'ga kirmaydi)
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
# imzolash (kalit repoda EMAS, ~/.greentable/ da saqlanadi):
$ANDROID_HOME/build-tools/<versiya>/apksigner.bat sign --ks ~/.greentable/greentable-release.jks \
  --out greentable-<versiya>.apk app/build/outputs/apk/release/app-release.apk
```

Keyingi versiyalarda `app.json` dagi `version` va `android.versionCode` ni oshiring va **aynan shu kalit** bilan
imzolang — aks holda telefondagi ilovani yangilab bo'lmaydi.

### EAS (Expo bulutida)

```sh
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

Android paket nomi `app.json` da: `uz.greentable.app`.

### Zaxira faylini ochish

APK o'rnatilgan telefonda Telegram yoki fayl menejeridagi zaxira fayli (`.json`) bosilganda "Open with" ro'yxatida
**GreenTable** chiqadi — tanlansa, zaxira sahifasi ochilib birlashtirish so'raladi (PIN o'rnatilgan bo'lsa, avval PIN).
Bu faqat o'rnatilgan ilovada ishlaydi, Expo Go'da emas.

## Brend

- Logo manbasi: `assets/brand/greentable-logo.png`. Ikonka, adaptiv ikonka (fon/old qism/monoxrom), splash va
  `logo-mark.png` shundan olingan.
- Ranglar `src/theme.ts` da: grafit fon `#121417`, zumrad `#00C853` (brend, band stollar, kirim),
  oltin `#D4AF37` (taymerlar, pauza, qarz), oq `#FFFFFF` (matn), kulrang `#8C929D` (ikkinchi darajali, bo'sh stollar).
  Xavfli amallar uchun qo'shimcha qizil `#FF5A5F`.
- Ilova qorong'i mavzuda; chek esa ulashilganda o'qilishi uchun oq qog'oz ko'rinishida.

## Tuzilma

```
src/
  app/            ekranlar (Expo Router): (tabs)/ Zal, Savdo, Qarzlar, Kassa, Sozlamalar
  components/     umumiy UI: TableCard, ProductPicker, CustomerPicker, PinProvider, ...
  db/             sxema/migratsiyalar, useQuery hook, Db interfeysi
  services/       biznes mantiq (ekranlarga bog'liq emas, testlanadi)
    billing.ts    sof hisob-kitob: vaqt, yaxlitlash, to'lov taqsimoti
    bills.ts      seans, savdo, hisobni yopish/bekor qilish
    customers.ts  qarz daftari
    reports.ts    hisobot va davrlar
    backup.ts     zaxira eksport, ikki telefon ma'lumotini birlashtirish, tarixni tozalash
__tests__/        jest testlari
test/nodeDb.ts    testlar uchun xotiradagi SQLite adapteri
```

### Muhim qarorlar

- Summalar so'mda **butun son** sifatida saqlanadi.
- Taymer vaqt belgilaridan hisoblanadi (`started_at`, `paused_ms`) — ilova yopilsa ham vaqt yo'qolmaydi.
- Stol narxi seans boshida yozib qo'yiladi — narx o'zgarsa ochiq seanslarga ta'sir qilmaydi.
- Boshlangan har bir daqiqa to'liq hisoblanadi, keyin stol vaqti summasi sozlamaga ko'ra yaxlitlanadi.
- Chek yopish, qarz va to'lov bitta tranzaksiyada yoziladi. Tranzaksiyalar navbat bilan bajariladi.
- Har bir yozuvda global `uid` va `updated_at` bor: ikki telefon ma'lumoti `uid` bo'yicha birlashtiriladi,
  bir xil yozuvda keyinroq o'zgargani qoladi. Stol/mahsulot/xarajat turi/mijoz `uid` bo'yicha topilmasa,
  nomi bo'yicha moslanadi. Namunaviy stol va mahsulotlar har telefonda bir xil `uid` oladi (`seed-table-1`...).
- Yozuvlar butunlay o'chirilmaydi: chek `cancelled` holatiga o'tadi, to'lov/qarz/xarajat `deleted_at` bilan
  belgilanadi — shunda o'chirish ham boshqa telefonga yetib boradi.
- Ombor qoldig'i saqlanmaydi, hisoblanadi: kirim/sanoq harakatlari (`stock_moves`) − bekor qilinmagan cheklardagi sotuv.
- Ochiq hisoblar (o'ynalayotgan stol, yopilmagan savdo) zaxira fayliga kirmaydi.
- Yakuniy summa hisoblangandan farq qilsa, farq `bills.discount` ga yoziladi (manfiy — ustama).
- Ish kuni sukut bo'yicha 06:00 da boshlanadi: tungi o'yinlar kechagi kun hisobotiga tushadi (sozlanadi).

### Yangi migratsiya qo'shish

`src/db/migrations.ts` dagi `MIGRATIONS` massivining oxiriga yangi SQL qo'shing. Eski elementlarni o'zgartirmang.
