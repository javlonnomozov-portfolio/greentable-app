/** Foydalanuvchi va adminlarga Telegram xabarlari. Testlarda xotiradagi nusxasi ishlatiladi. */
export interface Notifier {
  /** Bot username (havolalar uchun). Bot sozlanmagan bo'lsa bo'sh. */
  botUsername: string;
  toUser(telegramId: number, html: string, buttons?: { text: string; url: string }[]): Promise<void>;
  toAdmins(html: string, opts?: { photo?: string; document?: string; button?: { text: string; url: string } }): Promise<void>;
  /** Telegram'dagi faylni (chek rasmi) yuklab beradi. */
  fetchFile(fileId: string): Promise<Response>;
}

export interface SentMessage {
  to: number | 'admins';
  html: string;
}

export function memoryNotifier(botUsername = 'TestBot'): Notifier & { sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  return {
    botUsername,
    sent,
    async toUser(to, html) {
      sent.push({ to, html });
    },
    async toAdmins(html) {
      sent.push({ to: 'admins', html });
    },
    async fetchFile() {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
    },
  };
}
