import { isValidCutoff } from '@/domain/businessDate';
import { addAudit, type Actor } from './audit';
import type { MarketDb } from './db';
import { appendOutbox } from './outbox';
import { changedFields, toPatch } from './records';
import type { MarketSettingsRecord } from './types';

/** What the whole market shares, whichever register it is read on. */
export type MarketSettings = { cutoffMinutes: number };

const ID = 'market';

/** The market's settings; a market that has saved none turns its day at midnight. */
export async function loadMarketSettings(db: MarketDb): Promise<MarketSettings> {
  const record = await db.settings.get(ID);
  const cutoff = record?.cutoffMinutes;
  return { cutoffMinutes: typeof cutoff === 'number' && isValidCutoff(cutoff) ? cutoff : 0 };
}

/**
 * Saves the market's settings for every register: the minute after midnight the business day
 * turns, 0 to 720. Records already written keep the business day they were given.
 */
export async function saveMarketSettings(
  db: MarketDb,
  input: MarketSettings,
  at: Date,
  actor?: Actor,
): Promise<MarketSettings> {
  if (!isValidCutoff(input.cutoffMinutes)) {
    throw new RangeError(`A day cutoff is a whole 0 to 720 minutes, got ${input.cutoffMinutes}`);
  }
  const stamp = at.toISOString();
  await db.transaction('rw', db.settings, db.outbox, db.auditLog, async () => {
    const current = await db.settings.get(ID);
    const was = current?.cutoffMinutes ?? 0;
    if (actor && was !== input.cutoffMinutes) {
      await addAudit(
        db,
        {
          action: 'settings.update',
          entity: 'settings',
          entityId: ID,
          before: { cutoffMinutes: was },
          after: { cutoffMinutes: input.cutoffMinutes },
        },
        actor,
        at,
      );
    }
    if (!current) {
      const record: MarketSettingsRecord = {
        id: ID,
        cutoffMinutes: input.cutoffMinutes,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await db.settings.add(record);
      await appendOutbox(db, { kind: 'insert', table: 'settings', recordId: ID, record }, at);
      return;
    }
    const changed = changedFields(current, { cutoffMinutes: input.cutoffMinutes });
    await db.settings.put({ ...current, ...changed, updatedAt: stamp });
    await appendOutbox(
      db,
      { kind: 'patch', table: 'settings', recordId: ID, patch: toPatch(changed, stamp) },
      at,
    );
  });
  return { cutoffMinutes: input.cutoffMinutes };
}
