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
  resetStaffPin,
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

function owner(name = 'Kaan', pin = '482100') {
  return createStaff(db, { name, role: 'owner', pin }, at);
}

describe('staff', () => {
  it('adds the owner first and keeps the PIN only as a hash', async () => {
    await expect(
      createStaff(db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at),
    ).rejects.toThrow(RangeError);
    const kaan = await createStaff(db, { name: ' Kaan ', role: 'owner', pin: '482100' }, at);
    expect(kaan).toMatchObject({ name: 'Kaan', role: 'owner' });
    expect(kaan.pinIterations).toBeGreaterThanOrEqual(100_000);
    expect(JSON.stringify(kaan)).not.toContain('482100');
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
    const ali = await createStaff(db, { name: 'Ali', role: 'owner', pin: '111111' }, minutes(2));
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
    expect(await checkPin(db, kaan.id, '482100', minutes(9))).toMatchObject({ reason: 'locked' });
    expect(await checkPin(db, kaan.id, '482100', minutes(10))).toMatchObject({
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

  it('asks six digits of an owner or a manager PIN set now, and keeps a short one set before', async () => {
    await expect(createStaff(db, { name: 'Kaan', role: 'owner', pin: '4821' }, at)).rejects.toThrow(
      RangeError,
    );
    const kaan = await owner('Kaan', '482100');
    await expect(
      createStaff(db, { name: 'Mehmet', role: 'manager', pin: '2222' }, at),
    ).rejects.toThrow(RangeError);
    // A cashier promoted keeps the PIN they had; a new one must be six digits.
    const ayse = await createStaff(db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at);
    await updateStaff(db, ayse.id, { role: 'manager' }, minutes(1));
    expect(await checkPin(db, ayse.id, '1234', minutes(2))).toMatchObject({ ok: true });
    await expect(setStaffPin(db, ayse.id, '9999', minutes(3))).rejects.toThrow(RangeError);
    await expect(setStaffPin(db, kaan.id, '1111', minutes(3))).rejects.toThrow(RangeError);
    await setStaffPin(db, ayse.id, '999999', minutes(4));
    expect(await checkPin(db, ayse.id, '999999', minutes(5))).toMatchObject({ ok: true });
  });

  it('adds a person without a PIN: a hidden random one is kept, marked as not set', async () => {
    const kaan = await createStaff(db, { name: 'Kaan', role: 'owner' }, at);
    expect(kaan.pinSet).toBe(false);
    // The server refuses a staff row without a PIN hash.
    expect(kaan.pinHash).not.toBe('');
    expect(kaan.pinIterations).toBeGreaterThanOrEqual(100_000);
    const ayse = await createStaff(db, { name: 'Ayşe', role: 'cashier' }, at);
    expect(ayse.pinSet).toBe(false);
    expect(ayse.pinSalt).not.toBe(kaan.pinSalt);
    const [insert] = (await pendingOps(db)).filter(
      (op) => op.table === 'staff' && op.recordId === ayse.id,
    );
    expect(insert).toMatchObject({ record: { pinSet: false, pinHash: ayse.pinHash } });
    // A PIN typed when adding is known: nothing marks it.
    const veli = await createStaff(db, { name: 'Veli', role: 'cashier', pin: '1234' }, at);
    expect(veli.pinSet).toBeUndefined();
  });

  it('marks a PIN as set once the owner gives one', async () => {
    await owner();
    const ayse = await createStaff(db, { name: 'Ayşe', role: 'cashier' }, at);
    const given = await setStaffPin(db, ayse.id, '1234', minutes(1));
    expect(given.pinSet).toBeUndefined();
    expect((await db.staff.get(ayse.id))?.pinSet).toBeUndefined();
    expect(await checkPin(db, ayse.id, '1234', minutes(2))).toMatchObject({ ok: true });
  });

  it('replaces a PIN with a hidden one when it is dropped', async () => {
    await owner();
    const ayse = await createStaff(db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at);
    const dropped = await resetStaffPin(db, ayse.id, minutes(1));
    expect(dropped.pinSet).toBe(false);
    expect(await checkPin(db, ayse.id, '1234', minutes(2))).toMatchObject({ reason: 'wrong' });
  });
});
