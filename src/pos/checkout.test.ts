import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomer, customerBalance } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { CreditLimitError, PaymentMismatchError } from '@/data/errors';
import { createProduct, updateProduct } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { recordReturn } from '@/data/returns';
import { makeTestDb } from '@/test/db';
import { cartReducer, emptyCart, type Cart } from './cart';
import {
  checkout,
  checkoutErrorMessage,
  singlePayment,
  StaleCartError,
  suggestCash,
} from './checkout';

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
    const first = await checkout(db, { cart, deviceCode: 'K1', payments: singlePayment(cart, 'cash'), cashGiven: 5000, at });
    const again = await checkout(db, { cart, deviceCode: 'K1', payments: singlePayment(cart, 'cash'), cashGiven: 5000, at });
    expect(first).toMatchObject({
      id: cart.id,
      total: 4250,
      change: 750,
      receiptNo: 'K1-20261029-0001',
    });
    expect(again.id).toBe(first.id);
    expect(await db.sales.count()).toBe(1);
  });

  it('refuses a cart id that was already sold with other lines', async () => {
    await checkout(db, { cart, deviceCode: 'K1', payments: singlePayment(cart, 'card'), at });
    const bread = await createProduct(db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at);
    const grown = cartReducer(cart, { type: 'add', product: bread });
    const error = await checkout(db, { cart: grown, deviceCode: 'K1', payments: singlePayment(grown, 'card'), at }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StaleCartError);
    expect(checkoutErrorMessage(error)).toBe(
      'Bu sepet başka bir pencerede satılmış. Sepet yenilendi, yeniden deneyin.',
    );
    expect(await db.sales.count()).toBe(1);
  });

  it('explains a credit limit refusal', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet', creditLimit: 1000 }, at);
    const error = await checkout(db, {
      cart,
      deviceCode: 'K1',
      payments: singlePayment(cart, 'credit'),
      customerId: customer.id,
      at,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CreditLimitError);
    expect(checkoutErrorMessage(error)).toBe('Müşterinin veresiye limiti aşılıyor.');
  });

  it('explains a total that changed under the cart', async () => {
    await updateProduct(db, milk.id, { sellPrice: 4500 }, at);
    const error = await checkout(db, { cart, deviceCode: 'K1', payments: singlePayment(cart, 'card'), at }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PaymentMismatchError);
    expect(checkoutErrorMessage(error)).toBe('Tutar değişti, toplamı kontrol edip yeniden deneyin.');
  });
});

describe('checkout with discounts and several payments', () => {
  it('records a split sale', async () => {
    const bread = await createProduct(db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at);
    const customer = await createCustomer(db, { name: 'Ahmet' }, at);
    const both = cartReducer(cart, { type: 'add', product: bread });
    const sale = await checkout(db, {
      cart: both,
      deviceCode: 'K1',
      at,
      cashGiven: 5000,
      customerId: customer.id,
      payments: [
        { method: 'cash', amount: 2000 },
        { method: 'card', amount: 2000 },
        { method: 'credit', amount: 1750 },
      ],
    });
    expect(sale.payments).toHaveLength(3);
    expect(sale.change).toBe(3000);
    expect(await customerBalance(db, customer.id)).toBe(1750);
  });

  it('records discounts on the sale', async () => {
    const bread = await createProduct(db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at);
    let both = cartReducer(cart, { type: 'add', product: bread });
    both = cartReducer(both, { type: 'setLineDiscount', productId: milk.id, amount: 250 });
    both = cartReducer(both, { type: 'setCartDiscount', amount: 500 });
    const sale = await checkout(db, {
      cart: both,
      deviceCode: 'K1',
      at,
      payments: singlePayment(both, 'card'),
    });
    expect(sale).toMatchObject({ cartDiscount: 500, total: 5000 });
    expect(sale.lines.find((line) => line.productId === milk.id)?.lineDiscount).toBe(250);
  });

  it('splits a partial return of a discounted sale from the discounted net', async () => {
    const bread = await createProduct(db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at);
    let two = cartReducer(emptyCart(), { type: 'add', product: bread });
    two = cartReducer(two, { type: 'add', product: bread });
    two = cartReducer(two, { type: 'setCartDiscount', amount: 300 });
    const sale = await checkout(db, {
      cart: two,
      deviceCode: 'K1',
      at,
      payments: singlePayment(two, 'cash'),
    });
    const back = await recordReturn(db, {
      saleId: sale.id,
      lines: [{ productId: bread.id, qtyMilli: 1000 }],
      refundMethod: 'cash',
      deviceCode: 'K1',
      at,
    });
    expect(back.amount).toBe(1350);
  });
});

describe('suggestCash', () => {
  it('suggests round amounts above the total', () => {
    expect(suggestCash(56640)).toEqual([57000, 60000, 100000]);
    expect(suggestCash(4250)).toEqual([5000, 10000, 50000]);
    expect(suggestCash(5000)).toEqual([10000, 50000]);
  });
});
