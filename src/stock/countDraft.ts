import type { CountInput } from '@/data/counts';
import type { ProductRecord, ProductUnit } from '@/data/types';
import { formatQtyInput, parseQuantity } from '@/pos/format';
import { DELETED_PRODUCT_LINE } from './receiptDraft';

/** One product of a shelf count as typed: the counted amount is text until the count is saved. */
export type CountDraftLine = {
  productId: string;
  name: string;
  unit: ProductUnit;
  counted: string;
};

export type CountDraft = { lines: CountDraftLine[]; note: string };

export const EMPTY_COUNT: CountDraft = { lines: [], note: '' };

const STORAGE_KEY = 'mk2.stockCount';
const ONE = 1000;
const ZERO = /^0+(?:[.,]0{1,3})?$/;

type Countable = Pick<ProductRecord, 'id' | 'name' | 'unit'>;

/** Adds a product with nothing counted yet; one already in the count stays as it is. */
export function addToCount(draft: CountDraft, product: Countable): CountDraft {
  if (draft.lines.some((line) => line.productId === product.id)) {
    return draft;
  }
  const line: CountDraftLine = {
    productId: product.id,
    name: product.name,
    unit: product.unit,
    counted: '',
  };
  return { ...draft, lines: [...draft.lines, line] };
}

/** A scan: a piece product is counted up by one; a weighed one is added and waits for its weight. */
export function countProduct(draft: CountDraft, product: Countable): CountDraft {
  const added = addToCount(draft, product);
  if (product.unit !== 'piece') {
    return added;
  }
  return {
    ...added,
    lines: added.lines.map((line) =>
      line.productId === product.id
        ? { ...line, counted: formatQtyInput((readCounted(line.counted, 'piece') ?? 0) + ONE) }
        : line,
    ),
  };
}

/** The count being typed on this device; a draft that cannot be read is dropped. */
export function loadCountDraft(storage?: Pick<Storage, 'getItem'>): CountDraft {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return isCountDraft(parsed) ? parsed : EMPTY_COUNT;
  } catch {
    return EMPTY_COUNT;
  }
}

export function saveCountDraft(draft: CountDraft, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked: the draft lasts for this session only.
  }
}

/** A counted amount, zero included, in the product's unit; `null` when it cannot be read. */
export function readCounted(text: string, unit: ProductUnit): number | null {
  return ZERO.test(text.trim()) ? 0 : parseQuantity(text, unit);
}

/**
 * The lines as the count takes them, read against the products as they are now, or a message
 * for each line that cannot be saved.
 */
export function readCountLines(
  draft: CountDraft,
  products: ReadonlyMap<string, ProductRecord>,
): { lines: CountInput['lines']; errors: Map<string, string> } {
  const errors = new Map<string, string>();
  const lines: CountInput['lines'][number][] = [];
  for (const line of draft.lines) {
    const product = products.get(line.productId);
    if (!product || product.deletedAt) {
      errors.set(line.productId, DELETED_PRODUCT_LINE);
      continue;
    }
    if (line.counted.trim() === '') {
      errors.set(line.productId, 'Sayılan miktarı girin.');
      continue;
    }
    const countedMilli = readCounted(line.counted, product.unit);
    if (countedMilli === null) {
      const fractional = product.unit === 'piece' && parseQuantity(line.counted, 'kg') !== null;
      errors.set(
        line.productId,
        fractional ? 'Adet için tam sayı girin.' : 'Geçerli bir miktar girin.',
      );
      continue;
    }
    lines.push({ productId: line.productId, countedMilli });
  }
  return { lines, errors };
}

function isCountDraft(value: unknown): value is CountDraft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { lines, note } = value as { lines?: unknown; note?: unknown };
  return (
    typeof note === 'string' &&
    Array.isArray(lines) &&
    lines.every((line: unknown) => {
      if (typeof line !== 'object' || line === null) {
        return false;
      }
      const fields = line as Record<string, unknown>;
      return (
        ['productId', 'name', 'counted'].every((key) => typeof fields[key] === 'string') &&
        ['piece', 'kg'].includes(fields.unit as string)
      );
    })
  );
}
