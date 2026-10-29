import { useState, type JSX } from 'react';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY, parseTRY, type Kurus } from '@/domain/money';
import { suggestCash } from './checkout';

export type PaymentDialogProps = {
  open: boolean;
  method: 'cash' | 'card';
  total: Kurus;
  busy?: boolean;
  onClose(): void;
  onConfirm(cashGiven?: Kurus): void;
};

export function PaymentDialog({
  open,
  method,
  total,
  busy = false,
  onClose,
  onConfirm,
}: PaymentDialogProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={method === 'cash' ? 'Nakit ödeme' : 'Kart ile ödeme'}
    >
      <TotalRow total={total} />
      {method === 'cash' ? (
        <CashForm total={total} busy={busy} onConfirm={onConfirm} />
      ) : (
        <>
          <p className="text-text-2">
            Tutarı kart cihazından çekin, onaylanınca satışı tamamlayın.
          </p>
          {/* No autofocus: a stray Enter (an unread scan) must not complete a card sale. */}
          <Button variant="primary" size="lg" disabled={busy} onClick={() => onConfirm()}>
            Satışı tamamla
          </Button>
        </>
      )}
    </Dialog>
  );
}

function CashForm({
  total,
  busy,
  onConfirm,
}: {
  total: Kurus;
  busy: boolean;
  onConfirm(cashGiven: Kurus): void;
}): JSX.Element {
  const [given, setGiven] = useState('');
  const received = readAmount(given, total);
  const enough = received !== undefined && received >= total;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (enough && !busy) {
          onConfirm(received);
        }
      }}
    >
      <TextField
        label="Alınan tutar"
        hint="Boş bırakılırsa tam tutar alınmış sayılır."
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        value={given}
        onChange={(event) => setGiven(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {suggestCash(total).map((amount) => (
          <Button key={amount} onClick={() => setGiven(formatTRY(amount).replace('₺', ''))}>
            {formatTRY(amount)}
          </Button>
        ))}
      </div>
      {enough ? (
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Para üstü</span>
          <span data-testid="change" className="font-mono text-[22px] font-semibold text-success">
            {formatTRY(received - total)}
          </span>
        </div>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={!enough || busy}>
        Satışı tamamla
      </Button>
    </form>
  );
}

function TotalRow({ total }: { total: Kurus }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between rounded-control bg-bg px-4 py-3">
      <span className="font-medium">Toplam</span>
      <span className="font-mono text-[28px] font-semibold">{formatTRY(total)}</span>
    </div>
  );
}

/** An empty field means the exact total; an unreadable one gives nothing. */
function readAmount(text: string, total: Kurus): Kurus | undefined {
  if (text.trim() === '') {
    return total;
  }
  try {
    return parseTRY(text);
  } catch {
    return undefined;
  }
}
