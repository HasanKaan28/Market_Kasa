import { createCustomer } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { addLedgerEntry } from '@/data/ledger';
import { normalizeForSearch } from '@/data/text';
import type { Kurus } from '@/domain/money';
import { formatPriceInput } from '@/pos/format';

/** The parts of v1's "Yedek İndir (JSON)" file that v2 brings over; v1 typed none of it. */
export type V1Backup = {
  products: Record<string, unknown>[];
  customers: Record<string, unknown>[];
};

export type V1CustomerPlan = {
  name: string;
  phone?: string;
  creditLimit: Kurus;
  /** What the customer owed in v1; below zero when v1 owed them. */
  balance: Kurus;
  /**
   * `merged`: the same name and phone earlier in the file, whose debt this one is added to.
   * `imported`: brought over from v1 before. `exists`: typed into v2 by hand; its v1 debt is not
   * added on top, and the preview says how much is left out.
   */
  action: 'create' | 'merged' | 'imported' | 'exists' | 'error';
  error?: string;
};

export type V1CustomerActor = { staffId?: string; cutoffMinutes?: number };

const PRODUCT_HEADERS = [
  'Barkod',
  'Ürün adı',
  'Kategori',
  'Birim',
  'Satış fiyatı',
  'Alış fiyatı',
  'KDV',
  'Stok',
  'Hızlı ürün',
];
// v1 made up a code for products without a barcode; it is no barcode.
const MADE_UP_BARCODE = /^BRK-/i;
const OPENING_NOTE = "v1'den devreden borç";

/** A v1 backup, or null for any other text, so a CSV with the same picker is read as before. */
export function readV1Backup(text: string): V1Backup | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }
  const { products, customers } = data as Record<string, unknown>;
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        )
      : undefined;
  const productList = products === undefined ? [] : list(products);
  const customerList = customers === undefined ? [] : list(customers);
  if (!productList || !customerList || (products === undefined && customers === undefined)) {
    return null;
  }
  return { products: productList, customers: customerList };
}

/**
 * v1's products as a table the product import reads like any file, headers first: the same
 * preview, checks and writing. A made-up `BRK-` code is left out and a price is written the
 * Turkish way.
 */
export function v1ProductTable(backup: V1Backup): string[][] {
  return [
    PRODUCT_HEADERS,
    ...backup.products.map((product) => {
      const barcode = text(product.barcode);
      return [
        MADE_UP_BARCODE.test(barcode) ? '' : barcode,
        text(product.name),
        text(product.category),
        text(product.unit),
        price(product.price),
        price(product.buyPrice),
        text(product.taxRate),
        quantity(product.stock),
        product.isQuick === true ? 'evet' : product.isQuick === false ? 'hayır' : '',
      ];
    }),
  ];
}

/**
 * What bringing v1's customers over would do, without writing anything: who is new, who is here
 * already (same name and phone in v2), whose debt joins an earlier row of the file, and who
 * cannot be brought.
 */
export async function planV1Customers(db: MarketDb, backup: V1Backup): Promise<V1CustomerPlan[]> {
  const [customers, openings] = await Promise.all([
    db.customers.toArray(),
    db.ledger.filter((entry) => entry.note === OPENING_NOTE).toArray(),
  ]);
  const imported = new Set(openings.map((entry) => entry.customerId));
  const here = new Map(
    customers.map(
      (c) => [identity(c.name, c.phone), imported.has(c.id) ? 'imported' : 'exists'] as const,
    ),
  );
  // The row each customer is created from, so a later duplicate's debt is added to it.
  const first = new Map<string, V1CustomerPlan>();
  return backup.customers.map((customer): V1CustomerPlan => {
    const name = text(customer.name).trim();
    const phone = text(customer.phone).replace(/\D/g, '') || undefined;
    const balance = kurus(customer.balance) ?? 0;
    const limit = kurus(customer.limit);
    const creditLimit = limit !== undefined && limit >= 0 ? limit : 0;
    const row = { name, ...(phone ? { phone } : {}), creditLimit, balance };
    if (name === '') {
      return { ...row, action: 'error', error: 'Adı yok.' };
    }
    const key = identity(name, phone);
    const earlier = first.get(key);
    if (earlier) {
      earlier.balance += balance;
      return { ...row, action: 'merged' };
    }
    const plan: V1CustomerPlan = { ...row, action: here.get(key) ?? 'create' };
    first.set(key, plan);
    return plan;
  });
}

/**
 * Writes the new customers of a plan, each with what they owed as one opening adjustment, in one
 * transaction: all of them or none. The rest are skipped.
 */
export async function applyV1Customers(
  db: MarketDb,
  plan: readonly V1CustomerPlan[],
  at: Date,
  actor?: V1CustomerActor,
): Promise<{ created: number; skipped: number }> {
  const toCreate = plan.filter((row) => row.action === 'create');
  await db.transaction('rw', db.customers, db.ledger, db.outbox, async () => {
    for (const row of toCreate) {
      const customer = await createCustomer(
        db,
        { name: row.name, phone: row.phone, creditLimit: row.creditLimit },
        at,
      );
      if (row.balance !== 0) {
        await addLedgerEntry(
          db,
          {
            customerId: customer.id,
            kind: 'adjustment',
            amount: row.balance,
            note: OPENING_NOTE,
            staffId: actor?.staffId,
            cutoffMinutes: actor?.cutoffMinutes,
          },
          at,
        );
      }
    }
  });
  return { created: toCreate.length, skipped: plan.length - toCreate.length };
}

function identity(name: string, phone: string | undefined): string {
  return `${normalizeForSearch(name)}|${(phone ?? '').replace(/\D/g, '')}`;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** v1 kept lira as a float, sometimes as text; an amount that does not read is absent. */
function kurus(value: unknown): Kurus | undefined {
  const amount = typeof value === 'number' ? value : Number(text(value).replace(',', '.'));
  return text(value).trim() !== '' && Number.isFinite(amount)
    ? Math.round(amount * 100)
    : undefined;
}

function price(value: unknown): string {
  const amount = kurus(value);
  return amount === undefined ? '' : formatPriceInput(amount);
}

function quantity(value: unknown): string {
  const amount = kurus(value) === undefined ? undefined : Number(text(value).replace(',', '.'));
  if (amount === undefined) {
    return '';
  }
  return String(Math.round(amount * 1000) / 1000).replace('.', ',');
}
