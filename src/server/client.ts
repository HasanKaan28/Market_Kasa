import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import type { ServerConfig } from './config';

type RpcError = { message: string; code?: string };
type AuthResult = { error: { message: string } | null };

/** The part of the Supabase client this app uses, so tests can stand in for it. */
export type ServerClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResult>;
    signInAnonymously(): Promise<AuthResult>;
    signOut(): Promise<AuthResult>;
    getSession(): Promise<{ data: { session: unknown } }>;
  };
};

/** The register's own session is kept on the device and renewed while it runs. */
const DEVICE_CLIENT_OPTIONS: SupabaseClientOptions<'public'> = {
  auth: {
    storageKey: 'mk2.auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
};

/** The owner signs in only to make a pairing code; nothing of that session is stored. */
export const OWNER_CLIENT_OPTIONS: SupabaseClientOptions<'public'> = {
  auth: {
    storageKey: 'mk2.owner',
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

let device: ServerClient | undefined;

/** The register's client, one per app: every sync and the pairing claim go through it. */
export function deviceClient(config: ServerConfig): ServerClient {
  device ??= createClient(config.url, config.key, DEVICE_CLIENT_OPTIONS) as unknown as ServerClient;
  return device;
}

/** A fresh client for the owner's one sign-in. */
export function ownerClient(config: ServerConfig): ServerClient {
  return createClient(config.url, config.key, OWNER_CLIENT_OPTIONS) as unknown as ServerClient;
}
