import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { LastOwnerError } from './errors';
import { pendingOps } from './outbox';
import {
  archiveStaff,
  checkPin,
  createStaff,
  listStaff,
  restoreStaff,
  setStaffPin,
  updateStaff,
} from './staff';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const minutes = (n: number) => new Date(at.getTime() + n * 60_000);

function owner(name = 'Kaan', pin = '4821') {
  return createStaff(db, { name, role: 'owner', pin }, at);
}

describe('staff', () => {
  it('adds the owner first and keeps the PIN only as a hash', async () => {
    await expect(
      createStaff(db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at),
    ).rejects.toThrow(RangeError);
    const kaan = await createStaff(db, { name: ' Kaan ', role: 'owner', pin: '4821' }, at);
    expect(kaan).toMatchObject({ name: 'Kaan', role: 'owner' });
    expect(kaan.pinIterations).toBeGreaterThanOrEqual(100_000);
    expect(JSON.stringify(kaan)).not.toContain('4821');
    const ayse = await createStaff(
      db,
      { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: { discount: true } },
      at,
    );
    expect(ayse.permissions).toEqual({ discount: true });
    await expect(createStaff(db, { name: 'Veli', role: 'cashier', pin: '12' }, at)).rejects.toThrow(
      RangeError,
    );
    await expect(createStaff(db, { name: '  ', role: 'cashier', pin: '1234' }, at)).rejects.toThrow(
      RangeError,
    );
    expect((await listStaff(db)).map((person) => person.name)).toEqual(['Ayşe', 'Kaan']);
    expect((await pendingOps(db)).filter((op) => op.table === 'staff')).toHaveLength(2);
  });

  it('keeps the last owner', async () => {
    const kaan = await owner();
    await expect(updateStaff(db, kaan.id, { role: 'manager' }, minutes(1))).rejects.toThrow(
      LastOwnerError,
    );
    await expect(archiveStaff(db, kaan.id, minutes(1))).rejects.toThrow(LastOwnerError);
    const ali = await createStaff(db, { name: 'Ali', role: 'owner', pin: '1111' }, minutes(2));
    const demoted = await updateStaff(db, kaan.id, { role: 'manager' }, minutes(3));
    expect(demoted.role).toBe('manager');
    await expect(archiveStaff(db, ali.id, minutes(4))).rejects.toThrow(LastOwnerError);
    expect((await pendingOps(db)).at(-1)).toMatchObject({
      kind: 'patch',
      table: 'staff',
      recordId: kaan.id,
      patch: { role: 'manager' },
    });
  });

  it('locks a person after five wrong PINs for five minutes', async () => {
    const kaan = await owner();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await checkPin(db, kaan.id, '0000', minutes(attempt))).toEqual({
        ok: false,
        reason: 'wrong',
        attemptsLeft: 5 - attempt,
      });
    }
    expect(await checkPin(db, kaan.id, '0000', minutes(5))).toEqual({
      ok: false,
      reason: 'locked',
      until: minutes(10).toISOString(),
    });
    // The right PIN does not open a locked person.
    expect(await checkPin(db, kaan.id, '4821', minutes(9))).toMatchObject({ reason: 'locked' });
    expect(await checkPin(db, kaan.id, '4821', minutes(10))).toMatchObject({
      ok: true,
      staff: { id: kaan.id },
    });
    // Signing in starts the count again.
    expect(await checkPin(db, kaan.id, '0000', minutes(11))).toMatchObject({ attemptsLeft: 4 });
  });

  it('refuses an archived person', async () => {
    const kaan = await owner();
    const ayse = await createStaff(db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at);
    await archiveStaff(db, ayse.id, minutes(1));
    expect(await checkPin(db, ayse.id, '1234', minutes(2))).toEqual({
      ok: false,
      reason: 'inactive',
    });
    expect((await listStaff(db, { active: true })).map((person) => person.id)).toEqual([kaan.id]);
    await restoreStaff(db, ayse.id, minutes(3));
    expect(await checkPin(db, ayse.id, '1234', minutes(4))).toMatchObject({ ok: true });
    await setStaffPin(db, ayse.id, '9999', minutes(5));
    expect(await checkPin(db, ayse.id, '1234', minutes(6))).toMatchObject({ reason: 'wrong' });
    expect(await checkPin(db, ayse.id, '9999', minutes(7))).toMatchObject({ ok: true });
  });
});
