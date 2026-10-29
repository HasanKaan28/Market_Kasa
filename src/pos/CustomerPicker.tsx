import { useLiveQuery } from 'dexie-react-hooks';
import { UserPlus } from 'lucide-react';
import { useRef, useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { createCustomer, customerBalance, searchCustomers } from '@/data/customers';
import type { CustomerRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';

export type CustomerPickerProps = {
  open: boolean;
  /** A payment is running: nothing can be picked or added until it ends. */
  busy?: boolean;
  onClose(): void;
  onPick(customer: CustomerRecord): void;
};

/** Picks the customer a credit sale is written to, or adds a new one on the spot. */
export function CustomerPicker({
  open,
  busy = false,
  onClose,
  onPick,
}: CustomerPickerProps): JSX.Element {
  const [adding, setAdding] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Veresiye müşterisi">
      {adding ? (
        <NewCustomerForm busy={busy} onPick={onPick} onCancel={() => setAdding(false)} />
      ) : (
        <CustomerSearch busy={busy} onPick={onPick} onAdd={() => setAdding(true)} />
      )}
    </Dialog>
  );
}

function CustomerSearch({
  busy,
  onPick,
  onAdd,
}: {
  busy: boolean;
  onPick(customer: CustomerRecord): void;
  onAdd(): void;
}): JSX.Element {
  const { db } = useData();
  const [query, setQuery] = useState('');
  const term = query.trim();
  const results = useLiveQuery(async () => {
    const customers = term === '' ? [] : await searchCustomers(db, term);
    return Promise.all(
      customers.map(async (customer) => ({
        customer,
        balance: await customerBalance(db, customer.id),
      })),
    );
  }, [db, term]);

  return (
    <>
      <TextField
        label="Müşteri ara"
        hint="Ad ya da telefon"
        type="search"
        autoComplete="off"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {term !== '' && results?.length === 0 ? <p className="text-text-2">Sonuç yok</p> : null}
      <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {results?.map(({ customer, balance }) => (
          <li key={customer.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(customer)}
              className="flex min-h-12 w-full items-center justify-between gap-3 rounded-control border border-line px-3 py-2 text-left hover:border-line-strong"
            >
              <span className="font-medium">{customer.name}</span>{' '}
              <span className="font-mono text-sm text-text-2">{formatTRY(balance)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button icon={<UserPlus aria-hidden="true" size={18} />} onClick={onAdd}>
        Yeni müşteri
      </Button>
    </>
  );
}

function NewCustomerForm({
  busy,
  onPick,
  onCancel,
}: {
  busy: boolean;
  onPick(customer: CustomerRecord): void;
  onCancel(): void;
}): JSX.Element {
  const { db } = useData();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  // The customer is created once: a double click or a retry after a failed sale reuses it.
  const created = useRef<CustomerRecord | null>(null);
  const saving = useRef(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) {
      return;
    }
    if (created.current) {
      onPick(created.current);
      return;
    }
    if (name.trim() === '') {
      setError('Müşteri adı gerekli.');
      return;
    }
    saving.current = true;
    try {
      created.current = await createCustomer(db, { name }, new Date());
      onPick(created.current);
    } finally {
      saving.current = false;
    }
  }

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void add(event)}>
      <TextField
        label="Müşteri adı"
        autoComplete="off"
        autoFocus
        value={name}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          created.current = null;
        }}
      />
      <div className="flex gap-2">
        <Button onClick={onCancel}>Vazgeç</Button>
        <Button type="submit" variant="primary" className="flex-1" disabled={busy}>
          Ekle
        </Button>
      </div>
    </form>
  );
}
