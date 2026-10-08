import type { SubState, SubscriptionInfo } from '../../src/contract.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 401 bo'lsa ilova kirish sahifasiga qaytadi. */
export let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, (data as { message?: string }).message ?? 'Xatolik');
  return data as T;
}

export interface Owner {
  id: number;
  name: string;
  username: string | null;
  phone: string | null;
  telegramId: number;
}

export interface HallRow {
  id: string;
  name: string;
  blocked: boolean;
  createdAt: string;
  state: SubState;
  endsAt: string | null;
  daysLeft: number;
  price: number;
  discount: string | null;
  devices: number;
  deviceLimit: number;
  lastSeenAt: string | null;
  owner: Owner;
}

export interface Dashboard {
  counts: Record<SubState, number>;
  total: number;
  pendingReceipts: number;
  monthRevenue: number;
  monthPayments: number;
  soon: HallRow[];
}

export type ReceiptStatus = 'pending' | 'approved' | 'rejected';

export interface Receipt {
  id: number;
  hallId: string;
  fileKind: 'photo' | 'document';
  mimeType: string | null;
  caption: string | null;
  status: ReceiptStatus;
  amount: number | null;
  daysAdded: number | null;
  priceAtReview: number | null;
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  hall: { id: string; name: string };
  user: { name: string; username: string | null; phone: string | null; telegramId: number };
  subscription: SubscriptionInfo | null;
}

export interface Quote {
  price: number;
  days: number;
  paidUntil: string;
}

export interface Device {
  id: string;
  model: string | null;
  userName: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface SubEvent {
  id: number;
  kind: 'trial' | 'payment' | 'extend' | 'set' | 'discount';
  days: number | null;
  amount: number | null;
  fromDate: string | null;
  toDate: string | null;
  note: string | null;
  createdAt: string;
}

export interface HallDetail {
  hall: { id: string; name: string; blocked: boolean; deviceLimit: number | null; trialEndsAt: string | null; paidUntil: string | null; createdAt: string; dataEpoch: number };
  subscription: SubscriptionInfo;
  deviceLimit: number;
  members: (Owner & { role: 'owner' | 'admin'; joinedAt: string })[];
  devices: Device[];
  discounts: { id: number; label: string; kind: string; startsAt: string; endsAt: string | null }[];
  receipts: Omit<Receipt, 'hall' | 'user' | 'subscription'>[];
  events: SubEvent[];
}

export interface Pricing {
  monthlyPrice: number;
  trialDays: number;
  graceDays: number;
  defaultDeviceLimit: number;
  paymentText: string;
  supportText: string;
}

export interface Discount {
  id: number;
  kind: 'promo' | 'campaign';
  code: string | null;
  percent: number | null;
  amount: number | null;
  validFrom: string | null;
  validTo: string | null;
  benefitMonths: number | null;
  maxUses: number | null;
  usedCount: number;
  newOnly: boolean;
  active: boolean;
  note: string | null;
  createdAt: string;
}
