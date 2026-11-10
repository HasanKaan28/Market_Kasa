import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import type { MarketDb } from '@/data/db';
import { listMovements } from '@/data/stock';
import type { ProductRecord, StockMovementKind, StockMovementRecord } from '@/data/types';
import { Dialog } from '@/design';
import { formatDateTime, formatStock } from '@/pos/format';

export type MovementsDialogProps = { open: boolean; product: ProductRecord; onClose(): void };

const LIMIT = 200;

const KIND_LABELS: Record<StockMovementKind, string> = {
  sale: 'Satış',
  return: 'İade',
  void: 'İptal',
  purchase: 'Mal kabul',
  count: 'Sayım',
  manual: 'Düzeltme',
};

/** A product's stock movements, newest first, with the stock each one left behind. */
export function MovementsDialog({ open, product, onClose }: MovementsDialogProps): JSX.Element {
  const { db } = useData();
  const history = useLiveQuery(async () => {
    const [rows, total] = await Promise.all([
      listMovements(db, product.id, LIMIT),
      db.stockMovements.where('productId').equals(product.id).count(),
    ]);
    const details = await Promise.all(rows.map(({ movement }) => detailOf(db, movement)));
    return { rows, total, details };
  }, [db, product.id]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Stok hareketleri"
      description={product.name}
      size="lg"
    >
      {history && history.rows.length === 0 ? (
        <p className="text-text-2">Bu ürünün stok hareketi yok.</p>
      ) : null}
      {history && history.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <caption className="sr-only">Stok hareketleri</caption>
            <thead className="border-b border-line-strong text-sm text-text-2">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Tarih
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Tür
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Değişim
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Stok
                </th>
                <th scope="col" className="py-2 font-medium">
                  Ayrıntı
                </th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map(({ movement, balanceMilli }, index) => (
                <tr key={movement.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-text-2">{formatDateTime(movement.occurredAt)}</td>
                  <td className="py-2 pr-3">{KIND_LABELS[movement.kind]}</td>
                  <td className="py-2 pr-3 text-right">{signed(movement.delta, product)}</td>
                  <td className={`py-2 pr-3 text-right ${balanceMilli < 0 ? 'text-danger' : ''}`}>
                    {formatStock(balanceMilli, product.unit)}
                  </td>
                  <td className="py-2 break-words text-text-2">{history.details[index]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {history && history.total > LIMIT ? (
        <p className="text-sm text-text-2">{`Son ${LIMIT} hareket gösteriliyor.`}</p>
      ) : null}
    </Dialog>
  );
}

/** "+5 adet" or "−2 adet". */
function signed(deltaMilli: number, product: ProductRecord): string {
  const text = formatStock(deltaMilli, product.unit);
  return deltaMilli > 0 ? `+${text}` : text;
}

/** What a movement came from: the receipt of a sale, a return or a void; a receipt's note; why. */
async function detailOf(db: MarketDb, movement: StockMovementRecord): Promise<string> {
  const ref = movement.refId;
  switch (movement.kind) {
    case 'sale':
      return ref ? ((await db.sales.get(ref))?.receiptNo ?? '') : '';
    case 'return': {
      const saleId = ref ? (await db.returns.get(ref))?.saleId : undefined;
      return saleId ? ((await db.sales.get(saleId))?.receiptNo ?? '') : '';
    }
    case 'void': {
      const saleId = ref ? (await db.saleVoids.get(ref))?.saleId : undefined;
      return saleId ? ((await db.sales.get(saleId))?.receiptNo ?? '') : '';
    }
    case 'purchase':
      return ref ? ((await db.purchases.get(ref))?.note ?? '') : '';
    // A shelf count names its note; an opening count has no count record.
    case 'count':
      return ref ? ((await db.stockCounts.get(ref))?.note ?? '') : '';
    default:
      return movement.note ?? '';
  }
}
