import { useRef, useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { SaleReturnedError, SaleVoidedError } from '@/data/errors';
import type { Payment, SaleRecord, SaleVoidRecord } from '@/data/types';
import { voidSale } from '@/data/voids';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';

export type VoidDialogProps = {
  open: boolean;
  sale: SaleRecord;
  onClose(): void;
  onVoided(record: SaleVoidRecord): void;
};

export function VoidDialog({ open, sale, onClose, onVoided }: VoidDialogProps): JSX.Element {
  const { db, settings } = useData();
  const { staff } = useSession();
  const { cutoffMinutes } = useMarketSettings();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // Guards a double click before the disabled state renders.
  const busy = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    if (reason.trim() === '') {
      setError('İptal nedeni gerekli.');
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const record = await voidSale(db, {
        saleId: sale.id,
        reason,
        deviceCode: settings.deviceCode,
        staffId: staff?.id,
        cutoffMinutes,
        at: new Date(),
      });
      onVoided(record);
    } catch (caught) {
      setError(voidErrorMessage(caught));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Satışı iptal et">
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-text-2">
          <span className="font-mono text-text">{sale.receiptNo}</span>
          {` · ${formatTRY(sale.total)}`}
        </p>
        <p className="text-text-2">{givenBack(sale)}</p>
        <TextField
          label="İptal nedeni"
          autoComplete="off"
          autoFocus
          value={reason}
          error={error}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" variant="danger" size="lg" disabled={saving}>
          İptal et
        </Button>
      </form>
    </Dialog>
  );
}

/** What a void puts back, by the ways the sale was paid. */
function givenBack(sale: SaleRecord): string {
  const paid = (method: Payment['method']) =>
    sale.payments
      .filter((payment) => payment.method === method)
      .reduce((sum, p) => sum + p.amount, 0);
  const cash = paid('cash');
  const card = paid('card');
  const credit = paid('credit');
  return [
    'Stok geri alınır.',
    cash > 0 ? `Nakit ${formatTRY(cash)} kasadan geri verilir.` : null,
    card > 0 ? `Kart ${formatTRY(card)} karta iade edilir.` : null,
    credit > 0 ? `Veresiye ${formatTRY(credit)} borçtan düşülür.` : null,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

function voidErrorMessage(error: unknown): string {
  if (error instanceof SaleVoidedError) {
    return 'Bu satış zaten iptal edilmiş.';
  }
  if (error instanceof SaleReturnedError) {
    return 'İadesi olan satış iptal edilemez.';
  }
  return 'İptal kaydedilemedi.';
}
