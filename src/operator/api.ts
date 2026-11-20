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
};

export type MarketStatus = 'active' | 'suspended';

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
    ['Invalid login credentials', 'E-posta ya da şifre yanlış.'],
    ['User already registered', 'Bu e-postayla hesap var. Giriş yapın.'],
  ];
  return known.find(([key]) => text.includes(key))?.[1] ?? 'İşlem yapılamadı. Tekrar deneyin.';
}
