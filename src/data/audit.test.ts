import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bulkUpdatePrices } from '@/products/bulkPrice';
import { makeTestDb } from '@/test/db';
import { recordApproval, type Actor } from './audit';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { createProduct, updateProduct } from './products';
import { recordPurchase } from './purchases';
import { saveMarketSettings } from './settings';
import { archiveStaff, createStaff, restoreStaff, setStaffPin, updateStaff } from './staff';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const owner: Actor = { deviceCode: 'K1', staffId: 'staff-owner' };

async function entries() {
  return (await db.auditLog.orderBy('occurredAt').toArray()).map(
    ({ action, entityId, staffId, before, after }) => ({
      action,
      entityId,
      staffId,
      before,
      after,
    }),
  );
}

describe('audit log', () => {
  it('records who changed what', async () => {
    const kaan = await createStaff(db, { name: 'Kaan', role: 'owner', pin: '4821' }, at, owner);
    const ayse = await createStaff(
      db,
      { name: 'Ayşe', role: 'cashier', pin: '1234' },
      later(1),
      owner,
    );
    await updateStaff(db, ayse.id, { role: 'manager' }, later(2), owner);
    await setStaffPin(db, ayse.id, '9999', later(3), owner);
    await archiveStaff(db, ayse.id, later(4), owner);
    await restoreStaff(db, ayse.id, later(5), owner);
    await saveMarketSettings(db, { cutoffMinutes: 120 }, later(6), owner);

    expect(await entries()).toEqual([
      {
        action: 'staff.create',
        entityId: kaan.id,
        staffId: 'staff-owner',
        before: undefined,
        after: { name: 'Kaan', role: 'owner' },
      },
      {
        action: 'staff.create',
        entityId: ayse.id,
        staffId: 'staff-owner',
        before: undefined,
        after: { name: 'Ayşe', role: 'cashier' },
      },
      {
        action: 'staff.update',
        entityId: ayse.id,
        staffId: 'staff-owner',
        before: { role: 'cashier' },
        after: { role: 'manager' },
      },
      {
        action: 'staff.pin',
        entityId: ayse.id,
        staffId: 'staff-owner',
        before: undefined,
        after: undefined,
      },
      {
        action: 'staff.archive',
        entityId: ayse.id,
        staffId: 'staff-owner',
        before: undefined,
        after: undefined,
      },
      {
        action: 'staff.restore',
        entityId: ayse.id,
        staffId: 'staff-owner',
        before: undefined,
        after: undefined,
      },
      {
        action: 'settings.update',
        entityId: 'market',
        staffId: 'staff-owner',
        before: { cutoffMinutes: 0 },
        after: { cutoffMinutes: 120 },
      },
    ]);
    // A PIN never reaches the log, not even as its hash.
    const stored = JSON.stringify(await db.auditLog.toArray());
    const hashes = (await db.staff.toArray()).flatMap((person) => [person.pinHash, person.pinSalt]);
    expect(hashes.some((hash) => stored.includes(hash))).toBe(false);
    expect((await pendingOps(db)).filter((op) => op.table === 'auditLog')).toHaveLength(7);
  });

  it('records a sell price changed on a goods receipt', async () => {
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
      at,
    );
    await recordPurchase(
      db,
      { deviceCode: 'K1', lines: [{ productId: tea.id, qtyMilli: 1000, sellPrice: 5000 }] },
      later(1),
      owner,
    );
    expect(await entries()).toEqual([
      {
        action: 'product.price',
        entityId: tea.id,
        staffId: 'staff-owner',
        before: { sellPrice: 9000 },
        after: { sellPrice: 5000 },
      },
    ]);
  });

  it('records a price change and an approval', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    const tea = await createProduct(
      db,
      { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
      at,
    );
    await updateProduct(db, milk.id, { name: 'Süt 1 L' }, later(1), owner);
    await updateProduct(db, milk.id, { sellPrice: 4500 }, later(2), owner);
    await bulkUpdatePrices(
      db,
      [tea.id],
      { target: 'sellPrice', by: 'percent', value: 100, roundTo: 0 },
      later(3),
      owner,
    );
    await recordApproval(db, { permission: 'discount', approverId: 'staff-manager' }, later(4), {
      deviceCode: 'K1',
      staffId: 'staff-cashier',
    });
    expect(await entries()).toEqual([
      {
        action: 'product.price',
        entityId: milk.id,
        staffId: 'staff-owner',
        before: { sellPrice: 4250 },
        after: { sellPrice: 4500 },
      },
      {
        action: 'product.price',
        entityId: tea.id,
        staffId: 'staff-owner',
        before: { sellPrice: 9000 },
        after: { sellPrice: 9900 },
      },
      {
        action: 'approval',
        entityId: undefined,
        staffId: 'staff-cashier',
        before: undefined,
        after: { permission: 'discount', approverId: 'staff-manager' },
      },
    ]);
  });
});
