import type {
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncTransport,
} from '../../src/sync/protocol';
import type { TestServer } from './harness';

/** Set `lost` and the next push is applied, then answered with an error instead of its result. */
export type AckSwitch = { lost: boolean };

/** A register's transport to the SQL server: the same functions the app calls through Supabase. */
export function sqlTransport(
  server: TestServer,
  userId: string,
  ack: AckSwitch = { lost: false },
): SyncTransport {
  const session = server.as(userId);
  return {
    async push({ ops }: PushRequest): Promise<PushResponse> {
      const response = await session.rpc<PushResponse>('sync_push', [ops]);
      if (ack.lost) {
        ack.lost = false;
        throw new Error('acknowledgement lost');
      }
      return response;
    },
    pull({ since, limit }: PullRequest): Promise<PullResponse> {
      return session.rpc<PullResponse>('sync_pull', [since, limit]);
    },
  };
}
