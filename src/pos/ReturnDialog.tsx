import { useLiveQuery } from 'dexie-react-hooks';
import { Minus, Plus } from 'lucide-react';
import { useRef, useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { ReturnExceedsSaleError } from '@/data/errors';
import { recordReturn, returnedQuantities } from '@/data/returns';
import type { PaymentMethod, ReturnRecord, SaleRecord } from '@/data/types';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import { refundShare } from '@/domain/returns';
import { formatQty, PAYMENT_LABELS } from './format';

export type ReturnDialogProps = {
  open: boolean;
  sale: SaleRecord;
  onClose(): void;
  onReturned(record: ReturnRecord): void;
};

const ONE = 1000;

/** Takes goods back from one receipt: how many of each line, and how the money goes back. */
export function ReturnDialog({ open, sale, onClose, onReturned }: ReturnDialogProps): JSX.Element {
  const { db, settings } = useData();
  const returned = useLiveQuery(() => returnedQuantities(db, sale.id), [db, sale.id]);
  const methods = [...new Set(sale.payments.map((payment) => payment.method))];
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cash');
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

  function step(productId: string, soldMilli: number, delta: number) {
    const max = remaining(productId, soldMilli);
    setChosen((current) => {
      const next = Math.min(max, Math.max(0, (current[productId] ?? 0) + delta));
      return { ...current, [productId]: next };
    });
  }

  async function save() {
    if (busy.current || lines.length === 0) {
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const record = await recordReturn(db, {
        saleId: sale.id,
        lines,
        refundMethod: method,
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
                  {`Satılan ${formatQty(line.qtyMilli)} · İade edilebilir ${formatQty(left)}`}
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
              <span className="w-10 text-center font-mono">{formatQty(qty)}</span>
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
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">İade yöntemi</legend>
        <div className="flex flex-wrap gap-2">
          {methods.map((option) => (
            <label
              key={option}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong px-3 has-checked:border-accent has-checked:bg-accent has-checked:text-white"
            >
              <input
                type="radio"
                name="refundMethod"
                checked={method === option}
                onChange={() => setMethod(option)}
                className="sr-only"
              />
              {PAYMENT_LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-baseline justify-between">
        <span className="font-medium">İade tutarı</span>
        <span data-testid="refund" className="font-mono text-[22px] font-semibold">
          {formatTRY(refund)}
        </span>
      </div>
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        disabled={lines.length === 0 || saving}
        onClick={() => void save()}
      >
        İadeyi kaydet
      </Button>
    </Dialog>
  );
}
