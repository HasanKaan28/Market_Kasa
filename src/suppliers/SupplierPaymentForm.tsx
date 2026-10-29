import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { recordSupplierPayment } from '@/data/supplierLedger';
import type { SupplierPaymentMethod } from '@/data/types';
import { Button, ChoiceGroup, TextField } from '@/design';
import { formatTRY, parseTRY } from '@/domain/money';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { formatPriceInput } from '@/pos/format';

const METHODS: readonly { value: SupplierPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'bank', label: 'Banka' },
  { value: 'card', label: 'Kart' },
  { value: 'cheque', label: 'Çek' },
];

/** A payment to the supplier: how much and how, filled with what is owed. */
export function SupplierPaymentForm({
  supplierId,
  balance,
  onSaved,
  onCancel,
}: {
  supplierId: string;
  balance: number;
  onSaved(message: string): void;
  onCancel(): void;
}): JSX.Element {
  const { db } = useData();
  const [amount, setAmount] = useState(balance > 0 ? formatPriceInput(balance) : '');
  const [method, setMethod] = useState<SupplierPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    let kurus: number;
    try {
      kurus = parseTRY(amount);
    } catch {
      setError('Geçerli bir tutar girin.');
      return;
    }
    if (kurus <= 0 || kurus > MAX_UNIT_PRICE) {
      setError(
        kurus <= 0
          ? 'Tutar sıfırdan büyük olmalı.'
          : `Tutar en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.`,
      );
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await recordSupplierPayment(db, { supplierId, amount: kurus, method, note }, new Date());
      onSaved(`Ödeme kaydedildi: ${formatTRY(kurus)}.`);
    } catch {
      setFailure('Ödeme kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Ödeme"
      noValidate
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <TextField
        label="Tutar"
        autoFocus
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        error={error}
        onChange={(event) => setAmount(event.target.value)}
      />
      <ChoiceGroup
        legend="Ödeme yolu"
        name="supplierPaymentMethod"
        wrap
        options={METHODS}
        value={method}
        onChange={(next) => setMethod(next)}
      />
      <TextField
        label="Not"
        hint="Dekont, çek numarası ya da başka bir not."
        autoComplete="off"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {failure ? (
        <p role="alert" className="font-medium text-danger">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Ödemeyi kaydet
        </Button>
        <Button onClick={onCancel}>Vazgeç</Button>
      </div>
    </form>
  );
}
