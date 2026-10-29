import { useRef, useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { SaleReturnedError, SaleVoidedError } from '@/data/errors';
import type { SaleRecord, SaleVoidRecord } from '@/data/types';
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
          {` · ${formatTRY(sale.total)}. Stok ve veresiye geri alınır.`}
        </p>
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

function voidErrorMessage(error: unknown): string {
  if (error instanceof SaleVoidedError) {
    return 'Bu satış zaten iptal edilmiş.';
  }
  if (error instanceof SaleReturnedError) {
    return 'İadesi olan satış iptal edilemez.';
  }
  return 'İptal kaydedilemedi.';
}
