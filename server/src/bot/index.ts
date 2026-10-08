import { Api, Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { Db } from '../db/client.ts';
import type { BotIntent } from '../db/schema.ts';
import type { Env } from '../env.ts';
import type { Notifier } from '../notifier.ts';
import { confirmLogin, pendingLogin } from '../services/auth.ts';
import { createReceipt, hallBilling } from '../services/billing.ts';
import { discountLabel, redeemPromo } from '../services/discounts.ts';
import {
  acceptInvite,
  activeDevices,
  createHall,
  createInvite,
  deviceLimit,
  getHall,
  hasDeviceSlot,
  memberRole,
  memberships,
  openInvite,
  revokeDevice,
  type Hall,
} from '../services/halls.ts';
import { getPricing } from '../services/pricing.ts';
import { displayName, getUser, setActiveHall, setBotState, setPhone, upsertTelegramUser, type User } from '../services/users.ts';
import { escapeHtml, formatDate } from '../services/util.ts';
import { STATE_LABEL, priceLine, statusLines } from '../texts.ts';

type Ctx = Context & { user: User };

export interface BotDeps {
  db: Db;
  env: Env;
  now: () => Date;
  /** Ilovani yuklab olish havolasi. */
  appUrl: string;
}

const BTN = {
  pay: "💳 To'lov",
  status: '📊 Obuna holati',
  promo: '🎟 Promo kod',
  invite: "👥 Sherik qo'shish",
  help: 'ℹ️ Yordam',
};

const menuKeyboard = () =>
  new Keyboard().text(BTN.pay).text(BTN.status).row().text(BTN.promo).text(BTN.invite).row().text(BTN.help).resized();

const html = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export function createBot(token: string, deps: BotDeps): Bot<Ctx> {
  const { db, now } = deps;
  const bot = new Bot<Ctx>(token);

  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    if (ctx.chat && ctx.chat.type !== 'private') return;
    ctx.user = await upsertTelegramUser(db, ctx.from);
    if (ctx.user.blocked) return;
    await next();
  });

  const refresh = async (ctx: Ctx) => (ctx.user = (await getUser(db, ctx.user.id))!);

  /** Bot menyusi ishlaydigan biliardxona: tanlangani, bo'lmasa birinchisi. */
  async function activeHall(ctx: Ctx): Promise<{ hall: Hall; role: 'owner' | 'admin' } | null> {
    const list = await memberships(db, ctx.user.id);
    return list.find((m) => m.hall.id === ctx.user.activeHallId) ?? list[0] ?? null;
  }

  async function noHall(ctx: Ctx) {
    await ctx.reply(
      `Siz hali biliardxona ochmagansiz.\n\n1. GreenTable ilovasini o'rnating: ${deps.appUrl}\n2. Ilovada <b>«Telegram orqali kirish»</b> ni bosing — ro'yxatdan o'tish shu yerda davom etadi.`,
      html,
    );
  }

  async function showMenu(ctx: Ctx, text = 'Menyudan tanlang:') {
    await ctx.reply(text, { reply_markup: menuKeyboard() });
  }

  async function askPhone(ctx: Ctx, then: BotIntent) {
    await setBotState(db, ctx.user.id, { step: 'contact', then });
    await ctx.reply('Davom etish uchun telefon raqamingizni yuboring 👇', {
      reply_markup: new Keyboard().requestContact('📞 Raqamni yuborish').resized().oneTime(),
    });
  }

  const expiredLogin = (ctx: Ctx) =>
    ctx.reply("Kirish havolasi eskirgan. Ilovada qaytadan «Telegram orqali kirish» ni bosing.", { reply_markup: menuKeyboard() });

  async function continueIntent(ctx: Ctx, intent: BotIntent) {
    await setBotState(db, ctx.user.id, null);
    if (intent.kind === 'menu') return showMenu(ctx);
    if (!ctx.user.phone) return askPhone(ctx, intent);

    if (intent.kind === 'join') {
      const res = await acceptInvite(db, intent.code, ctx.user, now());
      if (!res.ok) {
        const why = { invalid: "noto'g'ri", expired: 'muddati tugagan', used: 'allaqachon ishlatilgan' }[res.reason];
        return ctx.reply(`Taklif havolasi ${why}. Biliardxona egasidan yangisini so'rang.`, { reply_markup: menuKeyboard() });
      }
      return ctx.reply(
        `✅ Siz <b>${escapeHtml(res.hall.name)}</b> biliardxonasiga qo'shildingiz.\n\nEndi telefoningizda GreenTable ilovasini oching va <b>«Telegram orqali kirish»</b> ni bosing.\nIlova: ${deps.appUrl}`,
        { ...html, reply_markup: menuKeyboard() },
      );
    }

    if (!(await pendingLogin(db, intent.token, now()))) return expiredLogin(ctx);
    const list = await memberships(db, ctx.user.id);
    if (!list.length) {
      await setBotState(db, ctx.user.id, { step: 'hall_name', then: intent });
      return ctx.reply('Biliardxonangiz nomini yozing (masalan: Grand Biliard):', { reply_markup: { remove_keyboard: true } });
    }
    if (list.length === 1) return finishLogin(ctx, intent.token, list[0].hall.id);
    await setBotState(db, ctx.user.id, { step: 'pending_login', token: intent.token });
    const kb = new InlineKeyboard();
    for (const m of list) kb.text(m.hall.name, `hall:${m.hall.id}`).row();
    return ctx.reply('Qaysi biliardxonaga kirasiz?', { reply_markup: kb });
  }

  async function finishLogin(ctx: Ctx, token: string, hallId: string) {
    const req = await pendingLogin(db, token, now());
    if (!req) return expiredLogin(ctx);
    const hall = await getHall(db, hallId);
    const role = hall ? await memberRole(db, hall.id, ctx.user.id) : null;
    if (!hall || !role) return ctx.reply('Bu biliardxonaga kirish huquqingiz yo‘q.');
    if (hall.blocked) return ctx.reply("Biliardxona bloklangan. «ℹ️ Yordam» orqali administratorga murojaat qiling.");

    if (!(await hasDeviceSlot(db, hall, req.installId))) {
      const pricing = await getPricing(db);
      const limit = deviceLimit(hall, pricing);
      if (role !== 'owner') {
        return ctx.reply(`Qurilmalar limiti (${limit} ta) to'lgan. Biliardxona egasi eski qurilmani o'chirishi kerak.`);
      }
      await setBotState(db, ctx.user.id, { step: 'pending_login', token });
      const kb = new InlineKeyboard();
      for (const d of await activeDevices(db, hall.id)) {
        kb.text(`🗑 ${d.model ?? 'Telefon'} — ${d.userName}`, `rv:${d.id}`).row();
      }
      return ctx.reply(`Qurilmalar limiti: ${limit} ta. Yangi telefon uchun eskisini o'chiring:`, { reply_markup: kb });
    }

    if (!(await confirmLogin(db, token, ctx.user.id, hall.id, now()))) return expiredLogin(ctx);
    await setActiveHall(db, ctx.user.id, hall.id);
    await setBotState(db, ctx.user.id, null);
    await ctx.reply(`✅ <b>${escapeHtml(hall.name)}</b> — kirish tasdiqlandi.\nIlovaga qayting, u o'zi ochiladi.`, {
      ...html,
      reply_markup: menuKeyboard(),
    });
  }

  bot.command('start', async (ctx) => {
    const payload = String(ctx.match ?? '').trim();
    if (payload.startsWith('login_')) return continueIntent(ctx, { kind: 'login', token: payload.slice(6) });
    if (payload.startsWith('join_')) return continueIntent(ctx, { kind: 'join', code: payload.slice(5) });
    if (payload === 'pay') return showPayment(ctx);
    await setBotState(db, ctx.user.id, null);
    if (await activeHall(ctx)) return showMenu(ctx, `Assalomu alaykum, ${escapeHtml(ctx.user.firstName ?? '')}! Menyudan tanlang:`);
    await ctx.reply('<b>GreenTable</b> — biliardxona boshqaruvi va kassa nazorati.', html);
    return noHall(ctx);
  });

  bot.command('id', (ctx) => ctx.reply(`Telegram ID: <code>${ctx.from!.id}</code>`, html));
  bot.command('menu', (ctx) => showMenu(ctx));

  bot.on('message:contact', async (ctx) => {
    const c = ctx.message.contact;
    if (c.user_id !== ctx.from.id) return ctx.reply("Iltimos, o'zingizning raqamingizni tugma orqali yuboring.");
    await setPhone(db, ctx.user.id, c.phone_number);
    const state = ctx.user.botState;
    await refresh(ctx);
    await ctx.reply('Rahmat, raqam saqlandi.', { reply_markup: { remove_keyboard: true } });
    return continueIntent(ctx, state?.step === 'contact' ? state.then : { kind: 'menu' });
  });

  async function showPayment(ctx: Ctx) {
    const m = await activeHall(ctx);
    if (!m) return noHall(ctx);
    const b = await hallBilling(db, m.hall, now());
    const payText = b.pricing.paymentText.trim();
    await setBotState(db, ctx.user.id, { step: 'receipt' });
    await ctx.reply(
      [
        `💳 <b>To'lov</b> — ${escapeHtml(m.hall.name)}`,
        '',
        statusLines(b),
        '',
        payText ? escapeHtml(payText) : "To'lov rekvizitlari uchun «ℹ️ Yordam» ni bosing.",
        '',
        "To'lov qilgach, <b>chek rasmini</b> (skrinshot yoki PDF) shu chatga yuboring.",
      ].join('\n'),
      { ...html, reply_markup: menuKeyboard() },
    );
  }

  async function showStatus(ctx: Ctx) {
    const list = await memberships(db, ctx.user.id);
    const m = list.find((x) => x.hall.id === ctx.user.activeHallId) ?? list[0];
    if (!m) return noHall(ctx);
    const b = await hallBilling(db, m.hall, now());
    const devices = await activeDevices(db, m.hall.id);
    const text = [
      `📊 <b>${escapeHtml(m.hall.name)}</b>`,
      statusLines(b),
      `Qurilmalar: ${devices.length} / ${deviceLimit(m.hall, b.pricing)}`,
    ].join('\n');
    const kb = new InlineKeyboard();
    for (const other of list) if (other.hall.id !== m.hall.id) kb.text(`↔ ${other.hall.name}`, `active:${other.hall.id}`).row();
    await ctx.reply(text, { ...html, reply_markup: list.length > 1 ? kb : menuKeyboard() });
  }

  async function showInvite(ctx: Ctx) {
    const m = await activeHall(ctx);
    if (!m) return noHall(ctx);
    if (m.role !== 'owner') return ctx.reply("Sherikni faqat biliardxona egasi qo'sha oladi.");
    const inv = (await openInvite(db, m.hall.id, now())) ?? (await createInvite(db, m.hall.id, ctx.user.id, now()));
    const link = `https://t.me/${ctx.me.username}?start=join_${inv.code}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
      `GreenTable: ${m.hall.name} biliardxonasiga qo'shiling`,
    )}`;
    await ctx.reply(
      `👥 Sherigingizga shu havolani yuboring (bir marta ishlaydi, ${formatDate(inv.expiresAt)} gacha):\n${link}\n\nU havolani ochib, telefon raqamini yuboradi va biliardxonangizga admin bo'lib qo'shiladi.`,
      { ...html, reply_markup: new InlineKeyboard().url('📤 Ulashish', share) },
    );
  }

  async function showHelp(ctx: Ctx) {
    const pricing = await getPricing(db);
    await ctx.reply(pricing.supportText.trim() || "Savollar bo'yicha administratorga yozing.", { reply_markup: menuKeyboard() });
  }

  bot.hears(BTN.pay, async (ctx) => showPayment(ctx));
  bot.hears(BTN.status, async (ctx) => {
    await setBotState(db, ctx.user.id, null);
    return showStatus(ctx);
  });
  bot.hears(BTN.promo, async (ctx) => {
    if (!(await activeHall(ctx))) return noHall(ctx);
    await setBotState(db, ctx.user.id, { step: 'promo' });
    return ctx.reply('Promo kodni yozing:');
  });
  bot.hears(BTN.invite, async (ctx) => {
    await setBotState(db, ctx.user.id, null);
    return showInvite(ctx);
  });
  bot.hears(BTN.help, async (ctx) => {
    await setBotState(db, ctx.user.id, null);
    return showHelp(ctx);
  });

  bot.on(['message:photo', 'message:document'], async (ctx) => {
    const m = await activeHall(ctx);
    if (!m) return noHall(ctx);
    const photo = ctx.message.photo?.at(-1);
    const doc = ctx.message.document;
    const fileId = photo?.file_id ?? doc?.file_id;
    if (!fileId) return;
    const receipt = await createReceipt(
      db,
      {
        hallId: m.hall.id,
        userId: ctx.user.id,
        fileId,
        fileKind: photo ? 'photo' : 'document',
        mimeType: doc?.mime_type ?? null,
        caption: ctx.message.caption?.slice(0, 500) ?? null,
      },
      now(),
    );
    await setBotState(db, ctx.user.id, null);
    await ctx.reply(`📨 Chek qabul qilindi (№${receipt.id}). Tekshirib, tez orada javob beramiz.`, { reply_markup: menuKeyboard() });
    const b = await hallBilling(db, m.hall, now());
    const u = ctx.user;
    await sendToAdmins(ctx.api, deps.env,
      [
        `🧾 <b>Yangi chek №${receipt.id}</b>`,
        `🏢 ${escapeHtml(m.hall.name)}`,
        `👤 ${escapeHtml(displayName(u))}${u.username ? ` @${escapeHtml(u.username)}` : ''}${u.phone ? ` ${u.phone}` : ''}`,
        `💰 Oylik narx: ${priceLine(b)}`,
        `📅 ${STATE_LABEL[b.status.state]}${b.status.endsAt ? `, ${formatDate(b.status.endsAt)}` : ''}`,
        receipt.caption ? `💬 ${escapeHtml(receipt.caption)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      {
        photo: photo?.file_id,
        document: photo ? undefined : fileId,
        button: deps.env.PUBLIC_URL ? { text: 'Panelda ochish', url: `${deps.env.PUBLIC_URL}/admin/#/receipts` } : undefined,
      },
    );
  });

  bot.on('message:text', async (ctx) => {
    const state = ctx.user.botState;
    const text = ctx.message.text.trim();
    if (state?.step === 'hall_name') {
      if (text.length < 2 || text.startsWith('/')) return ctx.reply('Biliardxona nomini yozing (kamida 2 harf):');
      await refresh(ctx);
      const hall = await createHall(db, ctx.user, text, now());
      await setBotState(db, ctx.user.id, null);
      const b = await hallBilling(db, hall, now());
      const gift = hall.trialEndsAt ? `\n🎁 Sinov muddati: ${formatDate(hall.trialEndsAt)} gacha bepul.` : '';
      const disc = b.discount ? `\n🏷 Sizga chegirma: ${escapeHtml(discountLabel(b.discount))}.` : '';
      await ctx.reply(`🏢 <b>${escapeHtml(hall.name)}</b> ochildi.${gift}${disc}`, html);
      if (state.then.kind === 'login') return finishLogin(ctx, state.then.token, hall.id);
      return showMenu(ctx);
    }
    if (state?.step === 'promo') {
      const m = await activeHall(ctx);
      if (!m) return noHall(ctx);
      const res = await redeemPromo(db, m.hall.id, text, now());
      await setBotState(db, ctx.user.id, null);
      if (!res.ok) {
        const why = {
          not_found: 'Bunday promo kod topilmadi.',
          closed: 'Promo kod muddati tugagan yoki limiti tugagan.',
          already: 'Bu promo kod allaqachon qo‘llangan.',
          not_new: 'Bu promo kod faqat yangi mijozlar uchun.',
        }[res.reason];
        return ctx.reply(why, { reply_markup: menuKeyboard() });
      }
      const b = await hallBilling(db, m.hall, now());
      return ctx.reply(`✅ Promo kod qo'llandi: ${escapeHtml(discountLabel(res.discount))}\nOylik narx: ${priceLine(b)}`, {
        ...html,
        reply_markup: menuKeyboard(),
      });
    }
    return showMenu(ctx);
  });

  bot.callbackQuery(/^hall:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = ctx.user.botState;
    if (state?.step !== 'pending_login') return expiredLogin(ctx);
    return finishLogin(ctx, state.token, ctx.match[1]);
  });

  bot.callbackQuery(/^rv:(.+)$/, async (ctx) => {
    const state = ctx.user.botState;
    if (state?.step !== 'pending_login') {
      await ctx.answerCallbackQuery();
      return expiredLogin(ctx);
    }
    const req = await pendingLogin(db, state.token, now());
    const devices = req ? await memberships(db, ctx.user.id) : [];
    for (const m of devices) {
      if (m.role === 'owner' && (await revokeDevice(db, m.hall.id, ctx.match[1], now()))) {
        await ctx.answerCallbackQuery({ text: "Qurilma o'chirildi" });
        await ctx.editMessageReplyMarkup().catch(() => {});
        return finishLogin(ctx, state.token, m.hall.id);
      }
    }
    await ctx.answerCallbackQuery({ text: "Qurilma topilmadi" });
  });

  bot.callbackQuery(/^active:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (await memberRole(db, ctx.match[1], ctx.user.id)) {
      await setActiveHall(db, ctx.user.id, ctx.match[1]);
      await refresh(ctx);
    }
    return showStatus(ctx);
  });

  bot.catch((err) => console.error('bot error', err.error));
  return bot;
}

const urlKb = (buttons?: { text: string; url: string }[]) => {
  if (!buttons?.length) return undefined;
  const kb = new InlineKeyboard();
  for (const b of buttons) kb.url(b.text, b.url).row();
  return kb;
};

type AdminMessageOpts = Parameters<Notifier['toAdmins']>[1];

/** Barcha adminlarga xabar (chek bo'lsa rasm yoki fayl bilan). */
async function sendToAdmins(api: Api, env: Env, text: string, opts: AdminMessageOpts = {}) {
  const reply_markup = urlKb(opts.button ? [opts.button] : undefined);
  for (const id of env.ADMIN_TELEGRAM_IDS) {
    try {
      if (opts.photo) await api.sendPhoto(id, opts.photo, { caption: text, parse_mode: 'HTML', reply_markup });
      else if (opts.document) await api.sendDocument(id, opts.document, { caption: text, parse_mode: 'HTML', reply_markup });
      else await api.sendMessage(id, text, { ...html, reply_markup });
    } catch (e) {
      console.warn('telegram admin notify', id, (e as Error).message);
    }
  }
}

/** Bot orqali Telegram xabarlari. */
export function telegramNotifier(bot: Bot<Ctx>, env: Env): Notifier {
  return {
    botUsername: bot.botInfo.username,
    async toUser(telegramId, text, buttons) {
      try {
        await bot.api.sendMessage(telegramId, text, { ...html, reply_markup: urlKb(buttons) });
      } catch (e) {
        console.warn('telegram sendMessage', telegramId, (e as Error).message);
      }
    },
    toAdmins: (text, opts) => sendToAdmins(bot.api, env, text, opts),
    async fetchFile(fileId) {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) return new Response('not found', { status: 404 });
      return fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`);
    },
  };
}
