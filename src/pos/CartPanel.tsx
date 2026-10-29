import { Minus, Plus, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import type { PaymentMethod } from '@/data/types';
import { Button } from '@/design';
import { formatTRY } from '@/domain/money';
import {
  cartTotals,
  discountBase,
  lineGross,
  type Cart,
  type CartAction,
  type CartLine,
} from './cart';

export type CartPanelProps = {
  cart: Cart;
  dispatch(action: CartAction): void;
  onPay(method: PaymentMethod | 'split'): void;
  onEditLine(productId: string): void;
  onDiscount(): void;
};

export function CartPanel({
  cart,
  dispatch,
  onPay,
  onEditLine,
  onDiscount,
}: CartPanelProps): JSX.Element {
  const totals = cartTotals(cart);
  const empty = cart.lines.length === 0;
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line py-2 pr-2 pl-4">
        <h2 className="text-[17px] font-semibold">Sepet</h2>
        <div className="flex items-center gap-1">
          <span className="text-sm text-text-2">{`${cart.lines.length} kalem`}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sepeti temizle"
            disabled={empty}
            icon={<Trash2 aria-hidden="true" size={18} />}
            onClick={() => dispatch({ type: 'clear' })}
          />
        </div>
      </header>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-9 text-center text-text-2">
          <p className="font-semibold text-text">Sepet boş</p>
          <p>Barkod okutun ya da ürün seçin.</p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-line overflow-y-auto">
          {cart.lines.map((line) => (
            <CartRow key={line.productId} line={line} dispatch={dispatch} onEdit={onEditLine} />
          ))}
        </ul>
      )}

      <dl className="flex flex-col gap-1.5 border-t border-line px-4 py-3">
        {/* Rows show their own discount only, so rows, Ara toplam, Sepet indirimi and Toplam
            add up as written; VAT is included in the prices and shown for information. */}
        <div className="flex justify-between text-text-2">
          <dt>Ara toplam</dt>
          <dd data-testid="subtotal" className="font-mono">
            {formatTRY(discountBase(cart))}
          </dd>
        </div>
        {cart.cartDiscount > 0 ? (
          <div className="flex justify-between text-success">
            <dt>Sepet indirimi</dt>
            <dd data-testid="cart-discount" className="font-mono">
              {`−${formatTRY(cart.cartDiscount)}`}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between">
          <dt className="text-[17px] font-semibold">Toplam</dt>
          <dd data-testid="total" className="font-mono text-[28px] font-semibold">
            {formatTRY(totals.total)}
          </dd>
        </div>
        <div className="flex justify-between text-sm text-muted">
          <dt>KDV (dahil)</dt>
          <dd data-testid="vat" className="font-mono">
            {formatTRY(totals.vatTotal)}
          </dd>
        </div>
      </dl>

      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <Button
          variant="primary"
          size="lg"
          kbd="F2"
          className="col-span-2"
          disabled={empty}
          onClick={() => onPay('cash')}
        >
          Nakit
        </Button>
        <Button size="lg" kbd="F4" disabled={empty} onClick={() => onPay('card')}>
          Kart
        </Button>
        <Button size="lg" disabled={empty} onClick={() => onPay('credit')}>
          Veresiye
        </Button>
        <Button size="lg" disabled={empty} onClick={() => onPay('split')}>
          Bölünmüş
        </Button>
        <Button size="lg" disabled={empty} onClick={onDiscount}>
          İndirim
        </Button>
      </div>
    </div>
  );
}

function CartRow({
  line,
  dispatch,
  onEdit,
}: {
  line: CartLine;
  dispatch(action: CartAction): void;
  onEdit(productId: string): void;
}): JSX.Element {
  const quantity = (line.qtyMilli / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
  return (
    <li className="flex items-center gap-2 py-2 pr-4 pl-4">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-label={`Düzenle · ${line.name}`}
          onClick={() => onEdit(line.productId)}
          className="block max-w-full truncate text-left font-medium underline-offset-2 hover:underline"
        >
          {line.name}
        </button>
        <p className="font-mono text-sm text-text-2">{`${quantity} × ${formatTRY(line.unitPrice)}`}</p>
        {line.lineDiscount > 0 ? (
          <p className="text-sm text-success">{`İndirim −${formatTRY(line.lineDiscount)}`}</p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Azalt"
        icon={<Minus aria-hidden="true" size={18} />}
        onClick={() => dispatch({ type: 'decrement', productId: line.productId })}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Artır"
        icon={<Plus aria-hidden="true" size={18} />}
        onClick={() => dispatch({ type: 'increment', productId: line.productId })}
      />
      <p
        data-testid={`line-total-${line.productId}`}
        className="w-24 text-right font-mono font-semibold"
      >
        {formatTRY(lineGross(line) - line.lineDiscount)}
      </p>
    </li>
  );
}
