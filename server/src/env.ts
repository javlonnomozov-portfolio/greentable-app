import { z } from 'zod';

const Env = z.object({
  /** Railway Postgres. Bo'lmasa lokal PGlite (`.data/pg`). */
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  /** Serverning tashqi manzili (https://…up.railway.app). Bot webhook'i va panel havolalari uchun. */
  PUBLIC_URL: z
    .string()
    .url()
    .optional()
    .transform((s) => s?.replace(/\/$/, '')),
  BOT_TOKEN: z.string().optional(),
  /** Telegram'dan keladigan webhook so'rovini tekshirish uchun maxfiy so'z. */
  TG_WEBHOOK_SECRET: z.string().optional(),
  /** Admin panelga kirish kodi yuboriladigan Telegram ID'lar, vergul bilan. */
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isSafeInteger(n) && n > 0),
    ),
  /** Admin panel statik fayllari (vite build natijasi). */
  ADMIN_DIST: z.string().default('dist/admin'),
});

export type Env = z.infer<typeof Env>;

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => Env.parse(source);
