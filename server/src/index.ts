import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createBot, telegramNotifier } from './bot/index.ts';
import { openDatabase } from './db/client.ts';
import { loadEnv } from './env.ts';
import { startReminders } from './jobs/reminders.ts';
import { memoryNotifier, type Notifier } from './notifier.ts';
import { getPricing } from './services/pricing.ts';

const APP_URL = 'https://github.com/javlonnomozov-portfolio/greentable-app/releases/latest';

const env = loadEnv();
const now = () => new Date();
const { db, close } = await openDatabase(env.DATABASE_URL ? { url: env.DATABASE_URL } : { dataDir: '.data/pg' });
await getPricing(db);

let notifier: Notifier = memoryNotifier('');
const bot = env.BOT_TOKEN ? createBot(env.BOT_TOKEN, { db, env, now, appUrl: APP_URL }) : undefined;
if (bot) {
  await bot.init();
  notifier = telegramNotifier(bot, env);
  if (env.PUBLIC_URL) {
    await bot.api.setWebhook(`${env.PUBLIC_URL}/tg`, {
      secret_token: env.TG_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
    });
    console.log(`bot @${bot.botInfo.username}: webhook ${env.PUBLIC_URL}/tg`);
  } else {
    // Lokal ishlab chiqish: webhook o'rniga long polling.
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: ['message', 'callback_query'] });
    console.log(`bot @${bot.botInfo.username}: polling`);
  }
} else {
  console.warn('BOT_TOKEN yo‘q — bot o‘chirilgan');
}

const app = createApp({ db, env, now, notifier, bot: env.PUBLIC_URL ? bot : undefined });
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`http :${info.port}`));
const stopReminders = startReminders(db, notifier, now);

const shutdown = async () => {
  stopReminders();
  if (bot && !env.PUBLIC_URL) await bot.stop();
  server.close();
  await close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
