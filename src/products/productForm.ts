import { canonicalBarcode, type NewProduct } from '@/data/products';
import type { ProductRecord, ProductUnit } from '@/data/types';
import type { ChoiceOption } from '@/design';
import { formatTRY, parseTRY, type Kurus } from '@/domain/money';
import { MAX_UNIT_PRICE, type VatRate } from '@/domain/pricing';
import { formatPriceInput, formatQtyInput, parseQuantity } from '@/pos/format';

/** The product form as typed: every box is text until it is read. */
export type ProductDraft = {
  barcode: string;
  name: string;
  categoryId: string;
  unit: ProductUnit;
  sellPrice: string;
  buyPrice: string;
  vatRate: VatRate;
  criticalLevel: string;
  isQuick: boolean;
  openingStock: string;
};

export type DraftErrors = Partial<
  Record<'barcode' | 'name' | 'sellPrice' | 'buyPrice' | 'criticalLevel' | 'openingStock', string>
>;

export type ReadDraft =
  | {
      fields: Required<Omit<NewProduct, 'barcode' | 'categoryId'>> & NewProduct;
      openingStockMilli: number;
    }
  | { errors: DraftErrors };

export const UNIT_OPTIONS: readonly ChoiceOption<ProductUnit>[] = [
  { value: 'piece', label: 'Adet' },
  { value: 'kg', label: 'Kilogram' },
];

const ZERO = /^0+(?:[.,]0+)?$/;

/** The form for a product, or an empty one (with a scanned barcode, if there is one). */
export function draftOf(product?: ProductRecord, barcode?: string): ProductDraft {
  return {
    barcode: product?.barcode ?? barcode ?? '',
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? '',
    unit: product?.unit ?? 'piece',
    sellPrice: product ? formatPriceInput(product.sellPrice) : '',
    buyPrice: product && product.buyPrice > 0 ? formatPriceInput(product.buyPrice) : '',
    vatRate: product?.vatRate ?? 1,
    criticalLevel:
      product && product.criticalLevelMilli > 0 ? formatQtyInput(product.criticalLevelMilli) : '',
    isQuick: product?.isQuick ?? false,
    openingStock: '',
  };
}

/** The product fields the form holds, or a message for every box that cannot be read. */
export function readDraft(draft: ProductDraft): ReadDraft {
  const errors: DraftErrors = {};
  try {
    canonicalBarcode(draft.barcode);
  } catch {
    errors.barcode = 'Barkod yalnız harf, rakam ve - içerebilir.';
  }
  if (draft.name.trim() === '') {
    errors.name = 'Ürün adı gerekli.';
  }
  const sellPrice = readPrice(draft.sellPrice, 'sellPrice', errors);
  const buyPrice = readPrice(draft.buyPrice, 'buyPrice', errors);
  const criticalLevelMilli = readQuantity(draft.criticalLevel, draft.unit, 'criticalLevel', errors);
  const openingStockMilli = readQuantity(draft.openingStock, draft.unit, 'openingStock', errors);
  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return {
    fields: {
      barcode: draft.barcode,
      name: draft.name,
      categoryId: draft.categoryId,
      unit: draft.unit,
      sellPrice,
      buyPrice,
      vatRate: draft.vatRate,
      isQuick: draft.isQuick,
      criticalLevelMilli,
    },
    openingStockMilli,
  };
}

/** What one unit earns at these prices, once both are typed. */
export function profitHint(draft: ProductDraft): string | undefined {
  try {
    const profit = parseTRY(draft.sellPrice) - parseTRY(draft.buyPrice);
    return profit >= 0 ? `Birim kâr: ${formatTRY(profit)}` : 'Alış fiyatı satış fiyatından yüksek.';
  } catch {
    return undefined;
  }
}

/** The sell price is required; an empty buy price means it is not known (0). */
function readPrice(text: string, field: 'sellPrice' | 'buyPrice', errors: DraftErrors): Kurus {
  if (field === 'buyPrice' && text.trim() === '') {
    return 0;
  }
  let price: Kurus;
  try {
    price = parseTRY(text);
  } catch {
    errors[field] = 'Geçerli bir tutar girin.';
    return 0;
  }
  if (price > MAX_UNIT_PRICE) {
    errors[field] = `Fiyat en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.`;
  }
  return price;
}

/** An empty box or zero is no quantity; a piece product takes whole numbers only. */
function readQuantity(
  text: string,
  unit: ProductUnit,
  field: 'criticalLevel' | 'openingStock',
  errors: DraftErrors,
): number {
  const value = text.trim();
  if (value === '' || ZERO.test(value)) {
    return 0;
  }
  const qtyMilli = parseQuantity(value, unit);
  if (qtyMilli === null) {
    const fractional = unit === 'piece' && parseQuantity(value, 'kg') !== null;
    errors[field] = fractional ? 'Adet için tam sayı girin.' : 'Geçerli bir miktar girin.';
    return 0;
  }
  return qtyMilli;
}
