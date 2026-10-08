import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { AuthPollResponse, AuthStartResponse, MeResponse, PullResponse } from '../src/contract.ts';
import type { Database } from '../src/db/client.ts';
import { loadEnv } from '../src/env.ts';
import { runReminders } from '../src/jobs/reminders.ts';
import { memoryNotifier } from '../src/notifier.ts';
import { bindLogin, confirmLogin } from '../src/services/auth.ts';
import { createReceipt } from '../src/services/billing.ts';
import { acceptInvite, createHall, createInvite } from '../src/services/halls.ts';
import { updatePricing } from '../src/services/pricing.ts';
import { getUser } from '../src/services/users.ts';
import { at, makeUser, testDb, T0 } from './helpers.ts';

let database: Database;
let clock: Date;
let notifier: ReturnType<typeof memoryNotifier>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  database = await testDb();
  clock = T0;
  notifier = memoryNotifier('GreenTableTestBot');
  await updatePricing(database.db, { monthlyPrice: 90_000, trialDays: 7, graceDays: 2, defaultDeviceLimit: 3 });
  app = createApp({
    db: database.db,
    env: loadEnv({ ADMIN_TELEGRAM_IDS: '777', ADMIN_DIST: 'dist/admin' }),
    now: () => clock,
    notifier,
  });
});
afterEach(() => database.close());

const json = (method: string, body?: unknown, token?: string, cookie?: string) => ({
  method,
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(cookie ? { cookie } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Ilova kirishi: start → bot tasdiqlaydi → poll. */
async function login(installId: string) {
  const owner = await makeUser(database.db, { phone: '+998901234567' });
  const hall = await createHall(database.db, owner, 'Grand Biliard', clock);
  const start = (await (await app.request('/api/auth/start', json('POST', { installId, model: 'SM-S901N' }))).json()) as AuthStartResponse;
  expect(start.url).toBe(`https://t.me/GreenTableTestBot?start=login_${start.token}`);
  expect(((await (await app.request(`/api/auth/poll?token=${start.token}`)).json()) as AuthPollResponse).status).toBe('pending');
  await bindLogin(database.db, start.token, owner.id, hall.id, clock);
  await confirmLogin(database.db, start.token, owner.id, clock);
  const poll = (await (await app.request(`/api/auth/poll?token=${start.token}`)).json()) as AuthPollResponse;
  if (poll.status !== 'ok') throw new Error('login failed');
  return { owner, hall, token: poll.deviceToken, me: poll.me };
}

describe('ilova API', () => {
  it('kirish, /me, sinxron va chiqish', async () => {
    const { token, me, hall } = await login('install-abc-1');
    expect(me).toMatchObject({
      hall: { id: hall.id, name: 'Grand Biliard', epoch: 1, deviceLimit: 3 },
      user: { role: 'owner' },
      subscription: { state: 'trial', daysLeft: 7, price: 90_000, readOnly: false },
    });
    expect(me.devices).toHaveLength(1);

    expect((await app.request('/api/me')).status).toBe(401);
    const meAgain = (await (await app.request('/api/me', json('GET', undefined, token))).json()) as MeResponse;
    expect(meAgain.deviceId).toBe(me.deviceId);

    const push = await app.request(
      '/api/sync/push',
      json('POST', { epoch: 1, changes: [{ tbl: 'tables', uid: 't1', updatedAt: 5, deleted: false, data: { name: 'Stol 1' } }] }, token),
    );
    expect(await push.json()).toMatchObject({ ok: true, accepted: 1 });
    const bad = await app.request('/api/sync/push', json('POST', { epoch: 1, changes: [{ tbl: 'users', uid: 'x', updatedAt: 1, deleted: false, data: {} }] }, token));
    expect(bad.status).toBe(400);
    const pull = (await (await app.request('/api/sync/pull?since=0', json('GET', undefined, token))).json()) as PullResponse;
    expect(pull.rows.map((r) => r.data.name)).toEqual(['Stol 1']);

    const reset = await app.request('/api/hall/reset', json('POST', { tables: ['bills'] }, token));
    expect(await reset.json()).toMatchObject({ epoch: 2 });
    const stale = await app.request('/api/sync/push', json('POST', { epoch: 1, changes: [] }, token));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'epoch', epoch: 2 });

    const invite = await (await app.request('/api/hall/invite', json('POST', {}, token))).json();
    expect(invite.url).toMatch(/^https:\/\/t\.me\/GreenTableTestBot\?start=join_[A-Z0-9]{10}$/);

    expect((await app.request('/api/auth/logout', json('POST', {}, token))).status).toBe(200);
    expect((await app.request('/api/me', json('GET', undefined, token))).status).toBe(401);
  });

  it('sherik yangi qurilmadan kirsa egasiga «O‘chirish» tugmasi bilan xabar boradi', async () => {
    const { hall, owner } = await login('install-owner-1');
    const partner = await makeUser(database.db);
    const { code } = await createInvite(database.db, hall.id, owner.id, clock);
    await acceptInvite(database.db, code, partner, clock);
    const start = (await (await app.request('/api/auth/start', json('POST', { installId: 'install-partner-1', model: 'Galaxy A52' }))).json()) as AuthStartResponse;
    await bindLogin(database.db, start.token, partner.id, hall.id, clock);
    await confirmLogin(database.db, start.token, partner.id, clock);
    const poll = (await (await app.request(`/api/auth/poll?token=${start.token}`)).json()) as AuthPollResponse;
    if (poll.status !== 'ok') throw new Error();
    const msg = notifier.sent.find((m) => m.to === owner.telegramId);
    expect(msg?.html).toContain('Galaxy A52');
    expect(msg?.buttons).toEqual([{ text: "🗑 Qurilmani o'chirish", data: `dv:${poll.me.deviceId}` }]);
  });

  it('muddati tugagach faqat ko‘rish, bloklangan biliardxona sinxronlanmaydi', async () => {
    const { token } = await login('install-abc-2');
    clock = at(10);
    const me = (await (await app.request('/api/me', json('GET', undefined, token))).json()) as MeResponse;
    expect(me.subscription).toMatchObject({ state: 'expired', readOnly: true });
  });
});

describe('admin panel API', () => {
  async function adminCookie() {
    expect((await app.request('/admin/api/dashboard')).status).toBe(401);
    expect((await app.request('/admin/api/auth/request', json('POST', {}))).status).toBe(200);
    const msg = notifier.sent.find((m) => m.to === 777);
    const code = /<b>(\d{6})<\/b>/.exec(msg!.html)![1];
    expect((await app.request('/admin/api/auth/verify', json('POST', { code: '000000' === code ? '111111' : '000000' }))).status).toBe(401);
    const ok = await app.request('/admin/api/auth/verify', json('POST', { code }));
    expect(ok.status).toBe(200);
    return ok.headers.get('set-cookie')!.split(';')[0];
  }

  it('OTP kirish, chekni tasdiqlash va rad etish, narx va chegirma', async () => {
    const cookie = await adminCookie();
    const user = await makeUser(database.db);
    const hall = await createHall(database.db, user, 'Zal', clock);

    const disc = await app.request(
      '/admin/api/discounts',
      json(
        'POST',
        {
          kind: 'promo',
          code: 'yangi20',
          percent: 20,
          amount: null,
          validFrom: null,
          validTo: at(30).toISOString(),
          benefitMonths: 3,
          maxUses: 100,
          newOnly: false,
          active: true,
          note: null,
        },
        undefined,
        cookie,
      ),
    );
    const d = await disc.json();
    expect(d).toMatchObject({ code: 'YANGI20', percent: 20 });
    expect((await app.request(`/admin/api/halls/${hall.id}/discounts`, json('POST', { discountId: d.id }, undefined, cookie))).status).toBe(200);

    const r1 = await createReceipt(database.db, { hallId: hall.id, userId: user.id, fileId: 'F', fileKind: 'photo', mimeType: null, caption: null }, clock);
    const list = await (await app.request('/admin/api/receipts?status=pending', json('GET', undefined, undefined, cookie))).json();
    expect(list[0]).toMatchObject({ id: r1.id, hall: { name: 'Zal' }, subscription: { price: 72_000 } });
    expect((await app.request(`/admin/api/receipts/${r1.id}/file`, json('GET', undefined, undefined, cookie))).headers.get('content-type')).toBe('image/jpeg');

    const q = await (await app.request(`/admin/api/receipts/${r1.id}/quote`, json('POST', { amount: 144_000 }, undefined, cookie))).json();
    expect(q.days).toBe(60);
    const ap = await app.request(`/admin/api/receipts/${r1.id}/approve`, json('POST', { amount: 144_000, days: 60 }, undefined, cookie));
    expect(ap.status).toBe(200);
    expect(notifier.sent.at(-1)).toMatchObject({ to: user.telegramId });
    expect(notifier.sent.at(-1)!.html).toContain("To'lov tasdiqlandi");
    expect((await app.request(`/admin/api/receipts/${r1.id}/approve`, json('POST', { amount: 1, days: 1 }, undefined, cookie))).status).toBe(409);

    const r2 = await createReceipt(database.db, { hallId: hall.id, userId: user.id, fileId: 'G', fileKind: 'photo', mimeType: null, caption: null }, clock);
    await app.request(`/admin/api/receipts/${r2.id}/reject`, json('POST', { reason: 'Boshqa karta' }, undefined, cookie));
    expect(notifier.sent.at(-1)!.html).toContain('Sabab: Boshqa karta');

    const dash = await (await app.request('/admin/api/dashboard', json('GET', undefined, undefined, cookie))).json();
    expect(dash).toMatchObject({ total: 1, counts: { active: 1 }, pendingReceipts: 0, monthRevenue: 144_000 });

    const pricing = await app.request(
      '/admin/api/pricing',
      json('PUT', { monthlyPrice: 120_000, trialDays: 10, graceDays: 3, defaultDeviceLimit: 4, paymentText: 'Karta 8600…', supportText: '@admin' }, undefined, cookie),
    );
    expect(await pricing.json()).toMatchObject({ monthlyPrice: 120_000, defaultDeviceLimit: 4 });

    const detail = await (await app.request(`/admin/api/halls/${hall.id}`, json('GET', undefined, undefined, cookie))).json();
    expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['trial', 'discount', 'payment']));
  });
});

describe('admin: biliardxonani o‘chirish', () => {
  it('qurilma chiqib ketadi, cheklar va tarix o‘chadi, sinov huquqi qaytadi', async () => {
    expect((await app.request('/admin/api/auth/request', json('POST', {}))).status).toBe(200);
    const code = /<b>(\d{6})<\/b>/.exec(notifier.sent.find((m) => m.to === 777)!.html)![1];
    const cookie = (await app.request('/admin/api/auth/verify', json('POST', { code }))).headers.get('set-cookie')!.split(';')[0];

    const { token, hall, owner } = await login('install-del-1');
    const r = await createReceipt(database.db, { hallId: hall.id, userId: owner.id, fileId: 'F', fileKind: 'photo', mimeType: null, caption: null }, clock);
    await app.request(`/admin/api/receipts/${r.id}/approve`, json('POST', { amount: 90_000, days: 30 }, undefined, cookie));

    const del = await app.request(`/admin/api/halls/${hall.id}`, json('DELETE', { resetTrial: true }, undefined, cookie));
    expect(del.status).toBe(200);
    expect((await app.request('/api/me', json('GET', undefined, token))).status).toBe(401);
    expect((await app.request(`/admin/api/halls/${hall.id}`, json('GET', undefined, undefined, cookie))).status).toBe(404);

    const again = await createHall(database.db, (await getUser(database.db, owner.id))!, 'Haqiqiy nom', clock);
    expect(again.trialEndsAt).not.toBeNull();
  });
});

describe('eslatmalar', () => {
  it('3 kun, 1 kun, imtiyoz va faqat-ko‘rish — har biri bir marta', async () => {
    const user = await makeUser(database.db);
    await createHall(database.db, user, 'Zal', T0); // sinov 7 kun
    const db = database.db;
    expect(await runReminders(db, notifier, at(2))).toBe(0);
    expect(await runReminders(db, notifier, at(4.5))).toBe(1); // 3 kun qoldi
    expect(await runReminders(db, notifier, at(4.6))).toBe(0);
    expect(await runReminders(db, notifier, at(6.5))).toBe(1); // ertaga
    expect(await runReminders(db, notifier, at(7.5))).toBe(1); // imtiyoz
    expect(await runReminders(db, notifier, at(9.5))).toBe(1); // faqat ko'rish
    expect(await runReminders(db, notifier, at(9.6))).toBe(0);
    expect(notifier.sent.filter((m) => m.to === user.telegramId)).toHaveLength(4);
  });
});
