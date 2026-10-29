import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { recordPayment } from '@/data/ledger';
import type { LedgerMethod } from '@/data/types';
import { Button, ChoiceGroup, TextField } from '@/design';
import { formatTRY, parseTRY } from '@/domain/money';
import { MAX_UNIT_PRICE } from '@/domain/pricing';
import { formatPriceInput } from '@/pos/format';

const METHODS: readonly { value: LedgerMethod; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
];

const DIRECTIONS = [
  { value: 1, label: 'Borç ekle' },
  { value: -1, label: 'Borç düş' },
] as const;

type FormProps = {
  customerId: string;
  onSaved(message: string): void;
  onCancel(): void;
};

/** A payment from the customer: how much, in cash or by card, filled with what is owed. */
export function PaymentForm({
  customerId,
  balance,
  onSaved,
  onCancel,
}: FormProps & { balance: number }): JSX.Element {
  const { db } = useData();
  const [amount, setAmount] = useState(balance > 0 ? formatPriceInput(balance) : '');
  const [method, setMethod] = useState<LedgerMethod>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    const kurus = readAmount(amount);
    if (typeof kurus === 'string') {
      setError(kurus);
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await recordPayment(db, { customerId, amount: kurus, method, note }, new Date());
      onSaved(`Tahsilat alındı: ${formatTRY(kurus)}.`);
    } catch {
      setFailure('Tahsilat kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Tahsilat"
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
        legend="Ödeme"
        name="paymentMethod"
        options={METHODS}
        value={method}
        onChange={(next) => setMethod(next)}
      />
      <TextField
        label="Not"
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
          Tahsilatı kaydet
        </Button>
        <Button onClick={onCancel}>Vazgeç</Button>
      </div>
    </form>
  );
}

/** A hand-written change to the debt, up or down, always with its reason; `save` writes it. */
export function AdjustmentForm({
  save,
  onSaved,
  onCancel,
}: {
  save(amount: number, reason: string): Promise<unknown>;
  onSaved(message: string): void;
  onCancel(): void;
}): JSX.Element {
  const [direction, setDirection] = useState<1 | -1>(1);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const kurus = readAmount(amount);
    const found = {
      ...(typeof kurus === 'string' ? { amount: kurus } : {}),
      ...(reason.trim() === '' ? { reason: 'Neden yazın.' } : {}),
    };
    setErrors(found);
    if (typeof kurus === 'string' || Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    try {
      await save(direction * kurus, reason);
      onSaved('Düzeltme kaydedildi.');
    } catch {
      setFailure('Düzeltme kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Düzeltme"
      noValidate
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ChoiceGroup
        legend="Yön"
        name="adjustmentDirection"
        options={DIRECTIONS}
        value={direction}
        onChange={(next) => setDirection(next)}
      />
      <TextField
        label="Tutar"
        autoFocus
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        error={errors.amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <TextField
        label="Neden"
        autoComplete="off"
        value={reason}
        error={errors.reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {failure ? (
        <p role="alert" className="font-medium text-danger">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Düzeltmeyi kaydet
        </Button>
        <Button onClick={onCancel}>Vazgeç</Button>
      </div>
    </form>
  );
}

/** An amount above zero and within the price limit, or what is wrong with it. */
function readAmount(text: string): number | string {
  let kurus: number;
  try {
    kurus = parseTRY(text);
  } catch {
    return 'Geçerli bir tutar girin.';
  }
  if (kurus <= 0) {
    return 'Tutar sıfırdan büyük olmalı.';
  }
  return kurus > MAX_UNIT_PRICE ? `Tutar en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.` : kurus;
}
