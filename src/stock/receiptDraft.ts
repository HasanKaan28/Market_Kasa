import type { PurchaseInput } from '@/data/purchases';
import type { ProductRecord, ProductUnit } from '@/data/types';
import { formatTRY, parseTRY } from '@/domain/money';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { formatPriceInput, formatQtyInput, parseQuantity } from '@/pos/format';

/** One product of a goods receipt as typed: every box is text until the receipt is saved. */
export type DraftLine = {
  productId: string;
  name: string;
  unit: ProductUnit;
  qty: string;
  buyPrice: string;
  sellPrice: string;
};

export type ReceiptDraft = { lines: DraftLine[]; note: string };

export const EMPTY_DRAFT: ReceiptDraft = { lines: [], note: '' };

const STORAGE_KEY = 'mk2.goodsReceipt';
const ONE = 1000;

/** Adds a product with its prices, or counts it up by one when it is already there (a rescan). */
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
    buyPrice: product.buyPrice > 0 ? formatPriceInput(product.buyPrice) : '',
    sellPrice: formatPriceInput(product.sellPrice),
  };
  return { ...draft, lines: [...draft.lines, line] };
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

/** The lines as the receipt takes them, or a message for each line that cannot be read. */
export function readDraftLines(draft: ReceiptDraft): {
  lines: PurchaseInput['lines'];
  errors: Map<string, string>;
} {
  const errors = new Map<string, string>();
  const lines: PurchaseInput['lines'][number][] = [];
  for (const line of draft.lines) {
    const qtyMilli = parseQuantity(line.qty, line.unit);
    if (qtyMilli === null) {
      const fractional = line.unit === 'piece' && parseQuantity(line.qty, 'kg') !== null;
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

/** An empty box keeps the product's price; otherwise the amount, or what is wrong with it. */
function readPrice(text: string): number | string | undefined {
  if (text.trim() === '') {
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
  return (
    typeof note === 'string' &&
    Array.isArray(lines) &&
    lines.every(
      (line: unknown) =>
        typeof line === 'object' &&
        line !== null &&
        ['productId', 'name', 'qty', 'buyPrice', 'sellPrice'].every(
          (key) => typeof (line as Record<string, unknown>)[key] === 'string',
        ) &&
        ['piece', 'kg'].includes((line as Record<string, unknown>).unit as string),
    )
  );
}
