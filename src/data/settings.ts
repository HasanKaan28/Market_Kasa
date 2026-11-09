import { isValidCutoff } from '@/domain/businessDate';
import { DEFAULT_SCALE, isValidScaleConfig, type ScaleConfig } from '@/domain/scaleBarcode';
import { addAudit, type Actor } from './audit';
import type { MarketDb } from './db';
import { appendOutbox } from './outbox';
import { changedFields, toPatch } from './records';
import type { MarketSettingsRecord } from './types';

/** What the whole market shares, whichever register it is read on. */
export type MarketSettings = { cutoffMinutes: number; scale: ScaleConfig };

const ID = 'market';

/**
 * The market's settings; a market that has saved none turns its day at midnight and reads the
 * common scale label (27/28/29, five-digit item code, grams).
 */
export async function loadMarketSettings(db: MarketDb): Promise<MarketSettings> {
  const record = await db.settings.get(ID);
  const cutoff = record?.cutoffMinutes;
  const scale = record?.scale;
  return {
    cutoffMinutes: typeof cutoff === 'number' && isValidCutoff(cutoff) ? cutoff : 0,
    scale: scale && isValidScaleConfig(scale) ? scale : DEFAULT_SCALE,
  };
}

/**
 * Saves the given settings for every register; the others stay as they are. The day cutoff is
 * 0 to 720 minutes after midnight; records already written keep the business day they were given.
 */
export async function saveMarketSettings(
  db: MarketDb,
  input: Partial<MarketSettings>,
  at: Date,
  actor?: Actor,
): Promise<MarketSettings> {
  if (input.cutoffMinutes !== undefined && !isValidCutoff(input.cutoffMinutes)) {
    throw new RangeError(`A day cutoff is a whole 0 to 720 minutes, got ${input.cutoffMinutes}`);
  }
  if (input.scale !== undefined && !isValidScaleConfig(input.scale)) {
    throw new RangeError('A scale label needs prefixes 20–29 and an item code of 4 to 6 digits');
  }
  const stamp = at.toISOString();
  let saved: MarketSettings = await loadMarketSettings(db);
  await db.transaction('rw', db.settings, db.outbox, db.auditLog, async () => {
    const was = await loadMarketSettings(db);
    const next: MarketSettings = { ...was, ...input };
    saved = next;
    const current = await db.settings.get(ID);
    const before: Partial<MarketSettings> = {};
    const after: Partial<MarketSettings> = {};
    for (const key of Object.keys(input) as (keyof MarketSettings)[]) {
      if (JSON.stringify(was[key]) !== JSON.stringify(next[key])) {
        Object.assign(before, { [key]: was[key] });
        Object.assign(after, { [key]: next[key] });
      }
    }
    if (actor && Object.keys(after).length > 0) {
      await addAudit(
        db,
        { action: 'settings.update', entity: 'settings', entityId: ID, before, after },
        actor,
        at,
      );
    }
    if (!current) {
      const record: MarketSettingsRecord = { id: ID, ...next, createdAt: stamp, updatedAt: stamp };
      await db.settings.add(record);
      await appendOutbox(db, { kind: 'insert', table: 'settings', recordId: ID, record }, at);
      return;
    }
    const changed = changedFields(current, input);
    await db.settings.put({ ...current, ...changed, updatedAt: stamp });
    await appendOutbox(
      db,
      { kind: 'patch', table: 'settings', recordId: ID, patch: toPatch(changed, stamp) },
      at,
    );
  });
  return saved;
}
