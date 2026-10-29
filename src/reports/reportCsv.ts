import { csvText } from '@/products/exportCsv';
import { formatPriceInput, formatQtyInput } from '@/pos/format';
import type { Summary } from './summary';

const BOM = String.fromCharCode(0xfeff);
const DELIMITER = ';';
const LINE_END = '\r\n';
const UNIT_NAMES = { piece: 'Adet', kg: 'Kg' } as const;

/** Every product sold in the summary, with quantity and amount, as a CSV Excel opens correctly. */
export function soldProductsCsv(summary: Summary): string {
  const header = ['Ürün', 'Miktar', 'Birim', 'Tutar'].join(DELIMITER);
  const lines = summary.productsSold.map((row) =>
    [
      csvText(row.name),
      formatQtyInput(row.qtyMilli),
      UNIT_NAMES[row.unit ?? 'piece'],
      formatPriceInput(row.net),
    ].join(DELIMITER),
  );
  return BOM + [header, ...lines].map((line) => line + LINE_END).join('');
}
