import type { PurchaseInput } from '@/data/purchases';
import type { ProductRecord, ProductUnit } from '@/data/types';
import { formatTRY, parseTRY } from '@/domain/money';
import { lineTotal, MAX_UNIT_PRICE } from '@/domain/pricing';
import { formatPriceInput, formatQtyInput, parseQuantity } from '@/pos/format';

type PriceField = 'buyPrice' | 'sellPrice';

/**
 * One product of a goods receipt as typed: every box is text until the receipt is saved. A price
 * box nobody typed in has no text: it shows, and keeps, the price the product has at the time,
 * so a price changed elsewhere after the line was added is not undone by saving the receipt.
 * `name` and `unit` are the product's when it was added, shown until it is read again.
 */
export type DraftLine = {
  productId: string;
  name: string;
  unit: ProductUnit;
  qty: string;
  buyPrice?: string;
  sellPrice?: string;
};

export type ReceiptDraft = { lines: DraftLine[]; note: string };

export const EMPTY_DRAFT: ReceiptDraft = { lines: [], note: '' };

export const DELETED_PRODUCT_LINE = 'Bu ürün silinmiş; satırı çıkarın.';

const STORAGE_KEY = 'mk2.goodsReceipt';
const ONE = 1000;

/** Adds a product, or counts it up by one when it is already there (a rescan). */
export function addProduct(draft: ReceiptDraft, product: ProductRecord): ReceiptDraft {
  if (draft.lines.some((line) => line.productId === product.id)) {
    return {
      ...draft,
      lines: draft.lines.map((line) =>
        line.productId === product.id
          ? { ...line, qty: formatQtyInput((parseQuantity(line.qty, line.unit) ?? 0) + ONE) }
          : line,
      ),
    };
  }
  const line: DraftLine = {
    productId: product.id,
    name: product.name,
    unit: product.unit,
    qty: '1',
  };
  return { ...draft, lines: [...draft.lines, line] };
}

/** A price box's text: what was typed, else the product's price now (no buy price is empty). */
export function shownPrice(
  line: DraftLine,
  product: ProductRecord | undefined,
  field: PriceField,
): string {
  const typed = line[field];
  if (typed !== undefined) {
    return typed;
  }
  if (!product || (field === 'buyPrice' && product.buyPrice === 0)) {
    return '';
  }
  return formatPriceInput(product[field]);
}

/** A line's cost at the buy price it will be saved with; nothing while it cannot be read. */
export function draftLineCost(
  line: DraftLine,
  product: ProductRecord | undefined,
): number | undefined {
  if (!product) {
    return undefined;
  }
  const qtyMilli = parseQuantity(line.qty, product.unit);
  const buyPrice = readPrice(line.buyPrice);
  if (qtyMilli === null || typeof buyPrice === 'string') {
    return undefined;
  }
  return lineTotal(qtyMilli, buyPrice ?? product.buyPrice);
}

/** The receipt being typed on this device; a draft that cannot be read is dropped. */
export function loadDraft(storage?: Pick<Storage, 'getItem'>): ReceiptDraft {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return isDraft(parsed) ? parsed : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: ReceiptDraft, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked: the draft lasts for this session only.
  }
}

/**
 * The lines as the receipt takes them, read against the products as they are now, or a message
 * for each line that cannot be saved: its product is gone, or its quantity no longer fits the
 * product's unit. Only typed prices are sent.
 */
export function readDraftLines(
  draft: ReceiptDraft,
  products: ReadonlyMap<string, ProductRecord>,
): {
  lines: PurchaseInput['lines'];
  errors: Map<string, string>;
} {
  const errors = new Map<string, string>();
  const lines: PurchaseInput['lines'][number][] = [];
  for (const line of draft.lines) {
    const product = products.get(line.productId);
    if (!product || product.deletedAt) {
      errors.set(line.productId, DELETED_PRODUCT_LINE);
      continue;
    }
    const qtyMilli = parseQuantity(line.qty, product.unit);
    if (qtyMilli === null) {
      const fractional = product.unit === 'piece' && parseQuantity(line.qty, 'kg') !== null;
      errors.set(
        line.productId,
        fractional ? 'Adet için tam sayı girin.' : 'Geçerli bir miktar girin.',
      );
      continue;
    }
    const buyPrice = readPrice(line.buyPrice);
    const sellPrice = readPrice(line.sellPrice);
    const priceError = [buyPrice, sellPrice].find((price) => typeof price === 'string');
    if (typeof priceError === 'string') {
      errors.set(line.productId, priceError);
      continue;
    }
    lines.push({
      productId: line.productId,
      qtyMilli,
      ...(typeof buyPrice === 'number' ? { buyPrice } : {}),
      ...(typeof sellPrice === 'number' ? { sellPrice } : {}),
    });
  }
  return { lines, errors };
}

/** No text, or only spaces, keeps the product's price; otherwise the amount, or what is wrong. */
function readPrice(text: string | undefined): number | string | undefined {
  if (text === undefined || text.trim() === '') {
    return undefined;
  }
  let price: number;
  try {
    price = parseTRY(text);
  } catch {
    return 'Geçerli bir tutar girin.';
  }
  return price > MAX_UNIT_PRICE ? `Fiyat en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.` : price;
}

function isDraft(value: unknown): value is ReceiptDraft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { lines, note } = value as { lines?: unknown; note?: unknown };
  return typeof note === 'string' && Array.isArray(lines) && lines.every(isDraftLine);
}

function isDraftLine(line: unknown): boolean {
  if (typeof line !== 'object' || line === null) {
    return false;
  }
  const fields = line as Record<string, unknown>;
  return (
    ['productId', 'name', 'qty'].every((key) => typeof fields[key] === 'string') &&
    ['buyPrice', 'sellPrice'].every(
      (key) => fields[key] === undefined || typeof fields[key] === 'string',
    ) &&
    ['piece', 'kg'].includes(fields.unit as string)
  );
}
