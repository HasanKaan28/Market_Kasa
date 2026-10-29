import type { MarketDb } from '@/data/db';
import { CreditLimitError, PaymentMismatchError } from '@/data/errors';
import { recordSale } from '@/data/sales';
import type { Payment, PaymentMethod, SaleRecord } from '@/data/types';
import type { Kurus } from '@/domain/money';
import { cartTotals, type Cart } from './cart';

export type CheckoutInput = {
  cart: Cart;
  deviceCode: string;
  /** One or more parts that add up to the total (a split sale has several). */
  payments: Payment[];
  customerId?: string;
  cashGiven?: Kurus;
  at: Date;
};

/**
 * The cart's id already belongs to a sale with other lines: another tab, or a cart saved before
 * its sale finished, sold it. Checking out again under that id would only return the old sale.
 */
export class StaleCartError extends Error {
  constructor(receiptNo: string) {
    super(`This cart was already sold as ${receiptNo}`);
    this.name = 'StaleCartError';
  }
}

// Round amounts a customer hands over: the next ₺10, ₺50, ₺100 and ₺500 above the total.
const CASH_STEPS: readonly Kurus[] = [1000, 5000, 10000, 50000];

/** The whole total paid one way. */
export function singlePayment(cart: Cart, method: PaymentMethod): Payment[] {
  return [{ method, amount: cartTotals(cart).total }];
}

/**
 * Records the cart, with its discounts, as one sale. The cart's id makes a retry harmless.
 * Cash given only counts against a cash part, and the customer only for a credit part.
 */
export async function checkout(
  db: MarketDb,
  { cart, deviceCode, payments, customerId, cashGiven, at }: CheckoutInput,
): Promise<SaleRecord> {
  const paidBy = (method: PaymentMethod) => payments.some((payment) => payment.method === method);
  const sale = await recordSale(db, {
    id: cart.id,
    deviceCode,
    at,
    lines: cart.lines.map(({ productId, qtyMilli, lineDiscount }) => ({
      productId,
      qtyMilli,
      lineDiscount,
    })),
    cartDiscount: cart.cartDiscount,
    payments,
    ...(paidBy('cash') && cashGiven !== undefined ? { cashGiven } : {}),
    ...(paidBy('credit') && customerId !== undefined ? { customerId } : {}),
  });
  if (!sameLines(sale, cart)) {
    throw new StaleCartError(sale.receiptNo);
  }
  return sale;
}

export function checkoutErrorMessage(error: unknown): string {
  if (error instanceof CreditLimitError) {
    return 'Müşterinin veresiye limiti aşılıyor.';
  }
  if (error instanceof PaymentMismatchError) {
    return 'Tutar değişti, toplamı kontrol edip yeniden deneyin.';
  }
  if (error instanceof StaleCartError) {
    return 'Bu sepet başka bir pencerede satılmış. Sepet yenilendi, yeniden deneyin.';
  }
  return 'Satış kaydedilemedi.';
}

export function suggestCash(total: Kurus): Kurus[] {
  const amounts = CASH_STEPS.map((step) => Math.ceil(total / step) * step).filter(
    (amount) => amount > total,
  );
  return [...new Set(amounts)].sort((a, b) => a - b);
}

function sameLines(sale: SaleRecord, cart: Cart): boolean {
  return (
    sale.lines.length === cart.lines.length &&
    sale.lines.every(
      (line, index) =>
        line.productId === cart.lines[index]?.productId &&
        line.qtyMilli === cart.lines[index]?.qtyMilli,
    )
  );
}
