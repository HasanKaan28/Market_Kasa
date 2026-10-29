import Dexie, { type Table } from 'dexie';
import type { MarketDb } from '@/data/db';
import { refundsOf } from '@/data/returns';
import type {
  CategoryRecord,
  PaymentMethod,
  ProductRecord,
  ProductUnit,
  ReturnRecord,
  SaleRecord,
  SaleVoidRecord,
} from '@/data/types';
import { divRoundHalfUp, type Kurus } from '@/domain/money';
import { lineTotal, type VatRate } from '@/domain/pricing';

export type Summary = {
  /** Sales counted: those not voided within the range. */
  salesCount: number;
  voidCount: number;
  /** What the voided sales came to. */
  voidTotal: Kurus;
  /** The voids among them of sales from before the range: their money went back within it. */
  earlierVoidCount: number;
  earlierVoidTotal: Kurus;
  returnCount: number;
  returnTotal: Kurus;
  /** The counted sales' totals, after discounts, VAT included. */
  gross: Kurus;
  /** Line and cart discounts given on the counted sales. */
  discounts: Kurus;
  /** What stayed: gross, less returns and less sales of earlier days voided in the range. */
  net: Kurus;
  /** Money in by how it was paid, less what went back the same way. */
  byMethod: Record<PaymentMethod, Kurus>;
  vatByRate: { rate: VatRate; base: Kurus; vat: Kurus }[];
  /** What the goods sold cost at the buy prices of the day they were sold. */
  cost: Kurus;
  /** Net less cost, VAT included on both sides. */
  grossProfit: Kurus;
  averageBasket: Kurus;
  categories: { categoryId?: string; name: string; net: Kurus; qtyMilli: number }[];
  /** Every product sold, the largest amount first. */
  productsSold: {
    productId: string;
    name: string;
    unit?: ProductUnit;
    qtyMilli: number;
    net: Kurus;
  }[];
  bestSellers: {
    productId: string;
    name: string;
    unit?: ProductUnit;
    qtyMilli: number;
    net: Kurus;
  }[];
  byDevice: { deviceCode: string; salesCount: number; net: Kurus }[];
};

export type SummaryInput = {
  /** Sales, voids and returns of the range: each counts on its own business day and register. */
  sales: readonly SaleRecord[];
  voids: readonly SaleVoidRecord[];
  returns: readonly ReturnRecord[];
  /** Every sale a void or return refers to, those of earlier days included. */
  salesById: ReadonlyMap<string, SaleRecord>;
  products: readonly ProductRecord[];
  categories: readonly CategoryRecord[];
};

const BEST_SELLERS = 10;
const UNCATEGORISED = 'Kategorisiz';
const byName = new Intl.Collator('tr');

/**
 * The figures of a range of business days. A sale voided within the range counts nowhere but in
 * the voids; a sale of an earlier day voided in the range comes off as money given back. A return
 * comes off the way it was refunded, at the VAT rate and buy price of the line it returns.
 */
export function buildSummary({
  sales,
  voids,
  returns,
  salesById,
  products,
  categories,
}: SummaryInput): Summary {
  const inRange = new Set(sales.map((sale) => sale.id));
  const voided = new Set(voids.map((saleVoid) => saleVoid.saleId));
  const byMethod: Record<PaymentMethod, Kurus> = { cash: 0, card: 0, credit: 0 };
  const vat = new Map<VatRate, { base: Kurus; vat: Kurus }>();
  const sold = new Map<
    string,
    { name: string; unit?: ProductUnit; qtyMilli: number; net: Kurus }
  >();
  const devices = new Map<string, { salesCount: number; net: Kurus }>();
  let gross = 0;
  let discounts = 0;
  let cost = 0;
  let net = 0;

  const device = (deviceCode: string) => {
    const found = devices.get(deviceCode) ?? { salesCount: 0, net: 0 };
    devices.set(deviceCode, found);
    return found;
  };
  const addVat = (rate: VatRate, lineNet: Kurus, lineVat: Kurus) => {
    const found = vat.get(rate) ?? { base: 0, vat: 0 };
    vat.set(rate, { base: found.base + lineNet - lineVat, vat: found.vat + lineVat });
  };
  const addSold = (
    productId: string,
    name: string,
    unit: ProductUnit | undefined,
    qty: number,
    amount: Kurus,
  ) => {
    const found = sold.get(productId) ?? { name, ...(unit ? { unit } : {}), qtyMilli: 0, net: 0 };
    sold.set(productId, { ...found, qtyMilli: found.qtyMilli + qty, net: found.net + amount });
  };
  const addSale = (sale: SaleRecord, sign: 1 | -1) => {
    for (const payment of sale.payments) {
      byMethod[payment.method] += sign * payment.amount;
    }
    for (const line of sale.lines) {
      addVat(line.vatRate, sign * line.net, sign * line.vat);
      cost += sign * lineTotal(line.qtyMilli, line.buyPrice);
      addSold(line.productId, line.name, line.unit, sign * line.qtyMilli, sign * line.net);
    }
  };

  let salesCount = 0;
  for (const sale of sales) {
    if (voided.has(sale.id)) {
      continue;
    }
    salesCount += 1;
    gross += sale.total;
    net += sale.total;
    discounts += sale.cartDiscount + sale.lines.reduce((sum, line) => sum + line.lineDiscount, 0);
    addSale(sale, 1);
    const register = device(sale.deviceCode);
    register.salesCount += 1;
    register.net += sale.total;
  }

  let voidTotal = 0;
  let earlierVoidCount = 0;
  let earlierVoidTotal = 0;
  for (const saleVoid of voids) {
    const sale = salesById.get(saleVoid.saleId);
    if (!sale) {
      continue;
    }
    voidTotal += sale.total;
    // A sale of an earlier day: its money goes back now.
    if (!inRange.has(sale.id)) {
      earlierVoidCount += 1;
      earlierVoidTotal += sale.total;
      addSale(sale, -1);
      net -= sale.total;
      device(saleVoid.deviceCode).net -= sale.total;
    }
  }

  let returnCount = 0;
  let returnTotal = 0;
  for (const saleReturn of returns) {
    // A return of a sale voided in the range is part of that void.
    if (voided.has(saleReturn.saleId)) {
      continue;
    }
    const sale = salesById.get(saleReturn.saleId);
    returnCount += 1;
    returnTotal += saleReturn.amount;
    net -= saleReturn.amount;
    device(saleReturn.deviceCode).net -= saleReturn.amount;
    for (const refund of refundsOf([saleReturn])) {
      byMethod[refund.method] -= refund.amount;
    }
    for (const line of saleReturn.lines) {
      const saleLine = sale?.lines.find((candidate) => candidate.productId === line.productId);
      if (saleLine) {
        addVat(saleLine.vatRate, -line.net, -line.vat);
        cost -= lineTotal(line.qtyMilli, saleLine.buyPrice);
      }
      addSold(line.productId, line.name, saleLine?.unit, -line.qtyMilli, -line.net);
    }
  }

  const productCategory = new Map(products.map((product) => [product.id, product.categoryId]));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const groups = new Map<
    string,
    { categoryId?: string; name: string; net: Kurus; qtyMilli: number }
  >();
  const rows = [...sold].filter(([, row]) => row.qtyMilli !== 0 || row.net !== 0);
  for (const [productId, row] of rows) {
    const categoryId = productCategory.get(productId);
    const name = (categoryId && categoryName.get(categoryId)) || UNCATEGORISED;
    const key = categoryId && categoryName.has(categoryId) ? categoryId : '';
    const found = groups.get(key) ?? {
      ...(key ? { categoryId: key } : {}),
      name,
      net: 0,
      qtyMilli: 0,
    };
    groups.set(key, {
      ...found,
      net: found.net + row.net,
      qtyMilli: found.qtyMilli + row.qtyMilli,
    });
  }

  const productsSold = rows.map(([productId, row]) => ({ productId, ...row })).sort(byAmount);

  return {
    salesCount,
    voidCount: voids.filter((saleVoid) => salesById.has(saleVoid.saleId)).length,
    voidTotal,
    earlierVoidCount,
    earlierVoidTotal,
    returnCount,
    returnTotal,
    gross,
    discounts,
    net,
    byMethod,
    vatByRate: [...vat]
      .filter(([, amounts]) => amounts.base !== 0 || amounts.vat !== 0)
      .sort(([a], [b]) => a - b)
      .map(([rate, amounts]) => ({ rate, ...amounts })),
    cost,
    grossProfit: net - cost,
    averageBasket: salesCount === 0 ? 0 : divRoundHalfUp(gross, salesCount),
    categories: [...groups.values()].sort(byAmount),
    productsSold,
    bestSellers: productsSold.slice(0, BEST_SELLERS),
    byDevice: [...devices]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([deviceCode, totals]) => ({ deviceCode, ...totals })),
  };
}

/** Which records a summary reads: a span of business days or of time, of one register or all. */
export type SummaryRange = {
  /** `businessDate` for days (YYYY-MM-DD), `occurredAt` for instants (ISO). */
  index: 'businessDate' | 'occurredAt';
  from: string;
  to: string;
  /** False leaves out the records at `from` itself: a span that starts where the last one ended. */
  includeFrom?: boolean;
  deviceCode?: string;
};

/** The sales, voids and returns of a range, with every sale they refer to. */
export async function loadRange(
  db: MarketDb,
  { index, from, to, includeFrom = true, deviceCode }: SummaryRange,
): Promise<Pick<SummaryInput, 'sales' | 'voids' | 'returns' | 'salesById'>> {
  const read = <T extends { deviceCode: string }>(table: Table<T, string>) =>
    table
      .where(index)
      .between(from, to, includeFrom, true)
      .filter((record) => deviceCode === undefined || record.deviceCode === deviceCode)
      .toArray();
  const [sales, voids, returns] = await Promise.all([
    read(db.sales),
    read(db.saleVoids),
    read(db.returns),
  ]);
  const known = new Set(sales.map((sale) => sale.id));
  const referenced = [
    ...new Set(
      [...voids, ...returns].map((record) => record.saleId).filter((id) => !known.has(id)),
    ),
  ];
  const earlier = await db.sales.bulkGet(referenced);
  const salesById = new Map(
    [...sales, ...earlier.flatMap((sale) => (sale ? [sale] : []))].map((sale) => [sale.id, sale]),
  );
  return { sales, voids, returns, salesById };
}

/** The summary of the business days `from`–`to` (YYYY-MM-DD), of one register or all. */
export async function loadSummary(
  db: MarketDb,
  { from, to, deviceCode }: { from: string; to: string; deviceCode?: string },
): Promise<Summary> {
  const [records, products, categories] = await Promise.all([
    loadRange(db, { index: 'businessDate', from, to, ...(deviceCode ? { deviceCode } : {}) }),
    db.products.toArray(),
    db.categories.toArray(),
  ]);
  return buildSummary({ ...records, products, categories });
}

/** Every register that has rung up a sale, in order: one index step per register, not per sale. */
export async function reportRegisters(db: MarketDb): Promise<string[]> {
  const index = '[deviceCode+businessDate+seq]';
  const codes: string[] = [];
  let next = await db.sales.orderBy(index).first();
  while (next) {
    codes.push(next.deviceCode);
    // Past every day of this register. One bound only: a key that holds the same array twice
    // is refused as a cycle.
    next = await db.sales.where(index).above([next.deviceCode, Dexie.maxKey]).first();
  }
  return codes;
}

function byAmount(
  a: { name: string; net: Kurus; qtyMilli: number },
  b: { name: string; net: Kurus; qtyMilli: number },
): number {
  return b.net - a.net || b.qtyMilli - a.qtyMilli || byName.compare(a.name, b.name);
}
