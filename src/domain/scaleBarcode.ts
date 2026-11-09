import type { Kurus } from './money';

/**
 * How the shop's scale prints its labels: an EAN-13 whose first two digits are one of
 * `prefixes` (GS1 keeps 20–29 for in-store codes), then the scale's item code (`codeDigits`
 * long), then the weight in grams or the price in kuruş, then the check digit.
 */
export type ScaleConfig = {
  enabled: boolean;
  prefixes: string[];
  codeDigits: number;
  value: 'weight' | 'price';
};

/** The most common Turkish scale label: 27/28/29, a five-digit item code, the weight in grams. */
export const DEFAULT_SCALE: ScaleConfig = {
  enabled: true,
  prefixes: ['27', '28', '29'],
  codeDigits: 5,
  value: 'weight',
};

const PREFIX = /^2\d$/;

export function isValidScaleConfig(config: ScaleConfig): boolean {
  return (
    typeof config.enabled === 'boolean' &&
    Array.isArray(config.prefixes) &&
    config.prefixes.length > 0 &&
    config.prefixes.length <= 10 &&
    config.prefixes.every((prefix) => PREFIX.test(prefix)) &&
    Number.isInteger(config.codeDigits) &&
    config.codeDigits >= 4 &&
    config.codeDigits <= 6 &&
    (config.value === 'weight' || config.value === 'price')
  );
}

/** The first twelve digits of an EAN-13 with its check digit added. */
export function withCheckDigit(twelve: string): string {
  const sum = Array.from(twelve).reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${twelve}${(10 - (sum % 10)) % 10}`;
}

export type ScaleRead = { prefix: string; itemCode: string; amount: number };

/** The item code and the amount in a scale label, or null when the code is not one. */
export function readScaleBarcode(code: string, config: ScaleConfig): ScaleRead | null {
  const text = code.trim();
  if (!config.enabled || !/^\d{13}$/.test(text) || withCheckDigit(text.slice(0, 12)) !== text) {
    return null;
  }
  const prefix = text.slice(0, 2);
  if (!config.prefixes.includes(prefix)) {
    return null;
  }
  const itemCode = text.slice(2, 2 + config.codeDigits);
  const amount = Number(text.slice(2 + config.codeDigits, 12));
  return amount > 0 ? { prefix, itemCode, amount } : null;
}

/**
 * The barcodes a product may be stored under for this label: with its prefix ("2700123"), as
 * the scale prints the item code ("00123"), and as its plain number ("123").
 */
export function scaleItemCodes(read: ScaleRead): string[] {
  const plain = String(Number(read.itemCode));
  return [...new Set([`${read.prefix}${read.itemCode}`, read.itemCode, plain])];
}

/**
 * The quantity, in thousandths, a label's amount stands for: grams are thousandths of a kilo;
 * a price is divided by the product's own price. Null when the product cannot take it: a weight
 * on a piece product, a price that is not whole pieces, a product with no price.
 */
export function scaleQtyMilli(
  amount: number,
  product: { unit: 'piece' | 'kg'; sellPrice: Kurus },
  value: ScaleConfig['value'],
): number | null {
  if (value === 'weight') {
    return product.unit === 'kg' ? amount : null;
  }
  if (product.sellPrice <= 0) {
    return null;
  }
  const qtyMilli = Math.round((amount * 1000) / product.sellPrice);
  if (product.unit === 'piece') {
    return amount % product.sellPrice === 0 ? qtyMilli : null;
  }
  return qtyMilli > 0 ? qtyMilli : null;
}
