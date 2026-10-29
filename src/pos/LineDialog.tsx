import { useState, type FormEvent, type JSX } from 'react';
import { Button, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { lineTotal } from '@/domain/pricing';
import type { CartAction, CartLine } from './cart';
import { DiscountField } from './DiscountField';
import { readDiscount, type DiscountMode } from './discountInput';
import { formatQtyInput, parseQuantity } from './format';

export type LineDialogProps = {
  open: boolean;
  line: CartLine;
  onClose(): void;
  dispatch(action: CartAction): void;
  /** False for a person who may not give discounts: the line keeps the discount it has. */
  allowDiscount?: boolean;
};

type Errors = { quantity?: string; discount?: string };

/** Changes one cart line: its quantity (kilograms for weighed goods), its discount, or removes it. */
export function LineDialog({
  open,
  line,
  onClose,
  dispatch,
  allowDiscount = true,
}: LineDialogProps): JSX.Element {
  const [quantity, setQuantity] = useState(formatQtyInput(line.qtyMilli));
  const [mode, setMode] = useState<DiscountMode>('amount');
  const [discount, setDiscount] = useState(
    line.lineDiscount > 0 ? formatTRY(line.lineDiscount).replace('₺', '') : '',
  );
  const [errors, setErrors] = useState<Errors>({});

  const qtyMilli = parseQuantity(quantity, line.unit);
  const gross = qtyMilli === null ? null : lineTotal(qtyMilli, line.unitPrice);
  const amount = gross === null ? null : readDiscount(discount, mode, gross);
  const preview = gross !== null && amount !== null && amount <= gross ? gross - amount : null;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Errors = {};
    if (qtyMilli === null || gross === null) {
      found.quantity = 'Geçerli bir miktar girin.';
    } else if (amount === null) {
      found.discount = 'Geçerli bir indirim girin.';
    } else if (amount > gross) {
      found.discount = 'İndirim satır tutarını aşamaz.';
    }
    setErrors(found);
    if (found.quantity || found.discount || qtyMilli === null || amount === null) {
      return;
    }
    // Quantity first: the discount is then checked against the new line total.
    if (qtyMilli !== line.qtyMilli) {
      dispatch({ type: 'setQuantity', productId: line.productId, qtyMilli });
    }
    if (amount !== line.lineDiscount) {
      dispatch({ type: 'setLineDiscount', productId: line.productId, amount });
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={line.name}>
      <form noValidate className="flex flex-col gap-4" onSubmit={save}>
        <p className="font-mono text-sm text-text-2">
          {`${formatTRY(line.unitPrice)}${line.unit === 'kg' ? ' / kg' : ''}`}
        </p>
        <TextField
          label={line.unit === 'kg' ? 'Miktar (kg)' : 'Miktar'}
          inputMode={line.unit === 'kg' ? 'decimal' : 'numeric'}
          autoComplete="off"
          autoFocus
          value={quantity}
          error={errors.quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        {allowDiscount ? (
          <DiscountField
            mode={mode}
            value={discount}
            error={errors.discount}
            onModeChange={setMode}
            onChange={setDiscount}
          />
        ) : null}
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Satır tutarı</span>
          <span data-testid="line-total" className="font-mono text-[22px] font-semibold">
            {preview === null ? '—' : formatTRY(preview)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="danger"
            onClick={() => {
              dispatch({ type: 'remove', productId: line.productId });
              onClose();
            }}
          >
            Satırı sil
          </Button>
          <Button type="submit" variant="primary">
            Kaydet
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
