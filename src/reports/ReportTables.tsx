import type { JSX } from 'react';
import { formatStock } from '@/pos/format';
import { formatAmount, percentFormat } from './reportFormat';
import type { Summary } from './summary';

type Column = { label: string; numeric?: boolean };
type Row = { key: string; cells: readonly string[] };

/**
 * The breakdowns under the headline figures, on screen and on paper alike: best sellers,
 * categories, VAT and, when more than one register sold, each register.
 */
export function ReportTables({ summary }: { summary: Summary }): JSX.Element {
  const categoryTotal = summary.categories.reduce((sum, row) => sum + Math.max(row.net, 0), 0);
  const share = (net: number) =>
    categoryTotal > 0 && net > 0 ? percentFormat.format(net / categoryTotal) : '—';
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
      <ReportTable
        caption="En çok satanlar"
        columns={[
          { label: 'Ürün' },
          { label: 'Miktar', numeric: true },
          { label: 'Tutar', numeric: true },
        ]}
        rows={summary.bestSellers.map((row) => ({
          key: row.productId,
          cells: [row.name, formatStock(row.qtyMilli, row.unit ?? 'piece'), formatAmount(row.net)],
        }))}
      />
      <ReportTable
        caption="Kategoriler"
        columns={[
          { label: 'Kategori' },
          { label: 'Tutar', numeric: true },
          { label: 'Pay', numeric: true },
        ]}
        rows={summary.categories.map((row) => ({
          key: row.categoryId ?? '',
          cells: [row.name, formatAmount(row.net), share(row.net)],
        }))}
      />
      <ReportTable
        caption="KDV dilimleri"
        columns={[
          { label: 'Oran' },
          { label: 'Matrah', numeric: true },
          { label: 'KDV', numeric: true },
          { label: 'Toplam', numeric: true },
        ]}
        rows={summary.vatByRate.map((row) => ({
          key: String(row.rate),
          cells: [
            `%${row.rate}`,
            formatAmount(row.base),
            formatAmount(row.vat),
            formatAmount(row.base + row.vat),
          ],
        }))}
      />
      {summary.byDevice.length > 1 ? (
        <ReportTable
          caption="Kasalar"
          columns={[
            { label: 'Kasa' },
            { label: 'İşlem', numeric: true },
            { label: 'Net satış', numeric: true },
          ]}
          rows={summary.byDevice.map((row) => ({
            key: row.deviceCode,
            cells: [row.deviceCode, String(row.salesCount), formatAmount(row.net)],
          }))}
        />
      ) : null}
    </div>
  );
}

function ReportTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly Column[];
  rows: readonly Row[];
}): JSX.Element {
  const align = (column: Column | undefined) => (column?.numeric ? 'pl-3 text-right' : 'pr-3');
  return (
    <section className="rounded-control border border-line bg-surface p-4 print:border-0 print:p-0">
      <table className="w-full border-collapse text-left">
        <caption className="mb-2 text-left text-base font-semibold">{caption}</caption>
        <thead>
          <tr className="border-b border-line-strong text-sm text-text-2">
            {columns.map((column) => (
              <th key={column.label} scope="col" className={`py-2 font-medium ${align(column)}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-3 text-muted">
                Kayıt yok.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} className="border-b border-line last:border-0">
                {row.cells.map((cell, index) => (
                  <td
                    key={columns[index]?.label ?? index}
                    className={`py-2 ${align(columns[index])}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
