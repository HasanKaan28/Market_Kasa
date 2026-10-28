import Dexie, { type Table } from 'dexie';
import type {
  CustomerRecord,
  LedgerRecord,
  OutboxItem,
  ProductRecord,
  SaleRecord,
  StockLevelRecord,
  StockMovementRecord,
} from './types';

const MARKET_ID = /^[a-z0-9-]{1,64}$/;

export class MarketDb extends Dexie {
  declare products: Table<ProductRecord, string>;
  declare customers: Table<CustomerRecord, string>;
  declare sales: Table<SaleRecord, string>;
  declare stockMovements: Table<StockMovementRecord, string>;
  declare stockLevels: Table<StockLevelRecord, string>;
  declare ledger: Table<LedgerRecord, string>;
  declare outbox: Table<OutboxItem, number>;

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
  }
}

/** One database per market, named apart from v1's "MarketPosDB" so v1 data is never touched. */
export function openMarketDb(marketId: string): MarketDb {
  if (!MARKET_ID.test(marketId)) {
    throw new RangeError(`Market id must match ${MARKET_ID}, got "${marketId}"`);
  }
  return new MarketDb(`mk2-${marketId}`);
}
