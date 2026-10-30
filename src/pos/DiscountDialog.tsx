import { useState, type FormEvent, type JSX } from 'react';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import { discountBase, type Cart, type CartAction } from './cart';
import { DiscountField } from './DiscountField';
import { readDiscount, type DiscountMode } from './discountInput';

export type DiscountDialogProps = {
  open: boolean;
  cart: Cart;
  onClose(): void;
  dispatch(action: CartAction): void;
};

/** A discount on the whole cart, spread over the lines when the sale is recorded. */
export function DiscountDialog({
  open,
  cart,
  onClose,
  dispatch,
}: DiscountDialogProps): JSX.Element {
  const [mode, setMode] = useState<DiscountMode>('amount');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const base = discountBase(cart);
  const amount = readDiscount(value, mode, base);
  const preview = amount !== null && amount <= base ? base - amount : null;

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amount === null) {
      setError('Geçerli bir indirim girin.');
      return;
    }
    if (amount > base) {
      setError('İndirim toplamı aşamaz.');
      return;
    }
    dispatch({ type: 'setCartDiscount', amount });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Sepet indirimi">
      <form noValidate className="flex flex-col gap-4" onSubmit={apply}>
        <DiscountField
          mode={mode}
          value={value}
          error={error}
          onModeChange={setMode}
          onChange={setValue}
        />
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Yeni toplam</span>
          <span data-testid="discounted-total" className="font-mono text-[22px] font-semibold">
            {preview === null ? '—' : formatTRY(preview)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {cart.cartDiscount > 0 ? (
            <Button
              onClick={() => {
                dispatch({ type: 'setCartDiscount', amount: 0 });
                onClose();
              }}
            >
              İndirimi kaldır
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary">
            Uygula
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
