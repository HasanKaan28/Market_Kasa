import { createClient } from '@supabase/supabase-js';
import type { ServerConfig } from '@/server/config';

type Failure = { message: string; code?: string } | null;
type AuthAnswer = { data: { session: unknown }; error: Failure };

/** The part of the Supabase client the operator panel uses, so tests can stand in for it. */
export type OperatorClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Failure }>;
  auth: {
    getSession(): Promise<{ data: { session: unknown } }>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<AuthAnswer>;
    signUp(credentials: { email: string; password: string }): Promise<AuthAnswer>;
    signOut(options?: { scope: 'local' | 'global' | 'others' }): Promise<{ error: Failure }>;
  };
};

/** Where the operator's session is kept: apart from the register's (mk2.auth) and the owner's. */
export const OPERATOR_STORAGE_KEY = 'mk2.operator';

/**
 * The operator's own client. Its session lives under its own key, so signing in or out here
 * never touches the register's device session in the same browser.
 */
export function operatorClient(config: ServerConfig): OperatorClient {
  return createClient(config.url, config.key, {
    auth: {
      storageKey: OPERATOR_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }) as unknown as OperatorClient;
}

export type CodeStatus = 'unused' | 'used' | 'expired' | 'revoked';

export type ActivationCode = {
  code: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  status: CodeStatus;
  marketId: string | null;
  marketName: string | null;
  /** The account that used it; absent from servers before the m6 migration. */
  usedByEmail?: string | null;
};

export type MarketStatus = 'active' | 'suspended';

/** A count and its total in kuruş: voided sales are left out. */
export type SalesSum = { count: number; total: number };

export type OperatorMarket = {
  id: string;
  name: string;
  status: MarketStatus;
  createdAt: string;
  activatedAt: string | null;
  activationCode: string | null;
  devices: number;
  lastSyncAt: string | null;
  ownerEmail: string | null;
  /** The rest arrive with the m6 migration; the list works without them. */
  staff?: number;
  sales30?: SalesSum;
  lastSaleAt?: string | null;
  plan?: string | null;
  planUntil?: string | null;
};

export type Overview = {
  markets: { total: number; active: number; suspended: number; new30: number };
  codes: Record<'issued' | 'used' | 'unused' | 'expired' | 'revoked', number>;
  devices: { total: number; seenToday: number };
  sales: { today: SalesSum; last30: SalesSum };
  expiringCodes: { code: string; note: string; expiresAt: string }[];
  planDue: { id: string; name: string; plan: string | null; planUntil: string }[];
  quiet: { id: string; name: string; lastSyncAt: string | null }[];
};

export type Device = {
  id: string;
  code: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type MarketDetail = {
  id: string;
  name: string;
  status: MarketStatus;
  createdAt: string;
  activatedAt: string | null;
  activationCode: string | null;
  code: { note: string; createdAt: string; usedAt: string | null } | null;
  people: { email: string | null; role: 'owner' | 'manager' }[];
  devices: Device[];
  staff: { active: number; archived: number };
  rowCounts: { table: string; count: number }[];
  bytes: number;
  lastSyncAt: string | null;
  lastSaleAt: string | null;
  sales: { today: SalesSum; last30: SalesSum; all: SalesSum };
  voids30: number;
  returns30: SalesSum;
  activeDevices30: number;
  /** The operator's own record; nothing in the shop reads it. */
  info: {
    plan: string | null;
    planUntil: string | null;
    note: string | null;
    updatedAt: string;
  } | null;
};

export type LogEntry = {
  id: number;
  at: string;
  action: string;
  marketId: string | null;
  marketName: string | null;
  operatorEmail: string | null;
  details: Record<string, unknown>;
};

/** A refusal from the server, carrying its reason (`not_operator`, `code_used`, …). */
export class OperatorError extends Error {}

async function call<T>(client: OperatorClient, fn: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    throw new OperatorError(error.message);
  }
  return data as T;
}

/** The panel's server functions, each answered only for an operator (op_claim aside). */
export function operatorApi(client: OperatorClient) {
  return {
    /** Makes the caller the first operator when their email was claimed; false otherwise. */
    claim: () => call<boolean>(client, 'op_claim'),
    /** True for an operator; a non-operator is refused with `not_operator`. */
    whoami: () => call<boolean>(client, 'op_whoami'),
    issueCode: (note: string, days: number) =>
      call<string>(client, 'op_issue_code', { note, days }),
    listCodes: () => call<ActivationCode[]>(client, 'op_list_codes'),
    revokeCode: (code: string) => call<void>(client, 'op_revoke_code', { code }),
    extendCode: (code: string, days: number) =>
      call<{ code: string; expiresAt: string }>(client, 'op_extend_code', { code, days }),
    listMarkets: () => call<OperatorMarket[]>(client, 'op_list_markets'),
    setMarketStatus: (marketId: string, status: MarketStatus) =>
      call<void>(client, 'op_set_market_status', { market_id: marketId, status }),
    issueCodes: (note: string, days: number, count: number) =>
      call<string[]>(client, 'op_issue_codes', { note, days, count }),
    overview: () => call<Overview>(client, 'op_overview'),
    market: (marketId: string) => call<MarketDetail>(client, 'op_market', { market_id: marketId }),
    history: ({
      limit = 50,
      beforeId = null,
      marketId = null,
    }: { limit?: number; beforeId?: number | null; marketId?: string | null } = {}) =>
      call<LogEntry[]>(client, 'op_history', {
        lim: limit,
        before_id: beforeId,
        market_id: marketId,
      }),
    revokeDevice: (deviceId: string) =>
      call<void>(client, 'op_revoke_device', { device_id: deviceId }),
    setPlan: (marketId: string, plan: string, planUntil: string | null) =>
      call<{ plan: string | null; planUntil: string | null }>(client, 'op_set_market_plan', {
        market_id: marketId,
        plan,
        plan_until: planUntil,
      }),
    setNote: (marketId: string, note: string) =>
      call<void>(client, 'op_set_market_note', { market_id: marketId, note }),
  };
}

export type OperatorApi = ReturnType<typeof operatorApi>;

/** Short Turkish for each refusal the panel can meet. */
export function messageOf(error: unknown): string {
  // Supabase's auth answers carry a plain `{ message }`, not an Error.
  const text =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error);
  const known: [string, string][] = [
    ['not_operator', 'Bu hesabın yetkisi yok.'],
    ['bad_note', 'Not 1–200 karakter olmalı.'],
    ['bad_days', 'Gün 1–365 arası olmalı.'],
    ['code_not_found', 'Kod bulunamadı.'],
    ['code_used', 'Kod kullanılmış.'],
    ['code_revoked', 'Kod iptal edilmiş.'],
    ['bad_status', 'Geçersiz durum.'],
    ['market_not_found', 'Market bulunamadı.'],
    ['bad_count', 'Adet 1–50 arası olmalı.'],
    ['bad_plan', 'Paket adı en çok 40 karakter olmalı.'],
    ['bad_date', 'Tarih bugünden en çok 10 yıl uzakta olabilir.'],
    ['note_too_long', 'Not en çok 2000 karakter olabilir.'],
    ['device_not_found', 'Cihaz bulunamadı.'],
    ['device_revoked', 'Cihaz zaten iptal edilmiş.'],
    ['Invalid login credentials', 'E-posta ya da şifre yanlış.'],
    ['User already registered', 'Bu e-postayla hesap var. Giriş yapın.'],
  ];
  return known.find(([key]) => text.includes(key))?.[1] ?? 'İşlem yapılamadı. Tekrar deneyin.';
}
