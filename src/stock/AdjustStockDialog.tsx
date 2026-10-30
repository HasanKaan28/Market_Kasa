import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { ADJUST_REASONS, adjustStock, stockOf, type AdjustReason } from '@/data/stock';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, SelectField, TextField } from '@/design';
import { formatStock, parseQuantity } from '@/pos/format';

export type AdjustStockDialogProps = {
  open: boolean;
  product: ProductRecord;
  onClose(): void;
  onDone(message: string): void;
};

const DIRECTIONS = [
  { value: 1, label: 'Ekle' },
  { value: -1, label: 'Çıkar' },
] as const;

const REASON_OPTIONS = (Object.keys(ADJUST_REASONS) as AdjustReason[]).map((reason) => ({
  value: reason,
  label: ADJUST_REASONS[reason],
}));

/** Puts stock in or takes it out, with a reason, as a difference rather than a new total. */
export function AdjustStockDialog({
  open,
  product,
  onClose,
  onDone,
}: AdjustStockDialogProps): JSX.Element {
  const { db } = useData();
  const { cutoffMinutes } = useMarketSettings();
  const { staff } = useSession();
  const [direction, setDirection] = useState<1 | -1>(1);
  const [amount, setAmount] = useState('');
  // Until one is picked, the reason follows the direction: what comes in was found, what goes
  // out was wasted. A picked reason stays when the direction changes.
  const [pickedReason, setReason] = useState<AdjustReason>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const reason = pickedReason ?? (direction === 1 ? 'found' : 'waste');
  const current = useLiveQuery(() => stockOf(db, product.id), [db, product.id]);

  // A piece product whose stock was left fractional takes the fraction that makes it whole.
  const fractional = product.unit === 'piece' && current !== undefined && current % 1000 !== 0;
  const text = amount.trim();
  const qtyMilli = text === '' ? null : parseQuantity(text, fractional ? 'kg' : product.unit);
  const after =
    current !== undefined && qtyMilli !== null ? current + direction * qtyMilli : undefined;
  const error =
    text !== '' && qtyMilli === null
      ? product.unit === 'piece' && parseQuantity(text, 'kg') !== null
        ? 'Adet için tam sayı girin.'
        : 'Geçerli bir miktar girin.'
      : fractional && qtyMilli !== null && qtyMilli % 1000 !== 0 && (after ?? 0) % 1000 !== 0
        ? 'Kesirli miktar stoğu tam sayıya getirmeli.'
        : undefined;

  async function save() {
    if (qtyMilli === null) {
      return;
    }
    setBusy(true);
    try {
      await adjustStock(
        db,
        {
          productId: product.id,
          deltaMilli: direction * qtyMilli,
          reason,
          note,
          cutoffMinutes,
          staffId: staff?.id,
        },
        new Date(),
      );
      onDone('Stok düzeltildi.');
    } catch {
      setFailure('Stok düzeltilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Stoğu düzelt"
      description={product.name}
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup
          legend="Değişim"
          name="direction"
          options={DIRECTIONS}
          value={direction}
          onChange={(next) => setDirection(next)}
        />
        <TextField
          label="Miktar"
          hint={
            product.unit === 'kg'
              ? 'Kilogram'
              : fractional
                ? 'Adet. Stok kesirli; onu tam sayıya getiren kesirli miktar girilebilir.'
                : 'Adet'
          }
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={error}
          onChange={(event) => setAmount(event.target.value)}
        />
        <SelectField
          label="Neden"
          value={reason}
          options={REASON_OPTIONS}
          onChange={(event) => setReason(event.target.value as AdjustReason)}
        />
        <TextField
          label="Not"
          autoComplete="off"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {current !== undefined && after !== undefined ? (
          <p className="font-medium">
            {`Stok: ${formatStock(current, product.unit)} → ${formatStock(after, product.unit)}`}
          </p>
        ) : null}
        {after !== undefined && after < 0 ? (
          <p className="font-medium text-warning">Stok eksiye düşecek.</p>
        ) : null}
        {failure ? (
          <p role="alert" className="font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          disabled={busy || qtyMilli === null || error !== undefined}
          onClick={() => void save()}
        >
          Stoğu düzelt
        </Button>
      </div>
    </Dialog>
  );
}
