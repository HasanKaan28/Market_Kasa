import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import type { ProductRecord } from '@/data/types';
import { Button } from '@/design';
import { formatStock } from '@/pos/format';
import { isCritical } from '@/products/productList';

export type CriticalStockProps = {
  /** Puts a product on the goods receipt being prepared. */
  onReceive(product: ProductRecord): void;
};

/** Live products at or below their critical level, the furthest below it first. */
export function CriticalStock({ onReceive }: CriticalStockProps): JSX.Element {
  const { db } = useData();
  const rows = useLiveQuery(async () => {
    const [products, levels] = await Promise.all([
      db.products
        .filter((product) => !product.deletedAt && product.criticalLevelMilli > 0)
        .toArray(),
      db.stockLevels.toArray(),
    ]);
    const stock = new Map(levels.map((level) => [level.productId, level.qtyMilli]));
    return products
      .map((product) => ({ product, stockMilli: stock.get(product.id) ?? 0 }))
      .filter(({ product, stockMilli }) => isCritical(product, stockMilli))
      .sort(
        (a, b) =>
          a.stockMilli -
            a.product.criticalLevelMilli -
            (b.stockMilli - b.product.criticalLevelMilli) ||
          a.product.name.localeCompare(b.product.name, 'tr'),
      );
  }, [db]);

  if (!rows) {
    return <></>;
  }
  if (rows.length === 0) {
    return <p className="text-text-2">Kritik stokta ürün yok.</p>;
  }
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <caption className="sr-only">Kritik stok</caption>
      <thead className="border-b border-line-strong text-sm text-text-2">
        <tr>
          <th scope="col" className="py-2 pr-3 font-medium">
            Ürün
          </th>
          <th scope="col" className="w-24 py-2 pr-3 text-right font-medium md:w-32">
            Stok
          </th>
          <th scope="col" className="hidden w-32 py-2 pr-3 text-right font-medium sm:table-cell">
            Kritik seviye
          </th>
          <th scope="col" className="w-36 py-2 font-medium">
            <span className="sr-only">Eylem</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ product, stockMilli }) => (
          <tr key={product.id} className="border-b border-line align-top last:border-0">
            <td className="py-3 pr-3 font-medium break-words">{product.name}</td>
            <td className={`py-3 pr-3 text-right ${stockMilli < 0 ? 'text-danger' : ''}`}>
              {formatStock(stockMilli, product.unit)}
            </td>
            <td className="hidden py-3 pr-3 text-right text-text-2 sm:table-cell">
              {formatStock(product.criticalLevelMilli, product.unit)}
            </td>
            <td className="py-1.5">
              <Button
                aria-label={`Mal kabule ekle: ${product.name}`}
                onClick={() => onReceive(product)}
              >
                Mal kabule ekle
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
