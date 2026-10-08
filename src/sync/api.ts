import { Platform } from 'react-native';
import type {
  ApiError as ApiErrorBody,
  AuthPollResponse,
  AuthStartResponse,
  InviteResponse,
  MeResponse,
  PullResponse,
  PushResponse,
} from '../../server/src/contract';
import { EpochError, type Transport } from './engine';

/** Server manzili: `.env` / EAS profilidagi EXPO_PUBLIC_API_URL, bo'lmasa Railway'dagi asosiy server. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://server-production-9388.up.railway.app').replace(/\/$/, '');

const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorBody['code'] | 'server';
  readonly epoch?: number;
  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? `Server xatosi (${status})`);
    this.status = status;
    this.code = body.code ?? 'server';
    this.epoch = body.epoch;
  }
}

/** Internet yo'q yoki server javob bermadi. */
export class OfflineError extends Error {
  constructor() {
    super("Internet yo'q — ma'lumot telefonda saqlanadi va keyin yuboriladi");
  }
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data as Partial<ApiErrorBody>);
  return data as T;
}

/** Telefon modeli (qurilmalar ro'yxatida ko'rinadi). */
export function deviceModel(): string {
  const c = Platform.constants as { Model?: string; Brand?: string };
  return [c.Brand, c.Model].filter(Boolean).join(' ') || Platform.OS;
}

export const api = {
  authStart: (installId: string) => request<AuthStartResponse>('/api/auth/start', { body: { installId, model: deviceModel() } }),
  authPoll: (token: string) => request<AuthPollResponse>(`/api/auth/poll?token=${encodeURIComponent(token)}`),
  me: (token: string) => request<MeResponse>('/api/me', { token }),
  logout: (token: string) => request<{ ok: true }>('/api/auth/logout', { token, body: {} }),
  invite: (token: string) => request<InviteResponse>('/api/hall/invite', { token, body: {} }),
  revokeDevice: (token: string, id: string) => request<{ ok: true }>(`/api/devices/${id}`, { token, method: 'DELETE' }),
  resetHall: (token: string, tables: string[]) => request<{ ok: true; epoch: number }>('/api/hall/reset', { token, body: { tables } }),

  transport(token: string): Transport {
    return {
      async push(req) {
        try {
          return await request<PushResponse>('/api/sync/push', { token, body: req });
        } catch (e) {
          if (e instanceof ApiError && e.code === 'epoch') throw new EpochError(e.epoch ?? 0);
          throw e;
        }
      },
      pull: (since, limit) => request<PullResponse>(`/api/sync/pull?since=${since}&limit=${limit}`, { token }),
    };
  },
};
