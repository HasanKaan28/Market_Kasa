import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { DuplicateSupplierError } from '@/data/errors';
import { createSupplier, updateSupplier } from '@/data/suppliers';
import type { SupplierRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';

export type SupplierFormDialogProps = {
  open: boolean;
  /** The supplier to edit; without one the form adds a new supplier. */
  supplier?: SupplierRecord;
  onClose(): void;
  /** Called with the message to show and the supplier's id once saved. */
  onSaved(message: string, supplierId: string): void;
};

type Errors = { name?: string; form?: string };

/** A supplier's name, phone and tax details. */
export function SupplierFormDialog({
  open,
  supplier,
  onClose,
  onSaved,
}: SupplierFormDialogProps): JSX.Element {
  const { db } = useData();
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [taxNo, setTaxNo] = useState(supplier?.taxNo ?? '');
  const [taxOffice, setTaxOffice] = useState(supplier?.taxOffice ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '') {
      setErrors({ name: 'Ad gerekli.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const input = { name, phone, taxNo, taxOffice };
      if (supplier) {
        await updateSupplier(db, supplier.id, input, new Date());
        onSaved('Tedarikçi kaydedildi.', supplier.id);
      } else {
        const created = await createSupplier(db, input, new Date());
        onSaved('Tedarikçi eklendi.', created.id);
      }
    } catch (error) {
      setErrors(
        error instanceof DuplicateSupplierError
          ? { name: 'Bu adla bir tedarikçi var.' }
          : { form: 'Tedarikçi kaydedilemedi.' },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={supplier ? 'Tedarikçiyi düzenle' : 'Yeni tedarikçi'}
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
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Vergi no"
            inputMode="numeric"
            autoComplete="off"
            value={taxNo}
            onChange={(event) => setTaxNo(event.target.value)}
          />
          <TextField
            label="Vergi dairesi"
            autoComplete="off"
            value={taxOffice}
            onChange={(event) => setTaxOffice(event.target.value)}
          />
        </div>
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
  );
}
