import { isValidCutoff } from '@/domain/businessDate';
import type { Kurus } from '@/domain/money';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { DEFAULT_SCALE, isValidScaleConfig, type ScaleConfig } from '@/domain/scaleBarcode';
import { addAudit, type Actor } from './audit';
import type { MarketDb } from './db';
import { appendOutbox } from './outbox';
import { changedFields, toPatch } from './records';
import type { MarketSettingsRecord } from './types';

/** What the whole market shares, whichever register it is read on. */
export type MarketSettings = {
  cutoffMinutes: number;
  scale: ScaleConfig;
  /**
   * The credit limit a new customer gets when added by someone who may not approve going over a
   * limit; never none, so nobody opens unlimited credit unasked.
   */
  newCustomerLimit: Kurus;
  /**
   * Minutes without input after which an owner's or a manager's session locks itself; 0 is never.
   * A cashier's session never locks by itself.
   */
  idleLockMinutes: IdleLockMinutes;
  /**
   * Whether anyone types a PIN: to sign in, after a day, after the idle lock, to switch person
   * and to approve. Off, the register opens as the person last at it and nobody is asked.
   */
  requirePin: boolean;
};

/** The idle lock's choices: off, or 3, 10 or 30 minutes. */
export const IDLE_LOCK_CHOICES = [0, 3, 10, 30] as const;
export type IdleLockMinutes = (typeof IDLE_LOCK_CHOICES)[number];

/** Off: an owner who works the register is not asked for the PIN all day; the owner may turn it on. */
export const DEFAULT_IDLE_LOCK_MINUTES: IdleLockMinutes = 0;

export function isValidIdleLock(minutes: unknown): minutes is IdleLockMinutes {
  return (IDLE_LOCK_CHOICES as readonly unknown[]).includes(minutes);
}

/** ₺500, until the market sets its own. */
export const DEFAULT_NEW_CUSTOMER_LIMIT: Kurus = 50_000;

const ID = 'market';

/** A limit a new customer can be given: a whole amount above nothing, within the price limit. */
export function isValidCustomerLimit(amount: unknown): amount is Kurus {
  return (
    Number.isSafeInteger(amount) && (amount as number) > 0 && (amount as number) <= MAX_UNIT_PRICE
  );
}

/**
 * The market's settings; a market that has saved none turns its day at midnight, reads the
 * common scale label (27/28/29, five-digit item code, grams) and gives a new customer ₺500 of
 * credit.
 */
export async function loadMarketSettings(db: MarketDb): Promise<MarketSettings> {
  const record = await db.settings.get(ID);
  const cutoff = record?.cutoffMinutes;
  const scale = record?.scale;
  const limit = record?.newCustomerLimit;
  const idle = record?.idleLockMinutes;
  return {
    // Off unless the market turned it on: a market saved before the setting has no field.
    requirePin: record?.requirePin === true,
    cutoffMinutes: typeof cutoff === 'number' && isValidCutoff(cutoff) ? cutoff : 0,
    scale: scale && isValidScaleConfig(scale) ? scale : DEFAULT_SCALE,
    newCustomerLimit: isValidCustomerLimit(limit) ? limit : DEFAULT_NEW_CUSTOMER_LIMIT,
    idleLockMinutes: isValidIdleLock(idle) ? idle : DEFAULT_IDLE_LOCK_MINUTES,
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
  if (input.idleLockMinutes !== undefined && !isValidIdleLock(input.idleLockMinutes)) {
    throw new RangeError(`The idle lock is 0, 3, 10 or 30 minutes, got ${input.idleLockMinutes}`);
  }
  if (input.requirePin !== undefined && typeof input.requirePin !== 'boolean') {
    throw new RangeError(`PIN sor is on or off, got ${String(input.requirePin)}`);
  }
  if (input.newCustomerLimit !== undefined && !isValidCustomerLimit(input.newCustomerLimit)) {
    throw new RangeError(
      `A new customer's limit is a whole amount above zero, got ${input.newCustomerLimit}`,
    );
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
