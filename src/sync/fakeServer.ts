import type { OutboxItem } from '@/data/types';
import type {
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  ServerRow,
  SyncTable,
  SyncTransport,
} from './protocol';

type StoredRow = { row: Record<string, unknown>; serverSeq: number };

/**
 * In-memory server with the same rules the real one must follow: operations are applied once
 * per opId, inserts once per record, patches field by field (null clears a field), and the
 * product with the smallest id keeps a contested barcode.
 */
export class FakeServer implements SyncTransport {
  private readonly tables = new Map<SyncTable, Map<string, StoredRow>>();
  private readonly appliedOps = new Set<string>();
  private lastSeq = 0;
  private nextFailure: Error | undefined;

  async push(request: PushRequest): Promise<PushResponse> {
    const failure = this.nextFailure;
    if (failure) {
      this.nextFailure = undefined;
      throw failure;
    }
    const acknowledged: number[] = [];
    for (const op of request.ops) {
      if (!this.appliedOps.has(op.opId)) {
        this.apply(op);
        this.appliedOps.add(op.opId);
      }
      if (op.seq !== undefined) {
        acknowledged.push(op.seq);
      }
    }
    return { acknowledged };
  }

  async pull({ since, limit }: PullRequest): Promise<PullResponse> {
    const changed: ServerRow[] = [];
    for (const [table, rows] of this.tables) {
      for (const [id, stored] of rows) {
        if (stored.serverSeq > since) {
          changed.push({ table, id, serverSeq: stored.serverSeq, row: clone(stored.row) });
        }
      }
    }
    const page = changed.sort((a, b) => a.serverSeq - b.serverSeq).slice(0, limit);
    return { rows: page, latest: page.at(-1)?.serverSeq ?? since };
  }

  /** Current rows of a table, ordered by id. */
  rows(table: SyncTable): Record<string, unknown>[] {
    return [...this.table(table).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, stored]) => clone(stored.row));
  }

  failNextPush(error: Error = new Error('network down')): void {
    this.nextFailure = error;
  }

  private apply(op: OutboxItem): void {
    const rows = this.table(op.table);
    if (op.kind === 'insert') {
      if (rows.has(op.recordId)) {
        return;
      }
      rows.set(op.recordId, { row: clone(op.record), serverSeq: this.bumpSeq() });
    } else {
      const stored = rows.get(op.recordId);
      if (!stored) {
        return;
      }
      const row = { ...stored.row };
      for (const [key, value] of Object.entries(op.patch)) {
        if (value === null) {
          delete row[key];
        } else {
          row[key] = value;
        }
      }
      rows.set(op.recordId, { row, serverSeq: this.bumpSeq() });
    }
    if (op.table === 'products') {
      this.resolveBarcodeConflicts();
    }
  }

  private resolveBarcodeConflicts(): void {
    const products = this.table('products');
    const holders = new Map<string, string[]>();
    for (const [id, stored] of products) {
      const barcode = stored.row.barcode;
      if (typeof barcode === 'string') {
        holders.set(barcode, [...(holders.get(barcode) ?? []), id]);
      }
    }
    for (const ids of holders.values()) {
      for (const loserId of ids.sort().slice(1)) {
        const stored = products.get(loserId);
        if (stored) {
          const row = { ...stored.row };
          delete row.barcode;
          products.set(loserId, { row, serverSeq: this.bumpSeq() });
        }
      }
    }
  }

  private table(name: SyncTable): Map<string, StoredRow> {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = new Map();
      this.tables.set(name, rows);
    }
    return rows;
  }

  private bumpSeq(): number {
    this.lastSeq += 1;
    return this.lastSeq;
  }
}

function clone(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
