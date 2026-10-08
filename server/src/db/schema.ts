import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

/** Bot suhbatining joriy qadami (foydalanuvchi navbatdagi xabarda nima yuborishi kutilmoqda). */
export type BotState =
  | { step: 'contact'; then: BotIntent }
  | { step: 'hall_name'; then: BotIntent }
  | { step: 'promo' }
  | { step: 'receipt' }
  /** Kirish so'rovi biliardxona tanlash yoki eski qurilmani o'chirishni kutmoqda. */
  | { step: 'pending_login'; token: string };

/** Telefon raqami yoki biliardxona nomi olingach davom ettiriladigan amal. */
export type BotIntent = { kind: 'login'; token: string } | { kind: 'join'; code: string } | { kind: 'menu' };

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  username: text('username'),
  phone: text('phone'),
  /** Bot menyusidagi amallar shu biliardxonaga tegishli (bir nechta biliardxonasi bo'lsa). */
  activeHallId: uuid('active_hall_id'),
  botState: jsonb('bot_state').$type<BotState | null>(),
  /** Sinov muddatini bir marta olgani. */
  trialUsedAt: ts('trial_used_at'),
  blocked: boolean('blocked').notNull().default(false),
  createdAt: createdAt(),
});

export const halls = pgTable('halls', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerUserId: integer('owner_user_id')
    .notNull()
    .references(() => users.id),
  trialEndsAt: ts('trial_ends_at'),
  paidUntil: ts('paid_until'),
  /** null — umumiy sozlamadagi limit. */
  deviceLimit: integer('device_limit'),
  /** "Tarixni tozalash"da oshiriladi: qurilmalar lokal bazasini tozalab, qaytadan yuklaydi. */
  dataEpoch: integer('data_epoch').notNull().default(1),
  blocked: boolean('blocked').notNull().default(false),
  /** Oxirgi yuborilgan eslatma kaliti (takror yubormaslik uchun). */
  lastReminder: text('last_reminder'),
  createdAt: createdAt(),
});

export type Role = 'owner' | 'admin';

export const hallMembers = pgTable(
  'hall_members',
  {
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.hallId, t.userId] })],
);

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  hallId: uuid('hall_id')
    .notNull()
    .references(() => halls.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  usedBy: integer('used_by').references(() => users.id),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** Ilova o'rnatilganda yaratiladigan tasodifiy id: qayta kirishda eski token bekor qilinadi. */
    installId: text('install_id').notNull(),
    model: text('model'),
    tokenHash: text('token_hash').notNull().unique(),
    lastSeenAt: ts('last_seen_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('devices_hall_idx').on(t.hallId)],
);

export type LoginStatus = 'pending' | 'confirmed' | 'consumed';

export const loginRequests = pgTable('login_requests', {
  token: text('token').primaryKey(),
  installId: text('install_id').notNull(),
  model: text('model'),
  status: text('status').$type<LoginStatus>().notNull().default('pending'),
  userId: integer('user_id').references(() => users.id),
  hallId: uuid('hall_id').references(() => halls.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
});

export const pricing = pgTable('pricing', {
  id: integer('id').primaryKey().default(1),
  monthlyPrice: integer('monthly_price').notNull(),
  trialDays: integer('trial_days').notNull(),
  graceDays: integer('grace_days').notNull(),
  defaultDeviceLimit: integer('default_device_limit').notNull(),
  /** Botda to'lov uchun ko'rsatiladigan matn: karta raqami, qabul qiluvchi. */
  paymentText: text('payment_text').notNull().default(''),
  /** Botdagi "Yordam" javobi. */
  supportText: text('support_text').notNull().default(''),
  updatedAt: createdAt(),
});

export type DiscountKind = 'promo' | 'campaign';

export const discounts = pgTable(
  'discounts',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').$type<DiscountKind>().notNull(),
    /** Promo kod (katta harflarda). Kampaniyada bo'sh. */
    code: text('code'),
    percent: integer('percent'),
    amount: integer('amount'),
    /** Amal qilish oynasi: promo shu oraliqda kiritiladi, kampaniya shu oraliqda ro'yxatdan o'tganlarga beriladi. */
    validFrom: ts('valid_from'),
    validTo: ts('valid_to'),
    /** Chegirma biriktirilgandan keyin necha oy amal qiladi. null — cheksiz. */
    benefitMonths: integer('benefit_months'),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    /** Faqat hali to'lov qilmagan biliardxonalar uchun. */
    newOnly: boolean('new_only').notNull().default(false),
    active: boolean('active').notNull().default(true),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('discounts_code_idx').on(t.code)],
);

export const hallDiscounts = pgTable(
  'hall_discounts',
  {
    id: serial('id').primaryKey(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    discountId: integer('discount_id')
      .notNull()
      .references(() => discounts.id, { onDelete: 'cascade' }),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('hall_discounts_uniq').on(t.hallId, t.discountId)],
);

export type ReceiptStatus = 'pending' | 'approved' | 'rejected';

export const receipts = pgTable(
  'receipts',
  {
    id: serial('id').primaryKey(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    fileId: text('file_id').notNull(),
    fileKind: text('file_kind').$type<'photo' | 'document'>().notNull(),
    mimeType: text('mime_type'),
    caption: text('caption'),
    status: text('status').$type<ReceiptStatus>().notNull().default('pending'),
    amount: integer('amount'),
    daysAdded: integer('days_added'),
    /** Tasdiqlash paytidagi oylik narx (chegirma bilan). */
    priceAtReview: integer('price_at_review'),
    rejectReason: text('reject_reason'),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('receipts_status_idx').on(t.status, t.createdAt)],
);

export type SubscriptionEventKind = 'trial' | 'payment' | 'extend' | 'set' | 'discount';

export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: serial('id').primaryKey(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<SubscriptionEventKind>().notNull(),
    days: integer('days'),
    amount: integer('amount'),
    fromDate: ts('from_date'),
    toDate: ts('to_date'),
    receiptId: integer('receipt_id').references(() => receipts.id),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('subscription_events_hall_idx').on(t.hallId, t.createdAt)],
);

/**
 * Ilova jadvallarining nusxasi: har qator JSON. Server ilova sxemasini bilmaydi —
 * ilovaga ustun qo'shilsa, server migratsiyasi kerak emas. `rev` — pull uchun kursor.
 */
export const syncRows = pgTable(
  'sync_rows',
  {
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    tbl: text('tbl').notNull(),
    uid: text('uid').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    /** Qurilmadagi o'zgarish vaqti (ms) — oxirgi yozuv yutadi. */
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deleted: boolean('deleted').notNull().default(false),
    deviceId: uuid('device_id'),
    rev: bigserial('rev', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.hallId, t.tbl, t.uid] }), index('sync_rows_rev_idx').on(t.hallId, t.rev)],
);

export const adminOtps = pgTable('admin_otps', {
  id: serial('id').primaryKey(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

export const adminSessions = pgTable('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
});
