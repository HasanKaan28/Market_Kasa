import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useApproval } from '@/app/useApproval';
import { createCustomer, updateCustomer } from '@/data/customers';
import type { CustomerRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY, parseTRY } from '@/domain/money';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { formatPriceInput } from '@/pos/format';

export type CustomerFormDialogProps = {
  open: boolean;
  /** The customer to edit; without one the form adds a new customer. */
  customer?: CustomerRecord;
  onClose(): void;
  /** Called with the message to show and the customer's id once saved. */
  onSaved(message: string, customerId: string): void;
};

type Errors = { name?: string; limit?: string; form?: string };

/** A credit customer's name, phone and limit; a limit of nothing means no limit. */
export function CustomerFormDialog({
  open,
  customer,
  onClose,
  onSaved,
}: CustomerFormDialogProps): JSX.Element {
  const { db } = useData();
  const approval = useApproval();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [limit, setLimit] = useState(
    customer && customer.creditLimit > 0 ? formatPriceInput(customer.creditLimit) : '',
  );
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Errors = {};
    if (name.trim() === '') {
      found.name = 'Ad gerekli.';
    }
    const creditLimit = readLimit(limit);
    if (typeof creditLimit === 'string') {
      found.limit = creditLimit;
    }
    if (Object.keys(found).length > 0 || typeof creditLimit === 'string') {
      setErrors(found);
      return;
    }
    setErrors({});
    const input = { name, phone, creditLimit };
    // Changing a customer's limit is a manager's call (DESIGN §8.5, limit aşımı onayı).
    if (customer && creditLimit !== customer.creditLimit) {
      approval.ask('overLimit', () => void store(input));
    } else {
      await store(input);
    }
  }

  async function store(input: { name: string; phone: string; creditLimit: number }) {
    setBusy(true);
    try {
      if (customer) {
        await updateCustomer(db, customer.id, input, new Date());
        onSaved('Müşteri kaydedildi.', customer.id);
      } else {
        const created = await createCustomer(db, input, new Date());
        onSaved('Müşteri eklendi.', created.id);
      }
    } catch {
      setErrors({ form: 'Müşteri kaydedilemedi.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title={customer ? 'Müşteriyi düzenle' : 'Yeni müşteri'}
      >
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
          <TextField
            label="Ad"
            autoFocus
            autoComplete="off"
            value={name}
            error={errors.name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Telefon"
            hint="WhatsApp hatırlatması bu numaraya gider."
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <TextField
            label="Limit"
            hint="Veresiye üst sınırı. Boş bırakılırsa sınır yok."
            inputMode="decimal"
            autoComplete="off"
            value={limit}
            error={errors.limit}
            onChange={(event) => setLimit(event.target.value)}
          />
          {errors.form ? (
            <p role="alert" className="font-medium text-danger">
              {errors.form}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            Kaydet
          </Button>
        </form>
      </Dialog>
      {approval.dialog}
    </>
  );
}

/** Nothing typed is no limit (0); otherwise the amount, or what is wrong with it. */
function readLimit(text: string): number | string {
  if (text.trim() === '') {
    return 0;
  }
  let amount: number;
  try {
    amount = parseTRY(text);
  } catch {
    return 'Geçerli bir tutar girin.';
  }
  return amount > MAX_UNIT_PRICE ? `Limit en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.` : amount;
}
