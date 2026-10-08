// Ikkinchi qurilma (sinov uchun): Telegram orqali kiradi, serverdagi ma'lumotni o'qiydi, stol qo'shadi.
//   node scripts/fake-device.ts login [--adb]        kirish havolasi (--adb: telefonda ochiladi), token .data/fake-device.json ga
//   node scripts/fake-device.ts pull                 serverdagi qatorlar (jadval bo'yicha) va stollar
//   node scripts/fake-device.ts add-table "VIP 1" 40000
//   node scripts/fake-device.ts logout
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AuthPollResponse, AuthStartResponse, MeResponse, PullResponse } from '../src/contract.ts';

const BASE = (process.env.API_URL ?? 'https://server-production-9388.up.railway.app').replace(/\/$/, '');
const FILE = '.data/fake-device.json';
const [cmd, ...args] = process.argv.slice(2);

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const saved = (): { token: string; epoch: number } => JSON.parse(readFileSync(FILE, 'utf8'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summary(me: MeResponse) {
  const s = me.subscription;
  console.log(`biliardxona: ${me.hall.name} (epoch ${me.hall.epoch}), siz: ${me.user.name} / ${me.user.role}`);
  console.log(`obuna: ${s.state}, ${s.endsAt ? new Date(s.endsAt).toISOString().slice(0, 10) : '—'} (${s.daysLeft} kun), narx ${s.price}`);
  console.log(`qurilmalar ${me.devices.length}/${me.hall.deviceLimit}: ${me.devices.map((d) => `${d.model} (${d.userName})`).join(', ')}`);
}

if (cmd === 'login') {
  const start = await call<AuthStartResponse>('/api/auth/start', { body: { installId: `fake-${randomUUID()}`, model: 'Sinov qurilmasi' } });
  console.log(start.url);
  if (args.includes('--adb')) {
    execFileSync('adb', ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', start.url], { stdio: 'ignore' });
  }
  for (;;) {
    await sleep(2000);
    const res = await call<AuthPollResponse>(`/api/auth/poll?token=${start.token}`);
    if (res.status === 'expired') throw new Error('havola eskirdi');
    if (res.status === 'ok') {
      mkdirSync('.data', { recursive: true });
      writeFileSync(FILE, JSON.stringify({ token: res.deviceToken, epoch: res.me.hall.epoch }));
      summary(res.me);
      break;
    }
  }
} else if (cmd === 'pull') {
  const { token } = saved();
  summary(await call<MeResponse>('/api/me', { token }));
  const rows: PullResponse['rows'] = [];
  let since = 0;
  for (;;) {
    const page = await call<PullResponse>(`/api/sync/pull?since=${since}&limit=1000`, { token });
    rows.push(...page.rows);
    since = page.nextRev;
    if (!page.more) break;
  }
  const byTable: Record<string, number> = {};
  for (const r of rows) if (!r.deleted) byTable[r.tbl] = (byTable[r.tbl] ?? 0) + 1;
  console.log('qatorlar:', byTable);
  const tables = rows.filter((r) => r.tbl === 'tables' && !r.deleted);
  console.log('stollar:', tables.map((r) => `${r.data.name} ${r.data.hourly_rate}`).join(', '));
} else if (cmd === 'add-table') {
  const { token } = saved();
  const me = await call<MeResponse>('/api/me', { token });
  const [name = 'VIP 1', rate = '40000'] = args;
  const res = await call('/api/sync/push', {
    token,
    body: {
      epoch: me.hall.epoch,
      changes: [
        {
          tbl: 'tables',
          uid: randomBytes(16).toString('hex'),
          updatedAt: Date.now(),
          deleted: false,
          data: { name, hourly_rate: Number(rate), is_active: 1, sort_order: 99 },
        },
      ],
    },
  });
  console.log(res);
} else if (cmd === 'logout') {
  console.log(await call('/api/auth/logout', { token: saved().token, body: {} }));
} else {
  console.log('buyruqlar: login [--adb] | pull | add-table NOM NARX | logout');
}
