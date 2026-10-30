import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomer, customerBalance } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { guessMapping, readImportRows } from '@/products/importRows';
import { makeTestDb } from '@/test/db';
import { applyV1Customers, planV1Customers, readV1Backup, v1ProductTable } from './v1Backup';

const at = new Date('2026-10-30T09:00:00Z');

const backup = {
  backupDate: '2026-10-01T10:00:00.000Z',
  storeName: 'Kurşunlu Market',
  products: [
    {
      id: 1,
      barcode: '8690000000017',
      name: 'Süt 1 L',
      category: 'Süt',
      price: 42.5,
      buyPrice: 35,
      taxRate: 1,
      stock: 12,
      unit: 'Adet',
      isQuick: true,
    },
    {
      id: 2,
      barcode: 'BRK-12345678',
      name: 'Domates',
      category: 'Sebze',
      price: '29.9',
      buyPrice: 20,
      taxRate: 1,
      stock: 2.5,
      unit: 'Kg',
      isQuick: false,
      isNoBarcode: true,
    },
    { id: 3, barcode: '8690000000024', name: 'Kola', price: 'yok', taxRate: 20, stock: -2 },
  ],
  customers: [
    { id: 1, name: 'Ahmet Yılmaz', phone: '0532 111 22 33', balance: 150.75, limit: 2000 },
    { id: 2, name: 'Ayşe', phone: '', balance: -20, limit: 500 },
    { id: 3, name: '  ', phone: '0532 000 00 00', balance: 10 },
    { id: 4, name: 'Ahmet Yılmaz', phone: '05321112233', balance: 5 },
  ],
  sales: [{ id: 1, receiptNo: 'F-1' }],
  customerTransactions: [],
  settings: [],
};

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

describe('v1 backup', () => {
  it('reads only a v1 backup', () => {
    expect(readV1Backup(JSON.stringify(backup))?.products).toHaveLength(3);
    expect(readV1Backup('{"products": "no"}')).toBeNull();
    expect(readV1Backup('[1, 2]')).toBeNull();
    expect(readV1Backup('Barkod;Ürün adı')).toBeNull();
    expect(readV1Backup(JSON.stringify({ customers: [] }))?.products).toEqual([]);
  });

  it('reads the products of a v1 backup into the import table', () => {
    const table = v1ProductTable(readV1Backup(JSON.stringify(backup))!);
    expect(table[0]).toEqual([
      'Barkod',
      'Ürün adı',
      'Kategori',
      'Birim',
      'Satış fiyatı',
      'Alış fiyatı',
      'KDV',
      'Stok',
      'Hızlı ürün',
    ]);
    expect(table[1]).toEqual([
      '8690000000017',
      'Süt 1 L',
      'Süt',
      'Adet',
      '42,50',
      '35,00',
      '1',
      '12',
      'evet',
    ]);
    // A made-up BRK- code is no barcode; a price written as text still reads.
    expect(table[2]).toEqual(['', 'Domates', 'Sebze', 'Kg', '29,90', '20,00', '1', '2,5', 'hayır']);
    expect(table[3]).toEqual(['8690000000024', 'Kola', '', '', '', '', '20', '-2', '']);

    // Through the same reader as any other file.
    const rows = readImportRows(table, guessMapping(table[0]!), true);
    expect(rows[0]?.fields).toMatchObject({
      barcode: '8690000000017',
      sellPrice: 4250,
      buyPrice: 3500,
      vatRate: 1,
      stockMilli: 12000,
      unit: 'piece',
      isQuick: true,
    });
    expect(rows[1]?.fields).toMatchObject({ unit: 'kg', sellPrice: 2990, stockMilli: 2500 });
    expect(rows[1]?.fields.barcode).toBeUndefined();
  });

  it('does not bring the same customer twice', async () => {
    const parsed = readV1Backup(JSON.stringify(backup))!;
    const plan = await planV1Customers(db, parsed);
    expect(plan.map((row) => [row.name, row.action, row.balance, row.creditLimit])).toEqual([
      ['Ahmet Yılmaz', 'create', 15075, 200000],
      ['Ayşe', 'create', -2000, 50000],
      ['', 'error', 1000, 0],
      // The same name and phone again in the file.
      ['Ahmet Yılmaz', 'exists', 500, 0],
    ]);
    expect(plan[2]?.error).toBe('Adı yok.');

    const result = await applyV1Customers(db, plan, at);
    expect(result).toEqual({ created: 2, skipped: 2 });
    const ahmet = (await db.customers.toArray()).find((c) => c.name === 'Ahmet Yılmaz')!;
    expect(ahmet).toMatchObject({ phone: '05321112233', creditLimit: 200000 });
    expect(await customerBalance(db, ahmet.id)).toBe(15075);
    expect(await db.ledger.where('customerId').equals(ahmet.id).first()).toMatchObject({
      kind: 'adjustment',
      amount: 15075,
      note: "v1'den devreden borç",
    });

    // The same backup again: everyone is already here.
    const again = await planV1Customers(db, parsed);
    expect(again.map((row) => row.action)).toEqual(['exists', 'exists', 'error', 'exists']);
    expect(await applyV1Customers(db, again, at)).toEqual({ created: 0, skipped: 4 });
    expect(await db.customers.count()).toBe(2);
  });

  it('matches a customer already typed into v2 by name and phone', async () => {
    await createCustomer(db, { name: 'ahmet yılmaz', phone: '0532 111 22 33' }, at);
    const plan = await planV1Customers(db, readV1Backup(JSON.stringify(backup))!);
    expect(plan[0]?.action).toBe('exists');
  });
});
