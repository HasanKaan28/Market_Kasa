import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomer } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { CreditLimitError, PaymentMismatchError } from '@/data/errors';
import { createProduct, updateProduct } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { makeTestDb } from '@/test/db';
import { cartReducer, emptyCart, type Cart } from './cart';
import { checkout, checkoutErrorMessage, suggestCash } from './checkout';

let db: MarketDb;
let milk: ProductRecord;
let cart: Cart;
const at = new Date('2026-10-29T09:00:00Z');
beforeEach(async () => {
  db = makeTestDb();
  milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
  cart = cartReducer(emptyCart('01a181bc-da80-7001-8203-040506070809'), {
    type: 'add',
    product: milk,
  });
});
afterEach(async () => {
  await db.delete();
});

describe('checkout', () => {
  it('records one sale per cart however often it is checked out', async () => {
    const first = await checkout(db, { cart, deviceCode: 'K1', method: 'cash', cashGiven: 5000, at });
    const again = await checkout(db, { cart, deviceCode: 'K1', method: 'cash', cashGiven: 5000, at });
    expect(first).toMatchObject({
      id: cart.id,
      total: 4250,
      change: 750,
      receiptNo: 'K1-20261029-0001',
    });
    expect(again.id).toBe(first.id);
    expect(await db.sales.count()).toBe(1);
  });

  it('explains a credit limit refusal', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet', creditLimit: 1000 }, at);
    const error = await checkout(db, {
      cart,
      deviceCode: 'K1',
      method: 'credit',
      customerId: customer.id,
      at,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CreditLimitError);
    expect(checkoutErrorMessage(error)).toBe('Müşterinin veresiye limiti aşılıyor.');
  });

  it('explains a total that changed under the cart', async () => {
    await updateProduct(db, milk.id, { sellPrice: 4500 }, at);
    const error = await checkout(db, { cart, deviceCode: 'K1', method: 'card', at }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PaymentMismatchError);
    expect(checkoutErrorMessage(error)).toBe('Tutar değişti, toplamı kontrol edip yeniden deneyin.');
  });
});

describe('suggestCash', () => {
  it('suggests round amounts above the total', () => {
    expect(suggestCash(56640)).toEqual([57000, 60000, 100000]);
    expect(suggestCash(4250)).toEqual([5000, 10000, 50000]);
    expect(suggestCash(5000)).toEqual([10000, 50000]);
  });
});
