import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import type { MarketDb } from '@/data/db';
import { cancelInvoice, retryInvoice } from '@/data/invoices';
import type { InvoiceRecord, SaleRecord } from '@/data/types';
import { Button } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatDateTime } from '@/pos/format';
import { INVOICE_STATUS_LABELS } from './labels';

type InvoiceRow = {
  invoice: InvoiceRecord;
  sale?: SaleRecord;
  returned: boolean;
  voided: boolean;
  /** Another request for the same sale came first: two registers asked before they synced. */
  duplicate: boolean;
};

/**
 * Every e-Arşiv invoice asked for on a sale, newest first, with where each one stands and what
 * can be done. `onMessage` tells how an action went.
 */
export function ArchiveInvoices({ onMessage }: { onMessage(message: string): void }): JSX.Element {
  const { db, runner } = useData();
  const rows = useLiveQuery(() => invoiceRows(db), [db]);
  const pending = rows?.filter((row) => row.invoice.status === 'pending').length ?? 0;

  async function act(change: () => Promise<unknown>, message: string) {
    try {
      await change();
      onMessage(message);
      void runner.run();
    } catch {
      onMessage('Yapılamadı: fatura bu arada değişti.');
    }
  }

  return (
    <>
      {rows ? (
        <p className="text-sm text-text-2">{`${rows.length} fatura · ${pending} beklemede`}</p>
      ) : null}
      {rows?.length === 0 ? (
        <p className="text-text-2">
          Henüz fatura istenmedi. Son fişlerden bir satışa “Fatura kes” deyin.
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-control border border-line bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong text-sm text-text-2">
                <th scope="col" className="px-3 py-2 font-medium">
                  Fiş
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Alıcı
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Tutar
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Durum
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">İşlem</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ invoice, sale, returned, voided, duplicate }) => (
                <tr key={invoice.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2">
                    <span className="block font-mono text-sm font-medium whitespace-nowrap">
                      {sale?.receiptNo ?? 'Fiş henüz gelmedi'}
                    </span>
                    <span className="block text-sm text-text-2">
                      {formatDateTime(invoice.createdAt)}
                    </span>
                    {voided ? <Note tone="danger">Satış iptal edildi</Note> : null}
                    {returned ? <Note tone="muted">İade var</Note> : null}
                    {duplicate ? <Note tone="danger">Aynı fişe ikinci istek</Note> : null}
                  </td>
                  <td className="px-3 py-2">
                    {invoice.buyer.kind === 'person' ? invoice.buyer.name : invoice.buyer.title}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {sale ? formatTRY(sale.total) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`block font-medium ${invoice.status === 'failed' ? 'text-danger' : ''}`}
                    >
                      {INVOICE_STATUS_LABELS[invoice.status]}
                    </span>
                    {invoice.ettn ? (
                      <span className="block font-mono text-sm text-text-2">{invoice.ettn}</span>
                    ) : null}
                    {invoice.error ? (
                      <span className="block text-sm text-danger">{invoice.error}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      {invoice.status === 'failed' ? (
                        <Button
                          onClick={() =>
                            void act(
                              () => retryInvoice(db, invoice.id, new Date()),
                              'Fatura yeniden gönderilecek.',
                            )
                          }
                        >
                          Yeniden dene
                        </Button>
                      ) : null}
                      {invoice.status === 'pending' || invoice.status === 'failed' ? (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void act(
                              () => cancelInvoice(db, invoice.id, new Date()),
                              'Fatura isteği iptal edildi.',
                            )
                          }
                        >
                          İptal et
                        </Button>
                      ) : null}
                      {invoice.status === 'issued' ? (
                        <span className="text-sm text-text-2">
                          İptal sağlayıcı üzerinden yapılır.
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function Note({ tone, children }: { tone: 'danger' | 'muted'; children: string }): JSX.Element {
  const colors = tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-bg text-text-2';
  return (
    <span
      className={`mt-1 mr-1 inline-block rounded-chip px-2 py-0.5 text-sm font-medium ${colors}`}
    >
      {children}
    </span>
  );
}

async function invoiceRows(db: MarketDb): Promise<InvoiceRow[]> {
  const invoices = await db.invoices.toArray();
  // Oldest first to find the request each sale had first, then newest first to show.
  invoices.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const saleIds = [...new Set(invoices.map((invoice) => invoice.saleId))];
  const [sales, returns, voids] = await Promise.all([
    db.sales.bulkGet(saleIds),
    db.returns.where('saleId').anyOf(saleIds).toArray(),
    db.saleVoids.where('saleId').anyOf(saleIds).toArray(),
  ]);
  const salesById = new Map(
    sales.filter((sale) => sale !== undefined).map((sale) => [sale.id, sale]),
  );
  const returned = new Set(returns.map((record) => record.saleId));
  const voided = new Set(voids.map((record) => record.saleId));
  const firstActive = new Set<string>();
  const rows = invoices.map((invoice) => {
    let duplicate = false;
    if (invoice.status !== 'cancelled') {
      duplicate = firstActive.has(invoice.saleId);
      firstActive.add(invoice.saleId);
    }
    return {
      invoice,
      sale: salesById.get(invoice.saleId),
      returned: returned.has(invoice.saleId),
      voided: voided.has(invoice.saleId),
      duplicate,
    };
  });
  return rows.reverse();
}
