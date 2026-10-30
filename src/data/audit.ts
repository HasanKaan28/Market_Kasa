import { businessDate } from '@/domain/businessDate';
import type { Permission } from '@/domain/permissions';
import type { MarketDb } from './db';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { AuditAction, AuditRecord } from './types';

/** Who does a management action, from which register, on the market's business day. */
export type Actor = { deviceCode: string; staffId?: string; cutoffMinutes?: number };

export type NewAudit = {
  action: AuditAction;
  entity: AuditRecord['entity'];
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

const LATEST = 200;

/**
 * Writes one entry of the audit log and queues it. It runs inside the caller's transaction, which
 * must include `auditLog` and `outbox`, so the change and its record land together or not at all.
 */
export async function addAudit(
  db: MarketDb,
  entry: NewAudit,
  actor: Actor,
  at: Date,
): Promise<AuditRecord> {
  const record: AuditRecord = withoutUndefined({
    id: newId(at.getTime()),
    deviceCode: actor.deviceCode,
    staffId: actor.staffId,
    ...entry,
    occurredAt: at.toISOString(),
    businessDate: businessDate(at, { cutoffMinutes: actor.cutoffMinutes }),
  });
  await db.auditLog.add(record);
  await appendOutbox(db, { kind: 'insert', table: 'auditLog', recordId: record.id, record }, at);
  return record;
}

/** Records that a permitted person let someone else do something (`actor` is who asked). */
export async function recordApproval(
  db: MarketDb,
  { permission, approverId }: { permission: Permission; approverId: string },
  at: Date,
  actor: Actor,
): Promise<AuditRecord> {
  return db.transaction('rw', db.auditLog, db.outbox, () =>
    addAudit(
      db,
      { action: 'approval', entity: 'approval', after: { permission, approverId } },
      actor,
      at,
    ),
  );
}

/** The newest entries first. */
export async function latestAudit(db: MarketDb, limit = LATEST): Promise<AuditRecord[]> {
  return db.auditLog.orderBy('occurredAt').reverse().limit(limit).toArray();
}

/** The fields among `keys` whose values differ, as they were and as they are. */
export function auditChange<T extends object>(
  before: T,
  after: Partial<T>,
  keys: readonly (keyof T & string)[],
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  // Compared as JSON, so a permissions object with the same content counts as unchanged.
  const changed = keys.filter(
    (key) => key in after && JSON.stringify(after[key]) !== JSON.stringify(before[key]),
  );
  if (changed.length === 0) {
    return null;
  }
  return {
    before: Object.fromEntries(changed.map((key) => [key, before[key]])),
    after: Object.fromEntries(changed.map((key) => [key, after[key]])),
  };
}
