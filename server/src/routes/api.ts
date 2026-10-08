import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ApiError, AuthPollResponse, AuthStartResponse, InviteResponse, MeResponse, PushResponse } from '../contract.ts';
import type { AppDeps } from '../app.ts';
import { authenticate, pollLogin, startLogin, type DeviceAuth } from '../services/auth.ts';
import { hallBilling, toSubscriptionInfo } from '../services/billing.ts';
import { activeDevices, createInvite, deviceLimit, revokeDevice } from '../services/halls.ts';
import { EpochMismatch, MAX_PULL, MAX_PUSH, SYNC_TABLES, pullChanges, pushChanges, resetHallData } from '../services/sync.ts';
import { displayName } from '../services/users.ts';
import { rateLimiter } from '../services/util.ts';

type Env = { Variables: { auth: DeviceAuth } };

const AuthStart = z.object({ installId: z.string().min(8).max(100), model: z.string().max(80).optional() });
const Change = z.object({
  tbl: z.enum(SYNC_TABLES),
  uid: z.string().min(1).max(100),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.boolean(),
  data: z.record(z.string(), z.unknown()),
});
const Push = z.object({ epoch: z.number().int(), changes: z.array(Change).max(MAX_PUSH) });
const Reset = z.object({ tables: z.array(z.enum(SYNC_TABLES)).max(SYNC_TABLES.length) });

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, code: ApiError['code'], message: string, extra = {}) =>
  c.json<ApiError>({ code, message, ...extra }, status);

const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export async function buildMe(deps: AppDeps, auth: DeviceAuth): Promise<MeResponse> {
  const now = deps.now();
  const billing = await hallBilling(deps.db, auth.hall, now);
  const devices = await activeDevices(deps.db, auth.hall.id);
  return {
    serverTime: now.getTime(),
    hall: { id: auth.hall.id, name: auth.hall.name, epoch: auth.hall.dataEpoch, deviceLimit: deviceLimit(auth.hall, billing.pricing) },
    user: { id: auth.user.id, name: displayName(auth.user), role: auth.role },
    deviceId: auth.device.id,
    subscription: toSubscriptionInfo(billing),
    devices: devices.map((d) => ({
      id: d.id,
      model: d.model,
      userName: d.userName,
      lastSeenAt: d.lastSeenAt?.getTime() ?? null,
      current: d.id === auth.device.id,
    })),
    botUsername: deps.notifier.botUsername,
  };
}

export function apiRoutes(deps: AppDeps) {
  const app = new Hono<Env>();
  const { db, now } = deps;
  const authLimit = rateLimiter(30, 60_000);
  const deviceLimitRate = rateLimiter(240, 60_000);

  const requireDevice: MiddlewareHandler<Env> = async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const auth = await authenticate(db, token, now());
    if (!auth) return fail(c, 401, 'unauthorized', 'Qayta kirish kerak');
    if (!deviceLimitRate(auth.device.id)) return fail(c, 429, 'rate_limited', "Juda ko'p so'rov");
    c.set('auth', auth);
    await next();
  };
  const requireOwner: MiddlewareHandler<Env> = async (c, next) => {
    if (c.get('auth').role !== 'owner') return fail(c, 403, 'forbidden', 'Faqat biliardxona egasi uchun');
    await next();
  };
  const notBlocked: MiddlewareHandler<Env> = async (c, next) => {
    if (c.get('auth').hall.blocked) return fail(c, 403, 'blocked', 'Biliardxona bloklangan');
    await next();
  };

  app.post('/auth/start', async (c) => {
    if (!authLimit(clientIp(c))) return fail(c, 429, 'rate_limited', "Juda ko'p urinish, birozdan keyin qayta urining");
    if (!deps.notifier.botUsername) return fail(c, 503, 'bad_request', 'Telegram bot hali sozlanmagan');
    const body = await readJson(c, AuthStart);
    if (!body) return fail(c, 400, 'bad_request', "Noto'g'ri so'rov");
    const { token, expiresAt } = await startLogin(db, body, now());
    return c.json<AuthStartResponse>({
      token,
      url: `https://t.me/${deps.notifier.botUsername}?start=login_${token}`,
      expiresAt: expiresAt.getTime(),
    });
  });

  app.get('/auth/poll', async (c) => {
    const token = c.req.query('token') ?? '';
    if (!token) return fail(c, 400, 'bad_request', 'token kerak');
    const res = await pollLogin(db, token, now());
    if (res.status !== 'ok') return c.json<AuthPollResponse>(res);
    const auth = await authenticate(db, res.deviceToken, now());
    if (!auth) return c.json<AuthPollResponse>({ status: 'expired' });
    return c.json<AuthPollResponse>({ status: 'ok', deviceToken: res.deviceToken, me: await buildMe(deps, auth) });
  });

  app.post('/auth/logout', requireDevice, async (c) => {
    const { hall, device } = c.get('auth');
    await revokeDevice(db, hall.id, device.id, now());
    return c.json({ ok: true });
  });

  app.get('/me', requireDevice, async (c) => c.json<MeResponse>(await buildMe(deps, c.get('auth'))));

  app.post('/sync/push', bodyLimit({ maxSize: 4 * 1024 * 1024 }), requireDevice, notBlocked, async (c) => {
    const body = await readJson(c, Push);
    if (!body) return fail(c, 400, 'bad_request', "Noto'g'ri sinxron so'rovi");
    const { hall, device } = c.get('auth');
    try {
      const accepted = await pushChanges(db, { hallId: hall.id, deviceId: device.id }, body.epoch, body.changes);
      return c.json<PushResponse>({ ok: true, accepted, serverTime: now().getTime() });
    } catch (e) {
      if (e instanceof EpochMismatch) return fail(c, 409, 'epoch', 'Tarix boshqa qurilmada tozalangan', { epoch: e.epoch });
      throw e;
    }
  });

  app.get('/sync/pull', requireDevice, notBlocked, async (c) => {
    const since = Math.max(0, Number(c.req.query('since')) || 0);
    const limit = Math.min(MAX_PULL, Math.max(1, Number(c.req.query('limit')) || 500));
    return c.json(await pullChanges(db, c.get('auth').hall.id, since, limit, now()));
  });

  app.post('/hall/invite', requireDevice, requireOwner, async (c) => {
    const { hall, user } = c.get('auth');
    const { code, expiresAt } = await createInvite(db, hall.id, user.id, now());
    return c.json<InviteResponse>({ url: `https://t.me/${deps.notifier.botUsername}?start=join_${code}`, expiresAt: expiresAt.getTime() });
  });

  app.delete('/devices/:id', requireDevice, requireOwner, async (c) => {
    const ok = await revokeDevice(db, c.get('auth').hall.id, c.req.param('id'), now());
    return ok ? c.json({ ok: true }) : fail(c, 404, 'not_found', 'Qurilma topilmadi');
  });

  app.post('/hall/reset', requireDevice, requireOwner, notBlocked, async (c) => {
    const body = await readJson(c, Reset);
    if (!body) return fail(c, 400, 'bad_request', "Noto'g'ri so'rov");
    const epoch = await resetHallData(db, c.get('auth').hall.id, body.tables);
    return c.json({ ok: true, epoch });
  });

  return app;
}
