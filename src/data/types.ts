import type { LedgerKind } from '@/domain/ledger';
import type { Kurus } from '@/domain/money';
import type { Permission, Role } from '@/domain/permissions';
import type { VatRate } from '@/domain/pricing';
import type { Summary } from '@/reports/summary';

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
  /** Absent on sales recorded before lines kept their unit; those count as pieces. */
  unit?: ProductUnit;
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
  /** Why a manual adjustment was made: its reason, and the note typed with it. */
  note?: string;
  occurredAt: string;
  businessDate: string;
};

export type StockLevelRecord = { productId: string; qtyMilli: number };

export type PurchaseLine = {
  productId: string;
  name: string;
  unit: ProductUnit;
  qtyMilli: number;
  buyPrice: Kurus;
  cost: Kurus;
  /** Came free: no cost, and the product keeps its buy price. */
  free?: boolean;
};

/** How a delivery was paid: on the spot, or owed to the supplier (its ledger gets the invoice). */
export type PurchasePayment = 'cash' | 'card' | 'on_account';

/** Goods received in one go; each line's stock movement carries its id. */
export type PurchaseRecord = {
  id: string;
  deviceCode: string;
  lines: PurchaseLine[];
  total: Kurus;
  supplierId?: string;
  invoiceNo?: string;
  /** Cash when absent: receipts written before the payment was kept. */
  payment?: PurchasePayment;
  note?: string;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  occurredAt: string;
  businessDate: string;
};

export type CountLine = {
  productId: string;
  name: string;
  unit: ProductUnit;
  /** The stock this device held when the count was saved; the count moves it to `countedMilli`. */
  expectedMilli: number;
  /**
   * What the movements stamped up to the count added up to. A movement stamped later (a fast
   * clock elsewhere) is left out, so only a late movement stamped before the count changes it.
   */
  knownBeforeMilli: number;
  countedMilli: number;
};

/** A shelf count; each line whose count differs moves the stock by a `count` movement with its id. */
export type StockCountRecord = {
  id: string;
  deviceCode: string;
  lines: CountLine[];
  note?: string;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  occurredAt: string;
  businessDate: string;
};

/** How a customer paid: credit itself is never a way to pay credit. */
export type LedgerMethod = 'cash' | 'card';

export type SupplierRecord = {
  id: string;
  name: string;
  phone?: string;
  /** Digits only. */
  taxNo?: string;
  taxOffice?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

/** A person who works the register; the PIN is kept only as its PBKDF2 hash (DESIGN §8.3). */
export type StaffRecord = {
  id: string;
  name: string;
  role: Role;
  /** Turned on or off for this person, over the role's defaults. */
  permissions?: Partial<Record<Permission, boolean>>;
  pinHash: string;
  pinSalt: string;
  pinIterations: number;
  createdAt: string;
  updatedAt: string;
  /** Set when the person no longer works here: they cannot sign in. */
  archivedAt?: string;
};

export type SupplierPaymentMethod = 'cash' | 'bank' | 'card' | 'cheque';

/** What the market owes a supplier: invoices positive, payments negative, adjustments either way. */
export type SupplierLedgerRecord = {
  id: string;
  supplierId: string;
  kind: 'invoice' | 'payment' | 'adjustment';
  amount: Kurus;
  /** How a payment was made. */
  method?: SupplierPaymentMethod;
  /** The goods receipt an invoice is for. */
  purchaseId?: string;
  note?: string;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  occurredAt: string;
  businessDate: string;
};

export type LedgerRecord = {
  id: string;
  customerId: string;
  kind: LedgerKind;
  amount: Kurus;
  /** How a payment was made. */
  method?: LedgerMethod;
  saleId?: string;
  note?: string;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  occurredAt: string;
  businessDate: string;
};

/** A sale cancelled in full; its stock and credit are put back by separate movements. */
export type SaleVoidRecord = {
  id: string;
  saleId: string;
  reason: string;
  deviceCode: string;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
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
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  occurredAt: string;
  businessDate: string;
};

/** Where a drawer's cash came from and went over a session. */
export type CashBreakdown = {
  /** The cash part of the register's sales. */
  sales: Kurus;
  /** The cash part of the sales voided on the register, those of earlier days included. */
  voids: Kurus;
  /** Cash given back for returns on the register. */
  refunds: Kurus;
  movementsIn: Kurus;
  movementsOut: Kurus;
};

/** Cash put into or taken out of a drawer, by hand or by a collection or payment made from it. */
export type CashMovementRecord = {
  id: string;
  deviceCode: string;
  /** The drawer session it happened in; absent when the drawer was not open. */
  sessionId?: string;
  kind: 'in' | 'out';
  /** Above zero; `kind` says which way it went. */
  amount: Kurus;
  reason: string;
  /** The ledger entry or goods receipt that moved the cash; absent when entered by hand. */
  refId?: string;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  occurredAt: string;
  businessDate: string;
};

/** The Z record: a drawer closed at the end of the day, written once and never changed. */
export type CashSessionRecord = {
  id: string;
  deviceCode: string;
  /** When the drawer was opened; absent when it was closed without being opened. */
  openedAt?: string;
  openingCash: Kurus;
  closedAt: string;
  cash: CashBreakdown;
  expectedCash: Kurus;
  countedCash: Kurus;
  /** Counted less expected: below zero is cash missing from the drawer. */
  difference: Kurus;
  /** The register's sales over the session; every product sold is left to the reports. */
  summary: Omit<Summary, 'productsSold'>;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  businessDate: string;
};

/** The market-wide settings, one record with the id "market". */
export type MarketSettingsRecord = {
  id: 'market';
  /** Minutes after midnight the business day turns, 0 to 720. */
  cutoffMinutes: number;
  createdAt: string;
  updatedAt: string;
};

export type AuditAction =
  | 'staff.create'
  | 'staff.update'
  | 'staff.pin'
  | 'staff.archive'
  | 'staff.restore'
  | 'settings.update'
  | 'product.price'
  | 'approval';

/** One management action: who did it, on which record, and what changed (DESIGN §6.3). */
export type AuditRecord = {
  id: string;
  deviceCode: string;
  /** Who did it; absent when no staff are set up. */
  staffId?: string;
  action: AuditAction;
  entity: 'staff' | 'settings' | 'product' | 'approval';
  entityId?: string;
  /** The changed fields as they were; never a PIN or its hash. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
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
  | 'returns'
  | 'purchases'
  | 'stockCounts'
  | 'suppliers'
  | 'supplierLedger'
  | 'cashMovements'
  | 'cashSessions'
  | 'staff'
  | 'settings'
  | 'auditLog';

export type OutboxOp =
  | { kind: 'insert'; table: OutboxTable; recordId: string; record: object }
  | {
      kind: 'patch';
      table: 'products' | 'customers' | 'categories' | 'suppliers' | 'staff' | 'settings';
      recordId: string;
      patch: object;
    };

/** `opId` is unique per operation, so the server can skip a retry it already applied. */
export type OutboxItem = OutboxOp & { seq?: number; opId: string; createdAt: string };

export type MetaRecord = { key: string; value: unknown };
