import { canonicalBarcode } from '@/data/products';
import { normalizeForSearch } from '@/data/text';
import type { ProductUnit } from '@/data/types';
import { formatTRY, parseTRY } from '@/domain/money';
import { MAX_UNIT_PRICE, VAT_RATES, type VatRate } from '@/domain/pricing';

export type ImportField =
  | 'barcode'
  | 'name'
  | 'category'
  | 'unit'
  | 'sellPrice'
  | 'buyPrice'
  | 'vatRate'
  | 'criticalLevel'
  | 'stock'
  | 'isQuick';

export const IMPORT_FIELDS: readonly ImportField[] = [
  'barcode',
  'name',
  'category',
  'unit',
  'sellPrice',
  'buyPrice',
  'vatRate',
  'criticalLevel',
  'stock',
  'isQuick',
];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  barcode: 'Barkod',
  name: 'Ürün adı',
  category: 'Kategori',
  unit: 'Birim',
  sellPrice: 'Satış fiyatı',
  buyPrice: 'Alış fiyatı',
  vatRate: 'KDV',
  criticalLevel: 'Kritik stok',
  stock: 'Stok',
  isQuick: 'Hızlı ürün',
};

/** Which column (0-based) each field is read from; an unmapped field is not imported. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/** A row's values once read. Quantities are thousandths; `unit` is absent when not given. */
export type ImportValues = {
  barcode: string;
  name: string;
  category: string;
  unit: ProductUnit;
  sellPrice: number;
  buyPrice: number;
  vatRate: VatRate;
  criticalLevelMilli: number;
  stockMilli: number;
  isQuick: boolean;
};

/** One row of the file: only the mapped, non-empty cells that could be read are in `fields`. */
export type ImportRow = {
  rowNumber: number;
  fields: Partial<ImportValues>;
  errors: string[];
  warnings: string[];
};

// The headers each field is known by, as `headerKey` writes them; v1's export uses the first ones.
const HEADER_NAMES: Record<ImportField, readonly string[]> = {
  barcode: ['barkod', 'barcode', 'ean', 'gtin', 'barkod no'],
  name: ['urun adi', 'urun', 'ad', 'adi', 'isim', 'urun ismi', 'stok adi', 'stok ismi', 'name'],
  category: ['kategori', 'grup', 'reyon', 'category'],
  unit: ['birim', 'olcu birimi', 'unit'],
  sellPrice: ['satis fiyati', 'satis', 'fiyat', 'fiyati', 'perakende fiyat', 'etiket fiyati'],
  buyPrice: ['alis fiyati', 'alis', 'maliyet', 'cost'],
  vatRate: ['kdv', 'kdv orani', 'vat'],
  criticalLevel: ['kritik', 'kritik stok', 'kritik seviye', 'min stok', 'minimum stok'],
  stock: ['stok', 'mevcut stok', 'stok miktari', 'miktar'],
  isQuick: ['hizli', 'hizli satis', 'hizli urun'],
};

const UNIT_NAMES: Record<string, ProductUnit> = {
  adet: 'piece',
  paket: 'piece',
  koli: 'piece',
  kutu: 'piece',
  sise: 'piece',
  litre: 'piece',
  lt: 'piece',
  kg: 'kg',
  kilo: 'kg',
  kilogram: 'kg',
};
const YES = new Set(['evet', 'e', 'yes', 'true', '1', 'x']);
const NO = new Set(['hayir', 'h', 'no', 'false', '0']);
// The ="…" wrapper the CSV export puts around a barcode so Excel keeps it as text.
const WRAPPED = /^="(.*)"$/;
const SCIENTIFIC = /^\d+(?:[.,]\d+)?e\+?\d+$/i;
const QUANTITY = /^-?\d+(?:[.,]\d{1,3})?$/;
const LONG_FRACTION = /^(\d+),(\d{2})(\d+)$/;

/** The column of each field whose header names it; each column is used once. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const column = keys.findIndex(
      (key, index) => !used.has(index) && HEADER_NAMES[field].includes(key),
    );
    if (column >= 0) {
      mapping[field] = column;
      used.add(column);
    }
  }
  return mapping;
}

/** The rows below the header (if there is one), numbered as the user counts them. */
export function readImportRows(
  table: readonly (readonly string[])[],
  mapping: ColumnMapping,
  hasHeader: boolean,
): ImportRow[] {
  const first = hasHeader ? 1 : 0;
  return table.slice(first).map((cells, index) => {
    const row: ImportRow = { rowNumber: first + index + 1, fields: {}, errors: [], warnings: [] };
    for (const field of IMPORT_FIELDS) {
      const column = mapping[field];
      const text = column === undefined ? '' : (cells[column] ?? '').trim();
      if (text !== '') {
        READERS[field](text, row);
      }
    }
    return row;
  });
}

const READERS: Record<ImportField, (text: string, row: ImportRow) => void> = {
  barcode: readBarcode,
  name: (text, row) => {
    row.fields.name = withoutFormulaGuard(text);
  },
  category: (text, row) => {
    row.fields.category = withoutFormulaGuard(text);
  },
  unit: (text, row) => {
    const unit = UNIT_NAMES[headerKey(text)];
    if (unit) {
      row.fields.unit = unit;
    } else {
      row.errors.push(`Birim okunamadı: "${text}". Adet ya da Kg yazın.`);
    }
  },
  sellPrice: (text, row) => readPrice(text, 'sellPrice', row),
  buyPrice: (text, row) => readPrice(text, 'buyPrice', row),
  vatRate: (text, row) => {
    const value = Number(text.replace('%', '').replace(',', '.').trim());
    const rate =
      VAT_RATES.find((candidate) => candidate === value) ??
      // Excel keeps a percentage cell as a fraction: %10 is 0.1.
      (value > 0 && value < 1
        ? VAT_RATES.find((candidate) => candidate === Math.round(value * 100))
        : undefined);
    if (rate === undefined) {
      row.errors.push('KDV 0, 1, 10 ya da 20 olmalı.');
    } else {
      row.fields.vatRate = rate;
    }
  },
  criticalLevel: (text, row) => readQuantity(text, 'criticalLevelMilli', row),
  stock: (text, row) => readQuantity(text, 'stockMilli', row),
  isQuick: (text, row) => {
    const key = headerKey(text);
    if (YES.has(key) || NO.has(key)) {
      row.fields.isQuick = YES.has(key);
    } else {
      row.errors.push(`Hızlı ürün okunamadı: "${text}". Evet ya da Hayır yazın.`);
    }
  },
};

function readBarcode(text: string, row: ImportRow): void {
  const raw = text.match(WRAPPED)?.[1] ?? text;
  if (SCIENTIFIC.test(raw)) {
    row.errors.push(`Barkod bilimsel gösterimde (${raw}): dosyada barkod sütununu metin yapın.`);
    return;
  }
  let barcode: string | undefined;
  try {
    barcode = canonicalBarcode(raw);
  } catch {
    row.errors.push('Barkod yalnız harf, rakam ve - içerebilir.');
    return;
  }
  if (barcode === undefined) {
    return;
  }
  row.fields.barcode = barcode;
  const restored = withLostZero(barcode);
  if (restored) {
    row.warnings.push(
      `Barkodun başındaki 0 düşmüş olabilir (${restored}?): dosyada barkod sütununu metin yapın.`,
    );
  }
}

function readPrice(text: string, field: 'sellPrice' | 'buyPrice', row: ImportRow): void {
  let price: number;
  try {
    price = parseImportPrice(text);
  } catch {
    row.errors.push(`${IMPORT_FIELD_LABELS[field]} okunamadı: "${text}".`);
    return;
  }
  if (price > MAX_UNIT_PRICE) {
    row.errors.push(`Fiyat en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.`);
    return;
  }
  row.fields[field] = price;
}

/**
 * An amount as `parseTRY` reads it, or with more than two decimals after a comma rounded half up
 * to the kuruş: a markup formula leaves "4,875" in a cell that Excel shows as 4,88.
 */
function parseImportPrice(text: string): number {
  try {
    return parseTRY(text);
  } catch (error) {
    const match = text.replace(/₺|tl/gi, '').replace(/\s+/g, '').match(LONG_FRACTION);
    if (!match) {
      throw error;
    }
    const [, whole = '0', cents = '00', rest = '0'] = match;
    return Number(whole) * 100 + Number(cents) + (Number(rest.charAt(0)) >= 5 ? 1 : 0);
  }
}

/** A quantity with up to three decimals ("1,5", "12.250"), whichever unit it is for. */
function readQuantity(
  text: string,
  field: 'criticalLevelMilli' | 'stockMilli',
  row: ImportRow,
): void {
  const label = IMPORT_FIELD_LABELS[field === 'stockMilli' ? 'stock' : 'criticalLevel'];
  if (!QUANTITY.test(text)) {
    row.errors.push(`${label} okunamadı: "${text}".`);
    return;
  }
  const [whole = '0', fraction = ''] = text.replace('-', '').split(/[.,]/);
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(milli)) {
    row.errors.push(`${label} okunamadı: "${text}".`);
  } else if (text.startsWith('-') && field === 'criticalLevelMilli') {
    row.errors.push(`${label} eksi olamaz.`);
  } else {
    // A stock below zero is read: only a new product refuses it, an existing one ignores it.
    row.fields[field] = text.startsWith('-') ? -milli : milli;
  }
}

/**
 * The code with a leading zero put back, when Excel seems to have dropped it: the code is no
 * valid GTIN as it stands, but becomes one with the zero. Only a warning: shops' own codes vary.
 */
function withLostZero(code: string): string | undefined {
  if (!/^\d+$/.test(code) || ![7, 11, 12].includes(code.length)) {
    return undefined;
  }
  const padded = `0${code}`;
  return !isGtin(code) && isGtin(padded) ? padded : undefined;
}

/** EAN-8, UPC-A, EAN-13 or GTIN-14 with a correct check digit. */
function isGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) {
    return false;
  }
  const digits = Array.from(code, Number);
  const check = digits.pop();
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** The text without the apostrophe the export puts before a formula start ("'=…"). */
function withoutFormulaGuard(text: string): string {
  return text.replace(/^'(?=[=+\-@])/, '');
}

/** A header or word as the matching tables write it: "Satış Fiyatı (₺)" → "satis fiyati". */
function headerKey(text: string): string {
  return normalizeForSearch(text)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
