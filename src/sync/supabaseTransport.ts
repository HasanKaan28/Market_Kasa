import type { ServerClient } from '@/server/client';
import type {
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncTransport,
} from './protocol';

/** The owner shut this register out of the market. */
export class DeviceRevokedError extends Error {
  constructor() {
    super('Bu kasanın kaydı iptal edildi.');
    this.name = 'DeviceRevokedError';
  }
}

/** The register is not, or no longer, signed in as a register of a market. */
export class DeviceUnpairedError extends Error {
  constructor() {
    super('Kasayı yeniden bağlayın.');
    this.name = 'DeviceUnpairedError';
  }
}

function failure(error: { message: string; code?: string }): Error {
  if (error.message.includes('device_revoked')) {
    return new DeviceRevokedError();
  }
  // No register on the server, or a session that could not be renewed, which leaves the call
  // to the anonymous role that may not run the sync functions at all.
  if (
    error.message.includes('device_not_registered') ||
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    /JWT/i.test(error.message)
  ) {
    return new DeviceUnpairedError();
  }
  return new Error(error.message);
}

/** The register's connection to its market through the server's sync functions. */
export function supabaseTransport(client: ServerClient): SyncTransport {
  return {
    async push({ ops }: PushRequest): Promise<PushResponse> {
      const { data, error } = await client.rpc('sync_push', { ops });
      if (error) {
        throw failure(error);
      }
      return data as PushResponse;
    },
    async pull({ since, limit }: PullRequest): Promise<PullResponse> {
      const { data, error } = await client.rpc('sync_pull', { since, lim: limit });
      if (error) {
        throw failure(error);
      }
      return data as PullResponse;
    },
  };
}
