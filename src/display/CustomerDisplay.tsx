import { useEffect, useState, type JSX } from 'react';
import { Logo } from '@/design';
import { formatTRY } from '@/domain/money';
import { CART_STORAGE_KEY, cartTotals, lineGross, loadCart, type Cart } from '@/pos/cart';
import { formatLineQty } from '@/pos/format';

const SHOWN_LINES = 8;

/** The register's cart as it is now; it changes in the register's own window. */
function useRegisterCart(): Cart {
  const [cart, setCart] = useState(() => loadCart());
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY || event.key === null) {
        setCart(loadCart());
      }
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, []);
  return cart;
}

/**
 * The screen facing the customer: what has been rung up and what there is to pay, following the
 * register in its own window (a second monitor). It holds nothing of its own and reads no data
 * but the cart the register keeps on this device.
 */
export function CustomerDisplay({ marketName }: { marketName: string }): JSX.Element {
  const cart = useRegisterCart();
  let total: number | undefined;
  try {
    total = cartTotals(cart).total;
  } catch {
    total = undefined;
  }
  const lines = cart.lines.slice(-SHOWN_LINES);

  return (
    <main className="flex min-h-dvh flex-col gap-6 bg-bg p-8 text-text">
      <header className="flex items-center gap-4">
        <Logo className="size-14" />
        <h1 className="text-3xl font-semibold">{marketName}</h1>
      </header>
      {cart.lines.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-5xl font-semibold text-text-2">
          Hoş geldiniz
        </p>
      ) : (
        <>
          <ul className="flex flex-1 flex-col divide-y divide-line rounded-control border border-line bg-surface">
            {cart.lines.length > SHOWN_LINES ? (
              <li className="px-6 py-3 text-xl text-text-2">{`… ve ${cart.lines.length - SHOWN_LINES} ürün daha`}</li>
            ) : null}
            {lines.map((line) => (
              <li key={line.productId} className="flex items-baseline gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-medium break-words">{line.name}</p>
                  <p className="font-mono text-xl text-text-2">
                    {`${formatLineQty(line.qtyMilli, line.unit)} × ${formatTRY(line.unitPrice)}`}
                  </p>
                </div>
                <p className="font-mono text-2xl">
                  {formatTRY(lineGross(line) - line.lineDiscount)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between rounded-control bg-surface px-6 py-5">
            <span className="text-3xl font-semibold">Ödenecek</span>
            <span aria-label="Ödenecek" className="font-mono text-6xl font-bold">
              {total === undefined ? '—' : formatTRY(total)}
            </span>
          </div>
        </>
      )}
    </main>
  );
}
