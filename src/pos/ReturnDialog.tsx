import { useLiveQuery } from 'dexie-react-hooks';
import { Minus, Plus } from 'lucide-react';
import { useRef, useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { ReturnExceedsSaleError } from '@/data/errors';
import { planRefund, quantitiesOf, recordReturn, refundsOf } from '@/data/returns';
import type { Payment, PaymentMethod, ReturnRecord, SaleRecord } from '@/data/types';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import { refundShare } from '@/domain/returns';
import { formatLineQty } from './format';

export type ReturnDialogProps = {
  open: boolean;
  sale: SaleRecord;
  onClose(): void;
  onReturned(record: ReturnRecord): void;
};

const ONE = 1000;

const REFUND_LABELS: Record<PaymentMethod, string> = {
  credit: 'Veresiyeden düşülecek',
  card: 'Kart iadesi',
  cash: 'Nakit iadesi',
};

/** The refund split, or null when the methods cannot cover it (devices in conflict). */
function safePlan(sale: SaleRecord, earlier: readonly Payment[], amount: number): Payment[] | null {
  try {
    return planRefund(sale.payments, earlier, amount);
  } catch {
    return null;
  }
}

/** Takes goods back from one receipt: how many of each line, and how the money goes back. */
export function ReturnDialog({ open, sale, onClose, onReturned }: ReturnDialogProps): JSX.Element {
  const { db, settings } = useData();
  const earlier = useLiveQuery(
    () => db.returns.where('saleId').equals(sale.id).toArray(),
    [db, sale.id],
  );
  const returned = earlier ? quantitiesOf(earlier) : undefined;
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  // Returns made elsewhere (another tab, a sync) can land while the dialog is open: every
  // choice is clamped to what is left now, so the refund preview can never ask for too much.
  const remaining = (productId: string, soldMilli: number) =>
    Math.max(0, soldMilli - (returned?.get(productId) ?? 0));
  const quantityOf = (productId: string, soldMilli: number) =>
    Math.min(chosen[productId] ?? 0, remaining(productId, soldMilli));
  const refund = sale.lines.reduce((sum, line) => {
    const qty = quantityOf(line.productId, line.qtyMilli);
    const already = returned?.get(line.productId) ?? 0;
    return qty > 0 ? sum + refundShare(line.net, line.qtyMilli, already, qty) : sum;
  }, 0);
  const lines = sale.lines
    .map((line) => ({
      productId: line.productId,
      qtyMilli: quantityOf(line.productId, line.qtyMilli),
    }))
    .filter((line) => line.qtyMilli > 0);
  // The money goes back the way the sale was paid: debt first, cash last.
  const plan = refund > 0 && earlier ? safePlan(sale, refundsOf(earlier), refund) : [];

  function step(productId: string, soldMilli: number, delta: number) {
    const max = remaining(productId, soldMilli);
    setChosen((current) => {
      const next = Math.min(max, Math.max(0, (current[productId] ?? 0) + delta));
      return { ...current, [productId]: next };
    });
  }

  async function save() {
    if (busy.current || lines.length === 0 || plan === null) {
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const record = await recordReturn(db, {
        saleId: sale.id,
        lines,
        deviceCode: settings.deviceCode,
        at: new Date(),
      });
      onReturned(record);
    } catch (caught) {
      setError(
        caught instanceof ReturnExceedsSaleError
          ? 'İade miktarı satılan miktarı aşıyor.'
          : 'İade kaydedilemedi.',
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="İade">
      <p className="font-mono text-sm text-text-2">{sale.receiptNo}</p>
      <ul className="flex flex-col divide-y divide-line">
        {sale.lines.map((line) => {
          const left = returned ? remaining(line.productId, line.qtyMilli) : 0;
          const qty = quantityOf(line.productId, line.qtyMilli);
          return (
            <li key={line.productId} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{line.name}</p>
                <p className="text-sm text-text-2">
                  {`Satılan ${formatLineQty(line.qtyMilli, line.unit)} · İade edilebilir ${formatLineQty(left, line.unit)}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Azalt · ${line.name}`}
                disabled={qty === 0}
                icon={<Minus aria-hidden="true" size={18} />}
                onClick={() => step(line.productId, line.qtyMilli, -ONE)}
              />
              <span className="min-w-10 text-center font-mono">
                {formatLineQty(qty, line.unit)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Artır · ${line.name}`}
                disabled={qty >= left}
                icon={<Plus aria-hidden="true" size={18} />}
                onClick={() => step(line.productId, line.qtyMilli, ONE)}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between">
        <span className="font-medium">İade tutarı</span>
        <span data-testid="refund" className="font-mono text-[22px] font-semibold">
          {formatTRY(refund)}
        </span>
      </div>
      <dl data-testid="refund-plan" className="flex flex-col gap-1 text-text-2">
        {(plan ?? []).map((part) => (
          <div key={part.method} className="flex justify-between">
            <dt>{REFUND_LABELS[part.method]}</dt>
            <dd className="font-mono">{formatTRY(part.amount)}</dd>
          </div>
        ))}
      </dl>
      {plan === null ? (
        <p role="alert" className="font-medium text-danger">
          Bu fişte geri verilecek ödeme kalmamış; yöneticiye danışın.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        disabled={lines.length === 0 || saving || plan === null}
        onClick={() => void save()}
      >
        İadeyi kaydet
      </Button>
    </Dialog>
  );
}
