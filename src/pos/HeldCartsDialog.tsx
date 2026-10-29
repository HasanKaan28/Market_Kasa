import type { JSX } from 'react';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import { cartTotals } from './cart';
import { formatTime } from './format';
import type { HeldCart } from './held';

export type HeldCartsDialogProps = {
  open: boolean;
  held: readonly HeldCart[];
  onClose(): void;
  onResume(cartId: string): void;
};

export function HeldCartsDialog({
  open,
  held,
  onClose,
  onResume,
}: HeldCartsDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Bekleyen sepetler">
      {held.length === 0 ? (
        <p className="text-text-2">Bekleyen sepet yok</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {held.map(({ cart, heldAt }) => {
            const time = formatTime(heldAt);
            return (
              <li
                key={cart.id}
                className="flex items-center gap-3 rounded-control border border-line py-2 pr-2 pl-3"
              >
                <div className="flex flex-1 flex-col">
                  <span className="font-medium">{time}</span>
                  <span className="text-sm text-text-2">{`${cart.lines.length} kalem`}</span>
                </div>
                <span className="font-mono font-semibold">
                  {formatTRY(cartTotals(cart).total)}
                </span>
                <Button
                  variant="primary"
                  aria-label={`Devam et · ${time}`}
                  onClick={() => onResume(cart.id)}
                >
                  Devam et
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
