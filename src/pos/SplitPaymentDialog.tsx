import { useState, type FormEvent, type JSX } from 'react';
import type { CustomerRecord, Payment, PaymentMethod } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY, parseTRY, type Kurus } from '@/domain/money';
import { CustomerPicker } from './CustomerPicker';
import { PAYMENT_LABELS } from './format';

export type SplitPaymentInput = { payments: Payment[]; cashGiven?: Kurus; customerId?: string };

export type SplitPaymentDialogProps = {
  open: boolean;
  total: Kurus;
  busy?: boolean;
  onClose(): void;
  onConfirm(input: SplitPaymentInput): void;
};

const METHODS: readonly PaymentMethod[] = ['cash', 'card', 'credit'];

/** An empty field is nothing; an unreadable one is null. */
function readAmount(text: string): Kurus | null {
  if (text.trim() === '') {
    return 0;
  }
  try {
    return parseTRY(text);
  } catch {
    return null;
  }
}

function asField(amount: Kurus): string {
  return formatTRY(amount).replace('₺', '');
}

/** One sale paid in parts: cash, card and credit add up to the total before it can be completed. */
export function SplitPaymentDialog({
  open,
  total,
  busy = false,
  onClose,
  onConfirm,
}: SplitPaymentDialogProps): JSX.Element {
  const [parts, setParts] = useState<Record<PaymentMethod, string>>({
    cash: '',
    card: '',
    credit: '',
  });
  const [given, setGiven] = useState('');
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [picking, setPicking] = useState(false);

  const amounts = METHODS.map((method) => ({ method, amount: readAmount(parts[method]) }));
  const readable = amounts.every((part) => part.amount !== null);
  const amountOf = (method: PaymentMethod) =>
    amounts.find((part) => part.method === method)?.amount ?? 0;
  const remaining = total - amounts.reduce((sum, part) => sum + (part.amount ?? 0), 0);
  const cash = amountOf('cash');
  const credit = amountOf('credit');
  const cashGiven = given.trim() === '' ? undefined : readAmount(given);
  const cashOk = cash === 0 || cashGiven === undefined || (cashGiven !== null && cashGiven >= cash);
  const needsCustomer = credit > 0 && customer === null;
  const ready = readable && remaining === 0 && cashOk && !needsCustomer && !busy;

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) {
      return;
    }
    const payments = amounts.flatMap(({ method, amount }) =>
      amount !== null && amount > 0 ? [{ method, amount }] : [],
    );
    onConfirm({
      payments,
      ...(cash > 0 && cashGiven !== undefined && cashGiven !== null ? { cashGiven } : {}),
      ...(credit > 0 && customer ? { customerId: customer.id } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Bölünmüş ödeme">
      <form noValidate className="flex flex-col gap-4" onSubmit={confirm}>
        <div className="flex items-baseline justify-between rounded-control bg-bg px-4 py-3">
          <span className="font-medium">Toplam</span>
          <span className="font-mono text-[28px] font-semibold">{formatTRY(total)}</span>
        </div>
        {METHODS.map((method) => (
          <div key={method} className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={PAYMENT_LABELS[method]}
                inputMode="decimal"
                autoComplete="off"
                value={parts[method]}
                error={amountOf(method) === null ? 'Geçerli bir tutar girin.' : undefined}
                onChange={(event) => setParts({ ...parts, [method]: event.target.value })}
              />
            </div>
            <Button
              aria-label={`Kalanı ekle · ${PAYMENT_LABELS[method]}`}
              disabled={!readable || remaining <= 0}
              onClick={() =>
                setParts({ ...parts, [method]: asField((amountOf(method) ?? 0) + remaining) })
              }
            >
              Kalanı ekle
            </Button>
          </div>
        ))}
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Kalan</span>
          <span data-testid="remaining" className="font-mono text-[22px] font-semibold">
            {formatTRY(remaining)}
          </span>
        </div>
        {credit > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <span className={customer ? 'font-medium' : 'font-medium text-danger'}>
              {customer ? `Müşteri: ${customer.name}` : 'Veresiye için müşteri seçin.'}
            </span>
            <Button onClick={() => setPicking(true)}>
              {customer ? 'Müşteriyi değiştir' : 'Müşteri seç'}
            </Button>
          </div>
        ) : null}
        {cash > 0 ? (
          <>
            <TextField
              label="Alınan nakit"
              hint="İsteğe bağlı; para üstü için."
              inputMode="decimal"
              autoComplete="off"
              value={given}
              onChange={(event) => setGiven(event.target.value)}
            />
            {cashGiven !== undefined && cashGiven !== null && cashGiven >= cash ? (
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Para üstü</span>
                <span
                  data-testid="change"
                  className="font-mono text-[22px] font-semibold text-success"
                >
                  {formatTRY(cashGiven - cash)}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={!ready}>
          Satışı tamamla
        </Button>
      </form>
      {picking ? (
        <CustomerPicker
          open
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setCustomer(picked);
            setPicking(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}
