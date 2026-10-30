import { formatPriceInput, formatQtyInput } from '@/pos/format';
import { IMPORT_FIELD_LABELS, IMPORT_FIELDS, type ImportField } from './importRows';
import type { ProductRow } from './productList';

// Excel reads a UTF-8 CSV as UTF-8 only when the file starts with a byte order mark.
const BOM = String.fromCharCode(0xfeff);
const DELIMITER = ';';
const LINE_END = '\r\n';
// A cell starting with one of these is run as a formula by spreadsheet programs.
const FORMULA_START = /^[=+\-@\t\r]/;

const UNIT_NAMES = { piece: 'Adet', kg: 'Kg' } as const;

/**
 * The products as a CSV that Excel opens correctly and this app reads back unchanged: the
 * importer's own headers, ";" between cells, decimal commas, and each barcode as ="…" so Excel
 * keeps it as text instead of turning it into 8,69E+12.
 */
export function productsToCsv(rows: readonly ProductRow[]): string {
  const header = IMPORT_FIELDS.map((field) => IMPORT_FIELD_LABELS[field]).join(DELIMITER);
  const lines = rows.map((row) => IMPORT_FIELDS.map((field) => cellOf(row, field)).join(DELIMITER));
  return BOM + [header, ...lines].map((line) => line + LINE_END).join('');
}

/** Saves text as a file through the browser's download, under the given name. */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download only after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cellOf({ product, stockMilli, categoryName }: ProductRow, field: ImportField): string {
  switch (field) {
    case 'barcode':
      return product.barcode ? `="${product.barcode}"` : '';
    case 'name':
      return csvText(product.name);
    case 'category':
      return csvText(categoryName ?? '');
    case 'unit':
      return UNIT_NAMES[product.unit];
    case 'sellPrice':
      return formatPriceInput(product.sellPrice);
    case 'buyPrice':
      return product.buyPrice > 0 ? formatPriceInput(product.buyPrice) : '';
    case 'vatRate':
      return String(product.vatRate);
    case 'criticalLevel':
      return product.criticalLevelMilli > 0 ? formatQtyInput(product.criticalLevelMilli) : '';
    case 'stock':
      return formatQtyInput(stockMilli);
    case 'isQuick':
      return product.isQuick ? 'Evet' : 'Hayır';
  }
}

/** Free text, made safe: a formula start gets an apostrophe, and quotes wrap what needs them. */
/** A text cell: kept from running as a formula, and quoted when it holds a delimiter. */
export function csvText(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
