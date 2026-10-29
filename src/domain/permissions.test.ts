import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, type Permission, type Role } from './permissions';

const ROLES: readonly Role[] = ['cashier', 'stock', 'manager', 'owner'];

// DESIGN §8.5, row by row; the columns are cashier, stock, manager, owner.
const TABLE: Record<Permission, readonly [boolean, boolean, boolean, boolean]> = {
  sell: [true, false, true, true],
  creditSale: [true, false, true, true],
  overLimit: [false, false, true, true],
  discount: [false, false, true, true],
  returnWithReceipt: [true, false, true, true],
  voidSale: [false, false, true, true],
  collect: [true, false, true, true],
  addProduct: [true, true, true, true],
  editProducts: [false, true, true, true],
  seeCost: [false, true, true, true],
  stock: [false, true, true, true],
  suppliers: [false, true, true, true],
  reports: [false, false, true, true],
  closeDay: [true, false, true, true],
  invoice: [true, false, true, true],
  admin: [false, false, false, true],
};

describe('can', () => {
  it('gives each role the permissions of §8.5', () => {
    expect([...PERMISSIONS].sort()).toEqual(Object.keys(TABLE).sort());
    for (const permission of PERMISSIONS) {
      const granted = ROLES.map((role) => can({ role }, permission));
      expect([permission, ...granted]).toEqual([permission, ...TABLE[permission]]);
    }
  });

  it('lets a person’s own permission win over the role, except for the owner', () => {
    expect(can({ role: 'cashier', permissions: { discount: true } }, 'discount')).toBe(true);
    expect(can({ role: 'manager', permissions: { reports: false } }, 'reports')).toBe(false);
    expect(can({ role: 'manager', permissions: { discount: true } }, 'reports')).toBe(true);
    expect(can({ role: 'owner', permissions: { admin: false } }, 'admin')).toBe(true);
  });
});
