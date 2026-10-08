/**
 * Ilova ↔ server kontrakti. Ilova bu faylni faqat `import type` bilan oladi,
 * shuning uchun bu yerda faqat turlar bo'lishi kerak (runtime kod yo'q).
 * Barcha vaqtlar — Unix ms.
 */

export type SubState = 'trial' | 'active' | 'grace' | 'expired';

export interface SubscriptionInfo {
  state: SubState;
  /** Sinov yoki to'langan muddat tugaydigan vaqt. */
  endsAt: number | null;
  /** Imtiyoz kunlari tugaydigan vaqt — shundan keyin faqat ko'rish rejimi. */
  graceEndsAt: number | null;
  readOnly: boolean;
  /** endsAt gacha qolgan to'liq kunlar (o'tib ketgan bo'lsa manfiy). */
  daysLeft: number;
  /** Chegirmasiz 30 kunlik narx. */
  monthlyPrice: number;
  /** Shu biliardxona uchun amaldagi 30 kunlik narx (chegirma bilan). */
  price: number;
  /** Har kuni balansdan yechiladigan summa. */
  dailyPrice: number;
  /** Hisobdagi pul; minus — imtiyoz kunlaridagi qarz. */
  balance: number;
  discount: DiscountInfo | null;
}

export interface DiscountInfo {
  percent: number | null;
  amount: number | null;
  /** Chegirma shu vaqtgacha amal qiladi (null — cheksiz). */
  endsAt: number | null;
  label: string;
}

export type Role = 'owner' | 'admin';

export interface DeviceInfo {
  id: string;
  model: string | null;
  userName: string;
  lastSeenAt: number | null;
  current: boolean;
}

export interface MeResponse {
  serverTime: number;
  hall: { id: string; name: string; epoch: number; deviceLimit: number };
  user: { id: number; name: string; role: Role };
  deviceId: string;
  subscription: SubscriptionInfo;
  devices: DeviceInfo[];
  botUsername: string;
}

export interface AuthStartRequest {
  /** Ilova o'rnatilganda bir marta yaratiladigan tasodifiy id. */
  installId: string;
  model?: string;
}

export interface AuthStartResponse {
  token: string;
  /** Telegram'da ochiladigan havola: https://t.me/<bot>?start=login_<token> */
  url: string;
  expiresAt: number;
}

export type AuthPollResponse =
  | { status: 'pending' }
  | { status: 'expired' }
  /** Telegram'da «Bu men emas» bosildi. */
  | { status: 'rejected' }
  | { status: 'ok'; deviceToken: string; me: MeResponse };

export interface SyncChange {
  tbl: string;
  uid: string;
  updatedAt: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

export interface PushRequest {
  epoch: number;
  changes: SyncChange[];
}

export interface PushResponse {
  ok: true;
  accepted: number;
  serverTime: number;
}

export interface PullRow extends SyncChange {
  rev: number;
}

export interface PullResponse {
  epoch: number;
  rows: PullRow[];
  /** Keyingi so'rovdagi `since`. */
  nextRev: number;
  more: boolean;
  serverTime: number;
}

export interface InviteResponse {
  url: string;
  expiresAt: number;
}

export interface ResetRequest {
  /** O'chiriladigan ilova jadvallari. */
  tables: string[];
}

/**
 * Xato javobi. `code`:
 * - `unauthorized` — token yo'q yoki bekor qilingan (qayta kirish kerak);
 * - `epoch` — boshqa qurilmada tarix tozalangan: lokal bazani tozalab, to'liq pull qilish kerak;
 * - `blocked` — biliardxona bloklangan;
 * - `forbidden`, `bad_request`, `not_found`, `rate_limited`.
 */
export interface ApiError {
  code: 'unauthorized' | 'epoch' | 'blocked' | 'forbidden' | 'bad_request' | 'not_found' | 'rate_limited';
  message: string;
  epoch?: number;
}
