import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { saleStatus } from '@/data/returns';
import { findSaleByReceiptNo, recentSales } from '@/data/sales';
import type { SaleRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatQty, formatTime, PAYMENT_LABELS } from './format';

export type ReceiptsDialogProps = {
  open: boolean;
  onClose(): void;
  onReturn(sale: SaleRecord): void;
  onVoid(sale: SaleRecord): void;
};

const RECENT_LIMIT = 50;

/** The latest receipts, with each one's lines, payments and what can still be done with it. */
export function ReceiptsDialog({
  open,
  onClose,
  onReturn,
  onVoid,
}: ReceiptsDialogProps): JSX.Element {
  const [selected, setSelected] = useState<SaleRecord | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Son fişler">
      {selected ? (
        <ReceiptDetail
          sale={selected}
          onBack={() => setSelected(null)}
          onReturn={onReturn}
          onVoid={onVoid}
        />
      ) : (
        <ReceiptList onSelect={setSelected} />
      )}
    </Dialog>
  );
}

function ReceiptList({ onSelect }: { onSelect(sale: SaleRecord): void }): JSX.Element {
  const { db } = useData();
  const [query, setQuery] = useState('');
  const term = query.trim().toUpperCase();
  const rows = useLiveQuery(async () => {
    const recent = await recentSales(db, RECENT_LIMIT);
    let sales = term === '' ? recent : recent.filter((sale) => sale.receiptNo.endsWith(term));
    if (sales.length === 0 && term !== '') {
      const exact = await findSaleByReceiptNo(db, term);
      sales = exact ? [exact] : [];
    }
    return Promise.all(sales.map(async (sale) => ({ sale, status: await saleStatus(db, sale.id) })));
  }, [db, term]);

  return (
    <>
      <TextField
        label="Fiş no"
        hint="Son 4 hane yeterli."
        type="search"
        autoComplete="off"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {rows?.length === 0 ? <p className="text-text-2">Fiş yok</p> : null}
      <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
        {rows?.map(({ sale, status }) => (
          <li key={sale.id}>
            <button
              type="button"
              onClick={() => onSelect(sale)}
              className="flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-line px-3 py-2 text-left hover:border-line-strong"
            >
              <span className="font-mono text-sm font-medium">{sale.receiptNo}</span>{' '}
              <span className="text-sm text-text-2">{formatTime(sale.occurredAt)}</span>{' '}
              <span className="ml-auto font-mono font-semibold">{formatTRY(sale.total)}</span>{' '}
              <span className="w-full text-sm text-text-2">
                {sale.payments.map((payment) => PAYMENT_LABELS[payment.method]).join(' + ')}
              </span>
              {status.voided ? <Badge tone="danger">İptal edildi</Badge> : null}
              {status.returned.size > 0 ? <Badge tone="muted">İade var</Badge> : null}
              {status.conflict ? <Badge tone="danger">Kontrol gerekli</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function ReceiptDetail({
  sale,
  onBack,
  onReturn,
  onVoid,
}: {
  sale: SaleRecord;
  onBack(): void;
  onReturn(sale: SaleRecord): void;
  onVoid(sale: SaleRecord): void;
}): JSX.Element {
  const { db } = useData();
  const status = useLiveQuery(() => saleStatus(db, sale.id), [db, sale.id]);
  const customer = useLiveQuery(
    async () => (sale.customerId ? db.customers.get(sale.customerId) : undefined),
    [db, sale.customerId],
  );
  const fullyReturned =
    status !== undefined &&
    sale.lines.every((line) => (status.returned.get(line.productId) ?? 0) >= line.qtyMilli);
  // Until the status is known, nothing can be started.
  const canReturn = status !== undefined && !status.voided && !fullyReturned;
  const canVoid = status !== undefined && !status.voided && status.returned.size === 0;

  return (
    <section aria-label={`Fiş ${sale.receiptNo}`} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fişlere dön"
          icon={<ArrowLeft aria-hidden="true" size={18} />}
          onClick={onBack}
        />
        <div className="flex flex-col">
          <span className="font-mono font-semibold">{sale.receiptNo}</span>
          <span className="text-sm text-text-2">{formatTime(sale.occurredAt)}</span>
        </div>
        {status?.voided ? <Badge tone="danger">İptal edildi</Badge> : null}
        {status && status.returned.size > 0 ? <Badge tone="muted">İade var</Badge> : null}
        {status?.conflict ? <Badge tone="danger">Kontrol gerekli</Badge> : null}
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {sale.lines.map((line) => (
          <li key={line.productId} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{line.name}</p>
              <p className="font-mono text-sm text-text-2">
                {`${formatQty(line.qtyMilli)} × ${formatTRY(line.unitPrice)}`}
              </p>
            </div>
            <span className="font-mono">{formatTRY(line.net)}</span>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-1 border-t border-line pt-2">
        <div className="flex justify-between font-semibold">
          <dt>Toplam</dt>
          <dd className="font-mono">{formatTRY(sale.total)}</dd>
        </div>
        {sale.payments.map((payment) => (
          <div key={payment.method} className="flex justify-between text-text-2">
            <dt>{PAYMENT_LABELS[payment.method]}</dt>
            <dd className="font-mono">{formatTRY(payment.amount)}</dd>
          </div>
        ))}
        {sale.change > 0 ? (
          <div className="flex justify-between text-text-2">
            <dt>Para üstü</dt>
            <dd className="font-mono">{formatTRY(sale.change)}</dd>
          </div>
        ) : null}
        {customer ? (
          <div className="flex justify-between text-text-2">
            <dt>Müşteri</dt>
            <dd>{customer.name}</dd>
          </div>
        ) : null}
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={!canReturn} onClick={() => onReturn(sale)}>
          İade al
        </Button>
        <Button variant="danger" disabled={!canVoid} onClick={() => onVoid(sale)}>
          Satışı iptal et
        </Button>
      </div>
    </section>
  );
}

function Badge({ tone, children }: { tone: 'danger' | 'muted'; children: string }): JSX.Element {
  const colors = tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-bg text-text-2';
  return (
    <span className={`rounded-chip px-2 py-0.5 text-sm font-medium ${colors}`}>{children}</span>
  );
}
