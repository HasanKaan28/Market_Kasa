import Dexie from 'dexie';
import { businessDate } from '@/domain/businessDate';
import { assertSafeInteger, type Kurus } from '@/domain/money';
import { computeCart, type CartTotals } from '@/domain/pricing';
import { formatReceiptNo, nextReceiptSeq } from '@/domain/receipt';
import { customerBalance } from './customers';
import type { MarketDb } from './db';
import { CreditLimitError, RecordNotFoundError, PaymentMismatchError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import { recordStockMovement } from './stock';
import type { LedgerRecord, Payment, ProductRecord, SaleLine, SaleRecord } from './types';

export type SaleLineInput = { productId: string; qtyMilli: number; lineDiscount?: Kurus };

export type RecordSaleInput = {
  /** Pass the cart's id: submitting the same id again returns the stored sale instead of selling twice. */
  id?: string;
  deviceCode: string;
  at: Date;
  cutoffMinutes?: number;
  lines: SaleLineInput[];
  cartDiscount?: Kurus;
  payments: Payment[];
  cashGiven?: Kurus;
  customerId?: string;
  staffId?: string;
  allowOverLimit?: boolean;
};

type PaymentSplit = { cash: Kurus; card: Kurus; credit: Kurus };

const DEFAULT_RECENT = 50;

/**
 * Records a sale in one transaction: a stock movement per line, the credit part on the
 * customer's ledger, then the sale itself (written last, so any failure rolls everything back).
 * Every rule is checked before the first write.
 */
export async function recordSale(db: MarketDb, input: RecordSaleInput): Promise<SaleRecord> {
  const tables = [
    db.sales,
    db.products,
    db.customers,
    db.stockMovements,
    db.stockLevels,
    db.ledger,
    db.outbox,
  ];
  return db.transaction('rw', tables, async () => {
    const alreadyStored = input.id ? await db.sales.get(input.id) : undefined;
    if (alreadyStored) {
      return alreadyStored;
    }
    const products = await loadProducts(db, input.lines);
    const cart = computeCart(
      input.lines.map((line, index) => ({
        qtyMilli: line.qtyMilli,
        unitPrice: productAt(products, index).sellPrice,
        vatRate: productAt(products, index).vatRate,
        lineDiscount: line.lineDiscount,
      })),
      input.cartDiscount ?? 0,
    );
    const split = splitPayments(input.payments, cart.total);
    const change = cashChange(input.cashGiven, split.cash);
    if (split.credit > 0) {
      await assertCreditAllowed(db, input.customerId, split.credit, input.allowOverLimit === true);
    }
    const day = businessDate(input.at, { cutoffMinutes: input.cutoffMinutes });
    const seq = nextReceiptSeq(await highestSeq(db, input.deviceCode, day));
    const sale = buildSale(input, products, cart, { day, seq, change });

    for (const line of sale.lines) {
      await recordStockMovement(db, {
        productId: line.productId,
        delta: -line.qtyMilli,
        kind: 'sale',
        refId: sale.id,
        at: input.at,
        cutoffMinutes: input.cutoffMinutes,
      });
    }
    if (split.credit > 0 && sale.customerId) {
      await addLedgerDebt(db, sale, split.credit, input.at);
    }
    await db.sales.add(sale);
    await appendOutbox(
      db,
      { kind: 'insert', table: 'sales', recordId: sale.id, record: sale },
      input.at,
    );
    return sale;
  });
}

export function recentSales(db: MarketDb, limit: number = DEFAULT_RECENT): Promise<SaleRecord[]> {
  return db.sales.orderBy('occurredAt').reverse().limit(limit).toArray();
}

export function findSaleByReceiptNo(
  db: MarketDb,
  receiptNo: string,
): Promise<SaleRecord | undefined> {
  return db.sales.where('receiptNo').equals(receiptNo).first();
}

async function loadProducts(
  db: MarketDb,
  lines: readonly SaleLineInput[],
): Promise<ProductRecord[]> {
  if (lines.length === 0) {
    throw new RangeError('A sale needs at least one line');
  }
  const products: ProductRecord[] = [];
  for (const line of lines) {
    assertSafeInteger(line.qtyMilli, 'Quantity (thousandths)');
    if (line.qtyMilli <= 0) {
      throw new RangeError(`A sale line needs a positive quantity, got ${line.qtyMilli}`);
    }
    // A product deleted after it entered the cart still sells (DESIGN §7): only a missing one fails.
    const product = await db.products.get(line.productId);
    if (!product) {
      throw new RecordNotFoundError('Product', line.productId);
    }
    products.push(product);
  }
  return products;
}

function productAt(products: readonly ProductRecord[], index: number): ProductRecord {
  const product = products[index];
  if (!product) {
    throw new RangeError(`No product loaded for line ${index}`);
  }
  return product;
}

function splitPayments(payments: readonly Payment[], total: Kurus): PaymentSplit {
  const split: PaymentSplit = { cash: 0, card: 0, credit: 0 };
  for (const payment of payments) {
    assertSafeInteger(payment.amount, 'Payment amount');
    if (payment.amount <= 0) {
      throw new RangeError(`A payment must be positive, got ${payment.amount}`);
    }
    split[payment.method] += payment.amount;
  }
  const paid = split.cash + split.card + split.credit;
  if (paid !== total) {
    throw new PaymentMismatchError(`Payments add up to ${paid}, the sale total is ${total}`);
  }
  return split;
}

function cashChange(cashGiven: Kurus | undefined, cash: Kurus): Kurus {
  if (cashGiven === undefined) {
    return 0;
  }
  assertSafeInteger(cashGiven, 'Cash given');
  if (cashGiven < cash) {
    throw new PaymentMismatchError(`Cash given (${cashGiven}) is less than the cash due (${cash})`);
  }
  return cashGiven - cash;
}

async function assertCreditAllowed(
  db: MarketDb,
  customerId: string | undefined,
  credit: Kurus,
  allowOverLimit: boolean,
): Promise<void> {
  const customer = customerId ? await db.customers.get(customerId) : undefined;
  if (!customer || customer.archivedAt) {
    throw new RecordNotFoundError('Customer', customerId ?? '(none)');
  }
  if (customer.creditLimit === 0 || allowOverLimit) {
    return;
  }
  const balanceAfter = (await customerBalance(db, customer.id)) + credit;
  if (balanceAfter > customer.creditLimit) {
    throw new CreditLimitError(customer.id, customer.creditLimit, balanceAfter);
  }
}

/** The highest sequence this device already used on that business day, or null. */
async function highestSeq(db: MarketDb, deviceCode: string, day: string): Promise<number | null> {
  const last = await db.sales
    .where('[deviceCode+businessDate+seq]')
    .between([deviceCode, day, Dexie.minKey], [deviceCode, day, Dexie.maxKey])
    .last();
  return last?.seq ?? null;
}

function buildSale(
  input: RecordSaleInput,
  products: readonly ProductRecord[],
  cart: CartTotals,
  numbering: { day: string; seq: number; change: Kurus },
): SaleRecord {
  const lines: SaleLine[] = cart.lines.map((totals, index) => {
    const product = productAt(products, index);
    const line = input.lines[index];
    return withoutUndefined({
      productId: product.id,
      name: product.name,
      barcode: product.barcode,
      qtyMilli: line?.qtyMilli ?? 0,
      unitPrice: product.sellPrice,
      vatRate: product.vatRate,
      lineDiscount: totals.lineDiscount,
      cartShare: totals.cartShare,
      net: totals.net,
      vat: totals.vat,
      buyPrice: product.buyPrice,
    });
  });
  return withoutUndefined({
    id: input.id ?? newId(input.at.getTime()),
    receiptNo: formatReceiptNo(input.deviceCode, numbering.day, numbering.seq),
    deviceCode: input.deviceCode,
    seq: numbering.seq,
    businessDate: numbering.day,
    occurredAt: input.at.toISOString(),
    staffId: input.staffId,
    customerId: input.customerId,
    lines,
    subtotal: cart.subtotal,
    cartDiscount: cart.cartDiscount,
    total: cart.total,
    vatTotal: cart.vatTotal,
    vatByRate: cart.vatByRate,
    payments: input.payments,
    cashGiven: input.cashGiven,
    change: numbering.change,
  });
}

async function addLedgerDebt(
  db: MarketDb,
  sale: SaleRecord,
  amount: Kurus,
  at: Date,
): Promise<void> {
  const entry: LedgerRecord = {
    id: newId(at.getTime()),
    customerId: sale.customerId ?? '',
    kind: 'debt',
    amount,
    saleId: sale.id,
    occurredAt: sale.occurredAt,
    businessDate: sale.businessDate,
  };
  await db.ledger.add(entry);
  await appendOutbox(
    db,
    { kind: 'insert', table: 'ledger', recordId: entry.id, record: entry },
    at,
  );
}
