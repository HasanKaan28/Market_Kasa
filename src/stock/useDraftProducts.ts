import { useLiveQuery } from 'dexie-react-hooks';
import { useData } from '@/app/appData';
import { productsById } from '@/data/products';
import type { ProductRecord } from '@/data/types';

export type DraftProducts = {
  /** By id, deleted ones too; a product no longer stored is missing. */
  products: ReadonlyMap<string, ProductRecord>;
  stock: ReadonlyMap<string, number>;
};

/** The products of a draft's lines and their stock, as they are now; undefined while reading. */
export function useDraftProducts(
  lines: readonly { productId: string }[],
): DraftProducts | undefined {
  const { db } = useData();
  const idKey = lines.map((line) => line.productId).join(',');
  return useLiveQuery(async () => {
    const ids = idKey.split(',');
    const [products, levels] = await Promise.all([
      productsById(db, ids),
      db.stockLevels.where('productId').anyOf(ids).toArray(),
    ]);
    return { products, stock: new Map(levels.map((level) => [level.productId, level.qtyMilli])) };
  }, [db, idKey]);
}
