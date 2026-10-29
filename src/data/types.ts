import type { LedgerKind } from '@/domain/ledger';
import type { Kurus } from '@/domain/money';
import type { VatRate } from '@/domain/pricing';

export type ProductUnit = 'piece' | 'kg';

export type ProductRecord = {
  id: string;
  barcode?: string;
  name: string;
  categoryId?: string;
  unit: ProductUnit;
  sellPrice: Kurus;
  buyPrice: Kurus;
  vatRate: VatRate;
  isQuick: boolean;
  criticalLevelMilli: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

/** A group of products; `sort` orders the group buttons at the register. */
export type CategoryRecord = {
  id: string;
  name: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

/** `creditLimit` 0 means no limit. */
export type CustomerRecord = {
  id: string;
  name: string;
  phone?: string;
  creditLimit: Kurus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type PaymentMethod = 'cash' | 'card' | 'credit';

export type Payment = { method: PaymentMethod; amount: Kurus };

export type SaleLine = {
  productId: string;
  name: string;
  barcode?: string;
  qtyMilli: number;
  unitPrice: Kurus;
  vatRate: VatRate;
  lineDiscount: Kurus;
  cartShare: Kurus;
  net: Kurus;
  vat: Kurus;
  buyPrice: Kurus;
};

export type SaleRecord = {
  id: string;
  receiptNo: string;
  deviceCode: string;
  seq: number;
  businessDate: string;
  occurredAt: string;
  staffId?: string;
  customerId?: string;
  lines: SaleLine[];
  subtotal: Kurus;
  cartDiscount: Kurus;
  total: Kurus;
  vatTotal: Kurus;
  vatByRate: Partial<Record<VatRate, Kurus>>;
  payments: Payment[];
  cashGiven?: Kurus;
  change: Kurus;
};

export type StockMovementKind = 'sale' | 'return' | 'void' | 'purchase' | 'count' | 'manual';

export type StockMovementRecord = {
  id: string;
  productId: string;
  delta: number;
  kind: StockMovementKind;
  refId?: string;
  occurredAt: string;
  businessDate: string;
};

export type StockLevelRecord = { productId: string; qtyMilli: number };

export type LedgerRecord = {
  id: string;
  customerId: string;
  kind: LedgerKind;
  amount: Kurus;
  saleId?: string;
  note?: string;
  occurredAt: string;
  businessDate: string;
};

/** A sale cancelled in full; its stock and credit are put back by separate movements. */
export type SaleVoidRecord = {
  id: string;
  saleId: string;
  reason: string;
  deviceCode: string;
  occurredAt: string;
  businessDate: string;
};

export type ReturnLine = {
  productId: string;
  name: string;
  qtyMilli: number;
  net: Kurus;
  vat: Kurus;
};

/**
 * Goods taken back against a receipt; `amount` and `vat` are the line shares added up, and
 * `refunds` says how that amount went back (the way the sale was paid, debt first).
 */
export type ReturnRecord = {
  id: string;
  saleId: string;
  deviceCode: string;
  lines: ReturnLine[];
  refunds: Payment[];
  amount: Kurus;
  vat: Kurus;
  occurredAt: string;
  businessDate: string;
};

export type OutboxTable =
  | 'products'
  | 'customers'
  | 'categories'
  | 'sales'
  | 'stockMovements'
  | 'ledger'
  | 'saleVoids'
  | 'returns';

export type OutboxOp =
  | { kind: 'insert'; table: OutboxTable; recordId: string; record: object }
  | {
      kind: 'patch';
      table: 'products' | 'customers' | 'categories';
      recordId: string;
      patch: object;
    };

/** `opId` is unique per operation, so the server can skip a retry it already applied. */
export type OutboxItem = OutboxOp & { seq?: number; opId: string; createdAt: string };

export type MetaRecord = { key: string; value: unknown };
