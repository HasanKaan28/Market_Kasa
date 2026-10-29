import Dexie, { type Table } from 'dexie';
import type {
  CashMovementRecord,
  CashSessionRecord,
  CategoryRecord,
  CustomerRecord,
  PurchaseRecord,
  LedgerRecord,
  MetaRecord,
  OutboxItem,
  ProductRecord,
  ReturnRecord,
  SaleRecord,
  SaleVoidRecord,
  StockCountRecord,
  StockLevelRecord,
  StockMovementRecord,
  SupplierLedgerRecord,
  SupplierRecord,
} from './types';

export const MARKET_ID = /^[a-z0-9-]{1,64}$/;

export class MarketDb extends Dexie {
  declare products: Table<ProductRecord, string>;
  declare customers: Table<CustomerRecord, string>;
  declare sales: Table<SaleRecord, string>;
  declare stockMovements: Table<StockMovementRecord, string>;
  declare stockLevels: Table<StockLevelRecord, string>;
  declare ledger: Table<LedgerRecord, string>;
  declare outbox: Table<OutboxItem, number>;
  declare meta: Table<MetaRecord, string>;
  declare saleVoids: Table<SaleVoidRecord, string>;
  declare returns: Table<ReturnRecord, string>;
  declare categories: Table<CategoryRecord, string>;
  declare purchases: Table<PurchaseRecord, string>;
  declare stockCounts: Table<StockCountRecord, string>;
  declare suppliers: Table<SupplierRecord, string>;
  declare supplierLedger: Table<SupplierLedgerRecord, string>;
  declare cashSessions: Table<CashSessionRecord, string>;
  declare cashMovements: Table<CashMovementRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      products: 'id, &barcode, name, isQuick, updatedAt',
      customers: 'id, name, phone, updatedAt',
      sales: 'id, &receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId',
      stockMovements: 'id, productId',
      stockLevels: 'productId',
      ledger: 'id, customerId',
      outbox: '++seq',
    });
    // v2: the sync cursor lives in `meta`; `isQuick` loses its index because IndexedDB
    // cannot use booleans as keys.
    this.version(2).stores({
      meta: 'key',
      products: 'id, &barcode, name, updatedAt',
    });
    // v3: receipt numbers are no longer unique here. Two registers set to the same device
    // code both number their sales from 0001, and the server keeps both; refusing the second
    // would stop every later pull. Unique device codes are the server's job (M6).
    this.version(3).stores({
      sales: 'id, receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId',
    });
    // v4: voids and returns (M2b).
    this.version(4).stores({ saleVoids: 'id, saleId', returns: 'id, saleId' });
    // v5: barcodes are stored in capitals (M3a). No server holds these rows yet; it upper-cases
    // what it receives on its own (M0b).
    this.version(5)
      .stores({})
      .upgrade((tx) => upperCaseBarcodes(tx.table('products')));
    // v6: product categories (M3a).
    this.version(6).stores({ categories: 'id, updatedAt' });
    // v7: goods receipts (M3c).
    this.version(7).stores({ purchases: 'id, occurredAt' });
    // v8: shelf counts (M3d), and a product's movements read by time.
    this.version(8).stores({
      stockCounts: 'id, occurredAt',
      stockMovements: 'id, productId, [productId+occurredAt]',
    });
    // v9: suppliers and what is owed to them (M4b).
    this.version(9).stores({
      suppliers: 'id, name, updatedAt',
      supplierLedger: 'id, supplierId, occurredAt',
    });
    // v10: cash drawer sessions and movements (M5), read per register by time; sales, voids and
    // returns read by business day for the reports and by time for the Z report.
    this.version(10).stores({
      sales: 'id, receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId, businessDate',
      saleVoids: 'id, saleId, businessDate, occurredAt',
      returns: 'id, saleId, businessDate, occurredAt',
      cashSessions: 'id, [deviceCode+closedAt], closedAt',
      cashMovements: 'id, [deviceCode+occurredAt], occurredAt',
    });
  }
}

/**
 * Where two products differ only in the case of their barcode, the older one keeps it and the
 * other loses it. The losers are cleared first, so the unique index never sees two holders.
 */
async function upperCaseBarcodes(products: Table<ProductRecord, string>): Promise<void> {
  const holders = (await products.toArray())
    .filter((product): product is ProductRecord & { barcode: string } => !!product.barcode)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const claimed = new Set<string>();
  const renamed: ProductRecord[] = [];
  const losers: ProductRecord[] = [];
  for (const product of holders) {
    const barcode = product.barcode.toUpperCase();
    if (claimed.has(barcode)) {
      losers.push(product);
    } else {
      claimed.add(barcode);
      if (barcode !== product.barcode) {
        renamed.push({ ...product, barcode });
      }
    }
  }
  for (const loser of losers) {
    const cleared = { ...loser };
    delete cleared.barcode;
    await products.put(cleared);
  }
  await products.bulkPut(renamed);
}

/** One database per market, named apart from v1's "MarketPosDB" so v1 data is never touched. */
export function openMarketDb(marketId: string): MarketDb {
  if (!MARKET_ID.test(marketId)) {
    throw new RangeError(`Market id must match ${MARKET_ID}, got "${marketId}"`);
  }
  return new MarketDb(`mk2-${marketId}`);
}
