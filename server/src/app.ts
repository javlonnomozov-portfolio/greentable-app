import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { webhookCallback, type Bot } from 'grammy';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import type { Env } from './env.ts';
import type { Notifier } from './notifier.ts';
import { adminRoutes } from './routes/admin.ts';
import { apiRoutes } from './routes/api.ts';

export interface AppDeps {
  db: Db;
  env: Env;
  now: () => Date;
  notifier: Notifier;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot?: Bot<any>;
}

const landing = (bot: string) => `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GreenTable</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121417;color:#f4f6f8;font-family:system-ui,sans-serif;text-align:center;padding:16px}
h1{color:#00c853;letter-spacing:2px;margin:0 0 8px}a{color:#00e676}</style></head>
<body><main><h1>GREENTABLE</h1><p>Biliardxona boshqaruv tizimi</p>${bot ? `<p><a href="https://t.me/${bot}">@${bot}</a></p>` : ''}</main></body></html>`;

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.onError((err, c) => {
    console.error(err);
    return c.json({ code: 'bad_request', message: 'Serverda xatolik' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true, time: deps.now().getTime() }));
  app.get('/', (c) => c.html(landing(deps.notifier.botUsername)));

  app.route('/api', apiRoutes(deps));
  app.route('/admin/api', adminRoutes(deps));

  if (deps.bot) {
    app.post('/tg', webhookCallback(deps.bot, 'hono', { secretToken: deps.env.TG_WEBHOOK_SECRET }));
  }

  // Admin panel (Vite build). Marshrutlash hash orqali, shuning uchun faqat index.html va assets kerak.
  const dist = deps.env.ADMIN_DIST;
  app.use('/admin/assets/*', serveStatic({ root: dist, rewriteRequestPath: (p) => p.replace(/^\/admin/, '') }));
  app.get('/admin', (c) => c.redirect('/admin/'));
  app.get('/admin/', async (c) => {
    try {
      return c.html(await readFile(join(dist, 'index.html'), 'utf8'));
    } catch {
      return c.text('Admin panel yig‘ilmagan: npm run build', 503);
    }
  });

  return app;
}
