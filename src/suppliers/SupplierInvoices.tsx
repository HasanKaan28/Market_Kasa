import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { formatDay } from '@/data/dates';
import { listSupplierPurchases } from '@/data/purchases';
import { documentDay } from '@/data/supplierLedger';
import type { PurchasePayment, PurchaseRecord } from '@/data/types';
import { formatTRY } from '@/domain/money';
import { formatStock } from '@/pos/format';

const PAYMENT_LABELS: Record<PurchasePayment, string> = {
  cash: 'Peşin',
  card: 'Kart',
  on_account: 'Veresiye',
};

const invoiceName = (purchase: PurchaseRecord) =>
  purchase.invoiceNo ? `Fatura ${purchase.invoiceNo}` : 'Numarasız fatura';

/**
 * Every goods receipt from this supplier, newest first, paid or owed; one tap opens what it held.
 * A cash delivery owes nothing, so the statement never shows it, but it is still this supplier's.
 */
export function SupplierInvoices({ supplierId }: { supplierId: string }): JSX.Element | null {
  const { db } = useData();
  const purchases = useLiveQuery(() => listSupplierPurchases(db, supplierId), [db, supplierId]);
  const [openId, setOpenId] = useState<string>();

  if (!purchases || purchases.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="supplier-invoices" className="flex flex-col gap-2">
      <h3 id="supplier-invoices" className="font-semibold">
        Faturalar
      </h3>
      <ul
        aria-label="Faturalar"
        className="flex flex-col divide-y divide-line rounded-control border border-line"
      >
        {purchases.map((purchase) => {
          const open = openId === purchase.id;
          return (
            <li key={purchase.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? undefined : purchase.id)}
                className="flex min-h-12 w-full flex-wrap items-center gap-x-3 px-3 py-2 text-left hover:bg-bg"
              >
                <span className="w-24 text-text-2">{formatDay(documentDay(purchase))}</span>
                <span className="flex-1 font-medium">
                  {`${invoiceName(purchase)} · ${PAYMENT_LABELS[purchase.payment ?? 'cash']}`}
                </span>
                <span className="font-mono">{formatTRY(purchase.total)}</span>
              </button>
              {open ? (
                <div className="overflow-x-auto px-3 pb-3">
                  <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                    <caption className="sr-only">{invoiceName(purchase)}</caption>
                    <thead className="border-b border-line-strong text-text-2">
                      <tr>
                        <th scope="col" className="py-1.5 pr-3 font-medium">
                          Ürün
                        </th>
                        <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                          Miktar
                        </th>
                        <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                          Alış fiyatı
                        </th>
                        <th scope="col" className="py-1.5 text-right font-medium">
                          Tutar
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchase.lines.map((line, index) => (
                        <tr key={index} className="border-b border-line last:border-0">
                          <td className="py-1.5 pr-3">{line.name}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">
                            {formatStock(line.qtyMilli, line.unit)}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono">
                            {line.free ? 'Bedelsiz' : formatTRY(line.buyPrice)}
                          </td>
                          <td className="py-1.5 text-right font-mono">{formatTRY(line.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {purchase.note ? <p className="mt-2 text-text-2">{purchase.note}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
