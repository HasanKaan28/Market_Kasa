import type { OutboxItem, OutboxTable } from '@/data/types';

export type SyncTable = OutboxTable;

export type PushRequest = { ops: OutboxItem[] };

/** An operation the server refused, such as a price edit without permission. */
export type Rejection = { seq: number; reason: string };

/**
 * `acknowledged`: the device-side `seq` of every operation the server applied or already knew.
 * `rejected`: operations it refused. The device drops them, and the server sends the current
 * row of each refused record again, so the device's local value reverts on its next pull.
 */
export type PushResponse = { acknowledged: number[]; rejected?: Rejection[] };

/** A row's current server state; `serverSeq` grows with every change to any row. */
export type ServerRow = {
  table: SyncTable;
  id: string;
  serverSeq: number;
  row: Record<string, unknown>;
};

export type PullRequest = { since: number; limit: number };

/** `latest` is the last returned `serverSeq`, or `since` when nothing changed. */
export type PullResponse = { rows: ServerRow[]; latest: number };

export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(request: PullRequest): Promise<PullResponse>;
}
