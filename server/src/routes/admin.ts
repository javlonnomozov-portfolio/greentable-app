import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import { devices, discounts, hallDiscounts, hallMembers, halls, receipts, users } from '../db/schema.ts';
import { AdminAuthError, SESSION_TTL_MS, endSession, requestOtp, validSession, verifyOtp } from '../services/admin-auth.ts';
import {
  ReviewError,
  adjustBalance,
  approveReceipt,
  extendHallTrial,
  hallBilling,
  hallEvents,
  quote,
  rejectReceipt,
  toSubscriptionInfo,
} from '../services/billing.ts';
import {
  attachDiscount,
  createDiscount,
  createPersonalDiscount,
  discountLabel,
  listDiscounts,
  stopHallDiscount,
  updateDiscount,
} from '../services/discounts.ts';
import { activeDevices, deleteHall, deviceLimit, getHall, revokeDevice } from '../services/halls.ts';
import { getPricing, updatePricing } from '../services/pricing.ts';
import { displayName } from '../services/users.ts';
import { escapeHtml, formatDate, formatSom, rateLimiter } from '../services/util.ts';

const COOKIE = 'gt_admin';

const nullableDate = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .transform((s) => (s ? new Date(s) : null));

const oneOfAmount = (d: { percent: number | null; amount: number | null }) => (d.percent == null) !== (d.amount == null);

const DiscountBody = z
  .object({
    kind: z.enum(['promo', 'campaign', 'global']),
    code: z.string().trim().max(40).nullable(),
    percent: z.number().int().min(1).max(100).nullable(),
    amount: z.number().int().min(1).nullable(),
    validFrom: nullableDate,
    validTo: nullableDate,
    benefitDays: z.number().int().min(1).max(3650).nullable(),
    audience: z.enum(['all', 'new', 'selected']),
    hallIds: z.array(z.string().uuid()).max(500).default([]),
    maxUses: z.number().int().min(1).nullable(),
    active: z.boolean(),
    note: z.string().max(500).nullable(),
  })
  .refine(oneOfAmount, { message: 'Foiz yoki summadan bittasini kiriting' })
  .refine((d) => d.kind !== 'promo' || !!d.code, { message: 'Promo kod kerak' })
  .refine((d) => d.audience !== 'selected' || d.hallIds.length > 0, { message: 'Kamida bitta biliardxona tanlang' });

const PersonalBody = z
  .object({
    percent: z.number().int().min(1).max(100).nullable(),
    amount: z.number().int().min(1).nullable(),
    days: z.number().int().min(1).max(3650).nullable(),
    note: z.string().max(500).nullable(),
  })
  .refine(oneOfAmount, { message: 'Foiz yoki summadan bittasini kiriting' });

const PricingBody = z.object({
  monthlyPrice: z.number().int().min(0),
  trialDays: z.number().int().min(0).max(365),
  graceDays: z.number().int().min(0).max(60),
  defaultDeviceLimit: z.number().int().min(1).max(50),
  paymentText: z.string().max(2000),
  supportText: z.string().max(2000),
});

const fail = (c: Context, status: 400 | 401 | 404 | 409 | 429 | 503, message: string) => c.json({ message }, status);

async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; message: string }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, message: parsed.error.issues[0]?.message ?? "Noto'g'ri ma'lumot" };
}

/** Toshkent vaqti bilan joriy oyning boshi. */
function monthStart(now: Date): Date {
  const t = new Date(now.getTime() + 5 * 3_600_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) - 5 * 3_600_000);
}

export function adminRoutes(deps: AppDeps) {
  const app = new Hono();
  const { db, now, notifier, env } = deps;
  const verifyLimit = rateLimiter(10, 60_000);

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    if (!(await validSession(db, getCookie(c, COOKIE), now()))) return fail(c, 401, 'Kirish kerak');
    await next();
  };

  app.post('/auth/request', async (c) => {
    if (!env.ADMIN_TELEGRAM_IDS.length || !notifier.botUsername) return fail(c, 503, 'ADMIN_TELEGRAM_IDS yoki bot sozlanmagan');
    try {
      const code = await requestOtp(db, now());
      for (const id of env.ADMIN_TELEGRAM_IDS) {
        await notifier.toUser(id, `🔐 GreenTable admin panel kodi: <b>${code}</b>\n5 daqiqa amal qiladi. Hech kimga bermang.`);
      }
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof AdminAuthError) return fail(c, 429, e.message);
      throw e;
    }
  });

  app.post('/auth/verify', async (c) => {
    if (!verifyLimit(c.req.header('x-forwarded-for') ?? 'local')) return fail(c, 429, "Juda ko'p urinish");
    const body = await readJson(c, z.object({ code: z.string().min(4).max(10) }));
    if (!body.ok) return fail(c, 400, body.message);
    try {
      const token = await verifyOtp(db, body.data.code, now());
      setCookie(c, COOKIE, token, {
        httpOnly: true,
        secure: env.PUBLIC_URL?.startsWith('https') ?? false,
        sameSite: 'Strict',
        path: '/admin',
        maxAge: SESSION_TTL_MS / 1000,
      });
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof AdminAuthError) return fail(c, 401, e.message);
      throw e;
    }
  });

  app.post('/auth/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await endSession(db, token);
    deleteCookie(c, COOKIE, { path: '/admin' });
    return c.json({ ok: true });
  });

  app.get('/auth/me', requireAdmin, (c) => c.json({ ok: true }));

  app.use('/*', requireAdmin);

  /** Barcha biliardxonalar: holat, balans, narx, qurilmalar. */
  async function hallRows() {
    const t = now();
    const rows = await db
      .select({ hall: halls, owner: users })
      .from(halls)
      .innerJoin(users, eq(users.id, halls.ownerUserId))
      .orderBy(desc(halls.createdAt));
    const devs = await db
      .select({ hallId: devices.hallId, n: sql<number>`count(*)::int`, seen: sql<Date | null>`max(${devices.lastSeenAt})` })
      .from(devices)
      .where(isNull(devices.revokedAt))
      .groupBy(devices.hallId);
    const devMap = new Map(devs.map((d) => [d.hallId, d]));
    const out = [];
    for (const { hall, owner } of rows) {
      const b = await hallBilling(db, hall, t);
      const dev = devMap.get(hall.id);
      out.push({
        id: hall.id,
        name: hall.name,
        blocked: hall.blocked,
        createdAt: hall.createdAt,
        state: b.status.state,
        endsAt: b.status.endsAt,
        daysLeft: b.status.daysLeft,
        balance: hall.balance,
        price: b.price,
        daily: b.daily,
        discount: b.discount ? discountLabel(b.discount) : null,
        devices: dev?.n ?? 0,
        deviceLimit: deviceLimit(hall, b.pricing),
        lastSeenAt: dev?.seen ? new Date(dev.seen) : null,
        owner: { id: owner.id, name: displayName(owner), username: owner.username, phone: owner.phone, telegramId: owner.telegramId },
      });
    }
    return out;
  }

  app.get('/dashboard', async (c) => {
    const list = await hallRows();
    const counts = { trial: 0, active: 0, grace: 0, expired: 0 } as Record<string, number>;
    for (const h of list) counts[h.state]++;
    const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(receipts).where(eq(receipts.status, 'pending'));
    const [month] = await db
      .select({ sum: sql<number>`coalesce(sum(${receipts.amount}), 0)::int`, n: sql<number>`count(*)::int` })
      .from(receipts)
      .where(and(eq(receipts.status, 'approved'), gte(receipts.reviewedAt, monthStart(now()))));
    const soon = list
      .filter((h) => (h.state === 'trial' || h.state === 'active') && h.endsAt && h.daysLeft <= 3)
      .concat(list.filter((h) => h.state === 'grace'))
      .slice(0, 20);
    return c.json({
      counts,
      total: list.length,
      pendingReceipts: pending.n,
      monthRevenue: month.sum,
      monthPayments: month.n,
      totalBalance: list.reduce((s, h) => s + Math.max(0, h.balance), 0),
      soon,
    });
  });

  app.get('/halls', async (c) => c.json(await hallRows()));

  app.get('/halls/:id', async (c) => {
    const hall = await getHall(db, c.req.param('id'));
    if (!hall) return fail(c, 404, 'Topilmadi');
    const billing = await hallBilling(db, hall, now());
    const members = await db
      .select({ role: hallMembers.role, user: users, joinedAt: hallMembers.createdAt })
      .from(hallMembers)
      .innerJoin(users, eq(users.id, hallMembers.userId))
      .where(eq(hallMembers.hallId, hall.id));
    const discs = await db
      .select({ hd: hallDiscounts, d: discounts })
      .from(hallDiscounts)
      .innerJoin(discounts, eq(discounts.id, hallDiscounts.discountId))
      .where(eq(hallDiscounts.hallId, hall.id));
    const recs = await db.select().from(receipts).where(eq(receipts.hallId, hall.id)).orderBy(desc(receipts.createdAt)).limit(50);
    return c.json({
      hall,
      subscription: toSubscriptionInfo(billing),
      deviceLimit: deviceLimit(hall, billing.pricing),
      members: members.map((m) => ({
        role: m.role,
        joinedAt: m.joinedAt,
        id: m.user.id,
        name: displayName(m.user),
        username: m.user.username,
        phone: m.user.phone,
        telegramId: m.user.telegramId,
      })),
      devices: await activeDevices(db, hall.id),
      discounts: discs.map(({ hd, d }) => ({ id: hd.id, label: discountLabel(d), kind: d.kind, note: d.note, startsAt: hd.startsAt, endsAt: hd.endsAt })),
      globalDiscount: billing.discount && billing.discount.hallDiscountId == null ? discountLabel(billing.discount) : null,
      receipts: recs,
      events: await hallEvents(db, hall.id),
    });
  });

  app.patch('/halls/:id', async (c) => {
    const body = await readJson(
      c,
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        deviceLimit: z.number().int().min(1).max(50).nullable().optional(),
        blocked: z.boolean().optional(),
      }),
    );
    if (!body.ok) return fail(c, 400, body.message);
    const [row] = await db.update(halls).set(body.data).where(eq(halls.id, c.req.param('id'))).returning();
    return row ? c.json(row) : fail(c, 404, 'Topilmadi');
  });

  app.delete('/halls/:id', async (c) => {
    const body = await readJson(c, z.object({ resetTrial: z.boolean() }));
    if (!body.ok) return fail(c, 400, body.message);
    const ok = await deleteHall(db, c.req.param('id'), body.data);
    return ok ? c.json({ ok: true }) : fail(c, 404, 'Topilmadi');
  });

  /** Balansni qo'lda o'zgartirish (naqd to'lov, tuzatish, bonus): +/− summa. */
  app.post('/halls/:id/balance', async (c) => {
    const body = await readJson(c, z.object({ amount: z.number().int().min(-100_000_000).max(100_000_000), note: z.string().max(500).optional() }));
    if (!body.ok) return fail(c, 400, body.message);
    if (body.data.amount === 0) return fail(c, 400, 'Summa 0 bo‘lmasin');
    try {
      return c.json(await adjustBalance(db, c.req.param('id'), body.data.amount, body.data.note, now()));
    } catch (e) {
      if (e instanceof ReviewError) return fail(c, 404, e.message);
      throw e;
    }
  });

  app.post('/halls/:id/trial', async (c) => {
    const body = await readJson(c, z.object({ days: z.number().int().min(1).max(365), note: z.string().max(500).optional() }));
    if (!body.ok) return fail(c, 400, body.message);
    try {
      return c.json(await extendHallTrial(db, c.req.param('id'), body.data.days, body.data.note, now()));
    } catch (e) {
      if (e instanceof ReviewError) return fail(c, 404, e.message);
      throw e;
    }
  });

  app.post('/halls/:id/personal-discount', async (c) => {
    const body = await readJson(c, PersonalBody);
    if (!body.ok) return fail(c, 400, body.message);
    if (!(await getHall(db, c.req.param('id')))) return fail(c, 404, 'Topilmadi');
    await createPersonalDiscount(db, c.req.param('id'), body.data, now());
    return c.json({ ok: true });
  });

  app.post('/halls/:id/discounts', async (c) => {
    const body = await readJson(c, z.object({ discountId: z.number().int() }));
    if (!body.ok) return fail(c, 400, body.message);
    const [d] = await db.select().from(discounts).where(eq(discounts.id, body.data.discountId));
    if (!d) return fail(c, 404, 'Chegirma topilmadi');
    const ok = await attachDiscount(db, c.req.param('id'), d, now(), `Admin biriktirdi: ${discountLabel(d)}`);
    return ok ? c.json({ ok: true }) : fail(c, 409, 'Bu chegirma allaqachon biriktirilgan');
  });

  app.delete('/hall-discounts/:id', async (c) => {
    await stopHallDiscount(db, Number(c.req.param('id')), now());
    return c.json({ ok: true });
  });

  app.delete('/halls/:hallId/devices/:id', async (c) => {
    const ok = await revokeDevice(db, c.req.param('hallId'), c.req.param('id'), now());
    return ok ? c.json({ ok: true }) : fail(c, 404, 'Qurilma topilmadi');
  });

  app.get('/receipts', async (c) => {
    const status = z.enum(['pending', 'approved', 'rejected']).catch('pending').parse(c.req.query('status'));
    const rows = await db
      .select({ r: receipts, hall: halls, user: users })
      .from(receipts)
      .innerJoin(halls, eq(halls.id, receipts.hallId))
      .innerJoin(users, eq(users.id, receipts.userId))
      .where(eq(receipts.status, status))
      .orderBy(status === 'pending' ? receipts.createdAt : desc(receipts.reviewedAt))
      .limit(200);
    const out = [];
    for (const { r, hall, user } of rows) {
      const b = status === 'pending' ? await hallBilling(db, hall, now()) : null;
      out.push({
        ...r,
        hall: { id: hall.id, name: hall.name },
        user: { name: displayName(user), username: user.username, phone: user.phone, telegramId: user.telegramId },
        subscription: b ? toSubscriptionInfo(b) : null,
      });
    }
    return c.json(out);
  });

  app.get('/receipts/:id/file', async (c) => {
    const [r] = await db.select().from(receipts).where(eq(receipts.id, Number(c.req.param('id'))));
    if (!r) return fail(c, 404, 'Topilmadi');
    const res = await notifier.fetchFile(r.fileId);
    if (!res.ok || !res.body) return fail(c, 404, 'Fayl topilmadi');
    const type = r.mimeType ?? res.headers.get('content-type') ?? 'image/jpeg';
    return new Response(res.body, { headers: { 'content-type': type, 'cache-control': 'private, max-age=86400' } });
  });

  app.post('/receipts/:id/quote', async (c) => {
    const body = await readJson(c, z.object({ amount: z.number().int().min(0) }));
    if (!body.ok) return fail(c, 400, body.message);
    const [r] = await db.select().from(receipts).where(eq(receipts.id, Number(c.req.param('id'))));
    if (!r) return fail(c, 404, 'Topilmadi');
    return c.json(await quote(db, r.hallId, body.data.amount, now()));
  });

  app.post('/receipts/:id/approve', async (c) => {
    const body = await readJson(c, z.object({ amount: z.number().int().min(1).max(100_000_000) }));
    if (!body.ok) return fail(c, 400, body.message);
    try {
      const res = await approveReceipt(db, Number(c.req.param('id')), body.data, now());
      const until = res.status.endsAt ? `\nPul taxminan <b>${formatDate(res.status.endsAt)} gacha</b> yetadi.` : '';
      await notifier.toUser(
        res.telegramId,
        `✅ <b>To'lov qabul qilindi</b> (chek №${res.receipt.id})\nBiliardxona: ${escapeHtml(res.hall.name)}\nSumma: ${formatSom(body.data.amount)}\nBalans: <b>${formatSom(res.hall.balance)}</b>${until}\n\nRahmat!`,
      );
      return c.json({ ok: true, balance: res.hall.balance, endsAt: res.status.endsAt });
    } catch (e) {
      if (e instanceof ReviewError) return fail(c, 409, e.message);
      throw e;
    }
  });

  app.post('/receipts/:id/reject', async (c) => {
    const body = await readJson(c, z.object({ reason: z.string().max(500) }));
    if (!body.ok) return fail(c, 400, body.message);
    try {
      const res = await rejectReceipt(db, Number(c.req.param('id')), body.data.reason, now());
      const why = res.receipt.rejectReason ? `\nSabab: ${escapeHtml(res.receipt.rejectReason)}` : '';
      await notifier.toUser(
        res.telegramId,
        `❌ <b>Chek tasdiqlanmadi</b> (№${res.receipt.id})${why}\n\nSavollar bo'lsa «ℹ️ Yordam» ni bosing yoki to'g'ri chekni qayta yuboring.`,
      );
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof ReviewError) return fail(c, 409, e.message);
      throw e;
    }
  });

  app.get('/pricing', async (c) => c.json(await getPricing(db)));
  app.put('/pricing', async (c) => {
    const body = await readJson(c, PricingBody);
    if (!body.ok) return fail(c, 400, body.message);
    return c.json(await updatePricing(db, body.data));
  });

  app.get('/discounts', async (c) => c.json(await listDiscounts(db)));
  app.post('/discounts', async (c) => {
    const body = await readJson(c, DiscountBody);
    if (!body.ok) return fail(c, 400, body.message);
    try {
      return c.json(await createDiscount(db, body.data));
    } catch (e) {
      if (String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505') {
        return fail(c, 409, 'Bunday promo kod bor');
      }
      throw e;
    }
  });
  app.patch('/discounts/:id', async (c) => {
    const body = await readJson(c, DiscountBody);
    if (!body.ok) return fail(c, 400, body.message);
    const row = await updateDiscount(db, Number(c.req.param('id')), body.data);
    return row ? c.json(row) : fail(c, 404, 'Topilmadi');
  });

  return app;
}
