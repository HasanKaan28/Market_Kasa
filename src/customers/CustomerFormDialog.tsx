import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
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

/**
 * A credit customer's name, phone and limit; a limit of nothing means no limit. Someone who may not
 * approve going over a limit adds a customer with the market's limit for new customers; no limit,
 * or a higher one, then needs a permitted person's approval.
 */
export function CustomerFormDialog({
  open,
  customer,
  onClose,
  onSaved,
}: CustomerFormDialogProps): JSX.Element {
  const { db } = useData();
  const session = useSession();
  const approval = useApproval();
  const { newCustomerLimit } = useMarketSettings();
  // A new customer added by someone without the limit permission starts at the market's limit.
  const capped = !customer && !session.can('overLimit');
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  // Null until typed in: until then the box follows the market's limit as it loads.
  const [typedLimit, setLimit] = useState<string | null>(
    customer ? (customer.creditLimit > 0 ? formatPriceInput(customer.creditLimit) : '') : null,
  );
  const limit = typedLimit ?? (capped ? formatPriceInput(newCustomerLimit) : '');
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
    const limitText = creditLimit === 0 ? 'limit yok' : `limit ${formatTRY(creditLimit)}`;
    // Changing a customer's limit is a manager's call (DESIGN §8.5, limit aşımı onayı); so is a
    // new customer with no limit, or one above the market's limit for new customers.
    if (customer && creditLimit !== customer.creditLimit) {
      approval.ask('overLimit', () => void store(input), {
        entity: 'customer',
        entityId: customer.id,
        amount: creditLimit,
        summary: `${customer.name}: ${limitText}`,
      });
    } else if (!customer && (creditLimit === 0 || creditLimit > newCustomerLimit)) {
      approval.ask('overLimit', () => void store(input), {
        entity: 'customer',
        amount: creditLimit,
        summary: `Yeni müşteri ${name.trim()}: ${limitText}`,
      });
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
            hint={
              capped
                ? 'Veresiye üst sınırı. Boş bırakmak ya da artırmak yetkili onayı ister.'
                : 'Veresiye üst sınırı. Boş bırakılırsa sınır yok.'
            }
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
