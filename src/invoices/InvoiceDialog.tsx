import { useRef, useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { InvoiceExistsError, SaleVoidedError } from '@/data/errors';
import { requestInvoice } from '@/data/invoices';
import type { InvoiceBuyer, InvoiceRecord, SaleRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { isValidTckn, isValidVkn } from '@/domain/taxId';

export type InvoiceDialogProps = {
  open: boolean;
  sale: SaleRecord;
  onClose(): void;
  onRequested(record: InvoiceRecord): void;
};

type Kind = InvoiceBuyer['kind'];
type Field = 'name' | 'tckn' | 'title' | 'vkn' | 'taxOffice' | 'address';
type Errors = Partial<Record<Field, string>>;

const KIND_OPTIONS = [
  { value: 'person', label: 'Bireysel' },
  { value: 'company', label: 'Kurumsal' },
] as const;

/** Asks for an e-Arşiv invoice on a sale: who it is made out to, checked before it is queued. */
export function InvoiceDialog({
  open,
  sale,
  onClose,
  onRequested,
}: InvoiceDialogProps): JSX.Element {
  const { db, settings } = useData();
  const { staff } = useSession();
  const [kind, setKind] = useState<Kind>('person');
  // Both forms keep what was typed, so switching back and forth loses nothing.
  const [fields, setFields] = useState<Record<Field, string>>({
    name: '',
    tckn: '',
    title: '',
    vkn: '',
    taxOffice: '',
    address: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const [saving, setSaving] = useState(false);
  // Guards a double click before the disabled state renders.
  const busy = useRef(false);

  function set(field: Field, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    const found = problems(kind, fields);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setFailure(undefined);
    try {
      const record = await requestInvoice(
        db,
        {
          saleId: sale.id,
          buyer: buyerOf(kind, fields),
          deviceCode: settings.deviceCode,
          staffId: staff?.id,
        },
        new Date(),
      );
      onRequested(record);
    } catch (caught) {
      setFailure(
        caught instanceof InvoiceExistsError
          ? 'Bu satışın zaten bir faturası var.'
          : caught instanceof SaleVoidedError
            ? 'İptal edilmiş satışa fatura kesilmez.'
            : 'Kaydedilemedi.',
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Fatura kes"
      description={`${sale.receiptNo} · ${formatTRY(sale.total)}`}
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <ChoiceGroup
          legend="Alıcı"
          name="invoice-buyer"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setErrors({});
          }}
        />
        {kind === 'person' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Ad soyad"
              autoComplete="off"
              autoFocus
              value={fields.name}
              error={errors.name}
              onChange={(event) => set('name', event.target.value)}
            />
            <TextField
              label="TCKN (isteğe bağlı)"
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              value={fields.tckn}
              error={errors.tckn}
              onChange={(event) => set('tckn', event.target.value.replace(/\D/g, ''))}
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Unvan"
              autoComplete="off"
              autoFocus
              value={fields.title}
              error={errors.title}
              onChange={(event) => set('title', event.target.value)}
            />
            <TextField
              label="VKN"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              value={fields.vkn}
              error={errors.vkn}
              onChange={(event) => set('vkn', event.target.value.replace(/\D/g, ''))}
            />
            <TextField
              label="Vergi dairesi"
              autoComplete="off"
              value={fields.taxOffice}
              error={errors.taxOffice}
              onChange={(event) => set('taxOffice', event.target.value)}
            />
            <AddressField
              value={fields.address}
              error={errors.address}
              onChange={(value) => set('address', value)}
            />
          </div>
        )}
        {failure ? (
          <p role="alert" className="font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={saving}>
          Fatura iste
        </Button>
      </form>
    </Dialog>
  );
}

/** A company's address, kept on as many lines as it was typed. */
function AddressField({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <label htmlFor="invoice-address" className="text-sm font-medium text-text">
        Adres
      </label>
      <textarea
        id="invoice-address"
        rows={3}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'invoice-address-error' : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-text"
      />
      {error ? (
        <p id="invoice-address-error" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function problems(kind: Kind, fields: Record<Field, string>): Errors {
  const found: Errors = {};
  if (kind === 'person') {
    if (fields.name.trim() === '') {
      found.name = 'Ad soyad gerekli.';
    }
    if (fields.tckn !== '' && !isValidTckn(fields.tckn)) {
      found.tckn = 'TCKN geçersiz.';
    }
    return found;
  }
  if (fields.title.trim() === '') {
    found.title = 'Unvan gerekli.';
  }
  if (!isValidVkn(fields.vkn)) {
    found.vkn = 'VKN geçersiz.';
  }
  if (fields.taxOffice.trim() === '') {
    found.taxOffice = 'Vergi dairesi gerekli.';
  }
  if (fields.address.trim() === '') {
    found.address = 'Adres gerekli.';
  }
  return found;
}

function buyerOf(kind: Kind, fields: Record<Field, string>): InvoiceBuyer {
  return kind === 'person'
    ? { kind, name: fields.name, ...(fields.tckn !== '' ? { tckn: fields.tckn } : {}) }
    : {
        kind,
        title: fields.title,
        vkn: fields.vkn,
        taxOffice: fields.taxOffice,
        address: fields.address,
      };
}
