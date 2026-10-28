import type { OutboxItem, OutboxTable } from '@/data/types';

export type SyncTable = OutboxTable;

export type PushRequest = { ops: OutboxItem[] };

/** The device-side `seq` of every operation the server processed, applied or already known. */
export type PushResponse = { acknowledged: number[] };

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
