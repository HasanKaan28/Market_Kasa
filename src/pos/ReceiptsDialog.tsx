import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Settings } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { saleStatus } from '@/data/returns';
import { findSalesByReceiptEnding, recentSales } from '@/data/sales';
import type { SaleRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatDateTime, PAYMENT_LABELS } from './format';
import { buildReceipt } from './receipt';
import { receiptContext, type ReceiptSettings } from './receiptSettings';
import { whatsappLink, whatsappText } from './receiptText';
import { ReceiptView } from './ReceiptView';

export type ReceiptsDialogProps = {
  open: boolean;
  settings: ReceiptSettings;
  onClose(): void;
  onReturn(sale: SaleRecord): void;
  onVoid(sale: SaleRecord): void;
  onPrint(sale: SaleRecord): void;
  onSettings(): void;
};

const RECENT_LIMIT = 50;

/** The latest receipts, with each one's lines, payments and what can still be done with it. */
export function ReceiptsDialog({
  open,
  settings,
  onClose,
  onReturn,
  onVoid,
  onPrint,
  onSettings,
}: ReceiptsDialogProps): JSX.Element {
  const [selected, setSelected] = useState<SaleRecord | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Son fişler">
      {selected ? (
        <ReceiptDetail
          sale={selected}
          settings={settings}
          onBack={() => setSelected(null)}
          onReturn={onReturn}
          onVoid={onVoid}
          onPrint={onPrint}
        />
      ) : (
        <>
          <ReceiptList onSelect={setSelected} />
          <Button icon={<Settings aria-hidden="true" size={18} />} onClick={onSettings}>
            Fiş ayarları
          </Button>
        </>
      )}
    </Dialog>
  );
}

function ReceiptList({ onSelect }: { onSelect(sale: SaleRecord): void }): JSX.Element {
  const { db } = useData();
  const [query, setQuery] = useState('');
  const term = query.trim().toUpperCase();
  const rows = useLiveQuery(async () => {
    // A search looks through every sale, not only the recent ones: returns come days later.
    const sales =
      term === ''
        ? await recentSales(db, RECENT_LIMIT)
        : await findSalesByReceiptEnding(db, term, RECENT_LIMIT);
    return Promise.all(
      sales.map(async (sale) => ({ sale, status: await saleStatus(db, sale.id) })),
    );
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
              <span className="text-sm text-text-2">{formatDateTime(sale.occurredAt)}</span>{' '}
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
  settings,
  onBack,
  onReturn,
  onVoid,
  onPrint,
}: {
  sale: SaleRecord;
  settings: ReceiptSettings;
  onBack(): void;
  onReturn(sale: SaleRecord): void;
  onVoid(sale: SaleRecord): void;
  onPrint(sale: SaleRecord): void;
}): JSX.Element {
  const { db, settings: device } = useData();
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
  const model = buildReceipt(sale, {
    ...receiptContext(device, settings),
    customerName: customer?.name,
    status: { voided: status?.voided ?? false, returnedAny: (status?.returned.size ?? 0) > 0 },
  });

  function share() {
    window.open(whatsappLink(whatsappText(model), customer?.phone), '_blank', 'noopener');
  }

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
          <span className="text-sm text-text-2">{formatDateTime(sale.occurredAt)}</span>
        </div>
        {status?.voided ? <Badge tone="danger">İptal edildi</Badge> : null}
        {status && status.returned.size > 0 ? <Badge tone="muted">İade var</Badge> : null}
        {status?.conflict ? <Badge tone="danger">Kontrol gerekli</Badge> : null}
      </div>
      <div className="max-h-[50dvh] overflow-y-auto rounded-control border border-line bg-white">
        <ReceiptView model={model} paperWidth={settings.paperWidth} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {settings.printing ? <Button onClick={() => onPrint(sale)}>Yazdır</Button> : null}
        <Button onClick={share}>WhatsApp</Button>
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
