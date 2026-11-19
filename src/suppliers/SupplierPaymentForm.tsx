import { istanbulToday } from '@/data/dates';
import { useState, type JSX } from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { correctSupplierPayment } from '@/data/corrections';
import { documentDay, recordSupplierPayment } from '@/data/supplierLedger';
import type { SupplierLedgerRecord, SupplierPaymentMethod } from '@/data/types';
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

/**
 * A payment to the supplier: how much and how, filled with what is owed. Given a payment to
 * correct, it is filled with that payment instead, and saving it asks first, showing the old
 * amount beside the new: the old payment is then taken back and the new one recorded.
 */
export function SupplierPaymentForm({
  supplierId,
  balance,
  correcting,
  onSaved,
  onCancel,
}: {
  supplierId: string;
  balance: number;
  correcting?: SupplierLedgerRecord;
  onSaved(message: string): void;
  onCancel(): void;
}): JSX.Element {
  const { db, settings } = useData();
  const actor = useActor();
  const { staff } = useSession();
  const { cutoffMinutes } = useMarketSettings();
  const [amount, setAmount] = useState(() =>
    correcting
      ? formatPriceInput(-correcting.amount)
      : balance > 0
        ? formatPriceInput(balance)
        : '',
  );
  const [method, setMethod] = useState<SupplierPaymentMethod>(correcting?.method ?? 'cash');
  const [fromDrawer, setFromDrawer] = useState(true);
  const [note, setNote] = useState(correcting?.note ?? '');
  const [paidOn, setPaidOn] = useState(correcting ? documentDay(correcting) : '');
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  // The corrected amount waiting for a yes.
  const [confirming, setConfirming] = useState<number>();

  // A box changed after "Onayla" asks again, so what is confirmed is what is on the screen.
  function edit(change: () => void) {
    change();
    setConfirming(undefined);
  }

  async function correct(old: SupplierLedgerRecord, kurus: number) {
    setBusy(true);
    setFailure(undefined);
    try {
      await correctSupplierPayment(
        db,
        {
          entryId: old.id,
          input: {
            deviceCode: settings.deviceCode,
            staffId: staff?.id,
            cutoffMinutes,
            amount: kurus,
            method,
            ...(method === 'cash' ? { fromDrawer } : {}),
            ...(paidOn ? { paidOn } : {}),
            note,
          },
        },
        new Date(),
        actor,
      );
      onSaved(`Ödeme düzeltildi: ${formatTRY(kurus)}.`);
    } catch {
      setConfirming(undefined);
      setFailure('Ödeme düzeltilemedi. Hiçbir şey değişmedi.');
    } finally {
      setBusy(false);
    }
  }

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
    if (correcting) {
      setConfirming(kurus);
      return;
    }
    setBusy(true);
    try {
      await recordSupplierPayment(
        db,
        {
          deviceCode: settings.deviceCode,
          staffId: staff?.id,
          cutoffMinutes,
          supplierId,
          amount: kurus,
          method,
          ...(method === 'cash' ? { fromDrawer } : {}),
          ...(paidOn ? { paidOn } : {}),
          note,
        },
        new Date(),
      );
      onSaved(`Ödeme kaydedildi: ${formatTRY(kurus)}.`);
    } catch {
      setFailure('Ödeme kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={correcting ? 'Ödemeyi düzelt' : 'Ödeme'}
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
        onChange={(event) => edit(() => setAmount(event.target.value))}
      />
      <ChoiceGroup
        legend="Ödeme yolu"
        name="supplierPaymentMethod"
        wrap
        options={METHODS}
        value={method}
        onChange={(next) => edit(() => setMethod(next))}
      />
      {method === 'cash' ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={fromDrawer}
            onChange={(event) => edit(() => setFromDrawer(event.target.checked))}
            className="size-5 accent-accent"
          />
          Kasadan ödendi
        </label>
      ) : null}
      <TextField
        label="Ödeme tarihi"
        hint="Boş bırakılırsa bugün."
        type="date"
        max={istanbulToday()}
        value={paidOn}
        onChange={(event) => edit(() => setPaidOn(event.target.value))}
      />
      <TextField
        label="Not"
        hint="Dekont, çek numarası ya da başka bir not."
        autoComplete="off"
        value={note}
        onChange={(event) => edit(() => setNote(event.target.value))}
      />
      {failure ? (
        <p role="alert" className="font-medium text-danger">
          {failure}
        </p>
      ) : null}
      {correcting && confirming !== undefined ? (
        <div className="flex flex-col gap-2 rounded-control border border-line-strong p-3">
          <p className="font-medium">Ödeme bu haliyle düzeltilsin mi?</p>
          <p>{`Eski tutar: ${formatTRY(-correcting.amount)}`}</p>
          <p className="font-semibold">{`Yeni tutar: ${formatTRY(confirming)}`}</p>
          <p className="text-sm text-text-2">
            Eski ödeme geri alınır, yenisi kaydedilir. Nakit kasadan ödendiyse kasaya geri girer.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void correct(correcting, confirming)}
            >
              Evet, düzelt
            </Button>
            <Button onClick={() => setConfirming(undefined)}>Geri dön</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {correcting ? 'Onayla' : 'Ödemeyi kaydet'}
          </Button>
          <Button onClick={onCancel}>Vazgeç</Button>
        </div>
      )}
    </form>
  );
}
