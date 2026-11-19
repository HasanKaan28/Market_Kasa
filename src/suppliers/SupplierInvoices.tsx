import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { reversedPurchaseIds } from '@/data/corrections';
import { formatDay } from '@/data/dates';
import { listSupplierPurchases } from '@/data/purchases';
import { documentDay } from '@/data/supplierLedger';
import type { PurchaseRecord } from '@/data/types';
import { Button } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatStock } from '@/pos/format';
import { invoiceName, PURCHASE_PAYMENT_LABELS } from './labels';
import { Chip } from './ReverseForm';

export type SupplierInvoicesProps = {
  supplierId: string;
  /** Offers "Düzelt" on each receipt not taken back. */
  onCorrect?(purchase: PurchaseRecord): void;
  /** Offers "Geri al" on each receipt not taken back. */
  onReverse?(purchase: PurchaseRecord): void;
};

/**
 * Every goods receipt from this supplier, newest first, paid or owed; one tap opens what it held.
 * A cash delivery owes nothing, so the statement never shows it, but it is still this supplier's.
 * A receipt taken back stays in the list, struck through: it happened, and so did its reversal.
 */
export function SupplierInvoices({
  supplierId,
  onCorrect,
  onReverse,
}: SupplierInvoicesProps): JSX.Element | null {
  const { db } = useData();
  const view = useLiveQuery(async () => {
    const purchases = await listSupplierPurchases(db, supplierId);
    const reversed = await reversedPurchaseIds(
      db,
      purchases.map((purchase) => purchase.id),
    );
    return { purchases, reversed };
  }, [db, supplierId]);
  const [openId, setOpenId] = useState<string>();
  const purchases = view?.purchases;

  if (!view || !purchases || purchases.length === 0) {
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
          const reversed = view.reversed.has(purchase.id);
          const name = invoiceName(purchase);
          return (
            <li key={purchase.id}>
              <div className="flex flex-wrap items-center gap-2 pr-3">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? undefined : purchase.id)}
                  className="flex min-h-12 min-w-0 flex-1 flex-wrap items-center gap-x-3 px-3 py-2 text-left hover:bg-bg"
                >
                  <span className="w-24 text-text-2">{formatDay(documentDay(purchase))}</span>
                  <span className={`flex-1 font-medium ${reversed ? 'line-through' : ''}`}>
                    {`${name} · ${PURCHASE_PAYMENT_LABELS[purchase.payment ?? 'cash']}`}
                  </span>
                  <span className={`font-mono ${reversed ? 'line-through' : ''}`}>
                    {formatTRY(purchase.total)}
                  </span>
                </button>
                {reversed ? <Chip tone="danger">Geri alındı</Chip> : null}
                {purchase.correctsId ? <Chip tone="muted">Düzeltme</Chip> : null}
                {!reversed && onCorrect ? (
                  <Button aria-label={`Düzelt: ${name}`} onClick={() => onCorrect(purchase)}>
                    Düzelt
                  </Button>
                ) : null}
                {!reversed && onReverse ? (
                  <Button
                    variant="ghost"
                    aria-label={`Geri al: ${name}`}
                    onClick={() => onReverse(purchase)}
                  >
                    Geri al
                  </Button>
                ) : null}
              </div>
              {open ? (
                <div className="overflow-x-auto px-3 pb-3">
                  <PurchaseLines purchase={purchase} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What a goods receipt held, line by line, and its note. */
export function PurchaseLines({ purchase }: { purchase: PurchaseRecord }): JSX.Element {
  return (
    <>
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
    </>
  );
}
