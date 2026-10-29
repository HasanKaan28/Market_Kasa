import { newId } from '@/data/ids';
import type { ProductRecord } from '@/data/types';
import type { Kurus } from '@/domain/money';
import { computeCart, VAT_RATES, type CartTotals, type VatRate } from '@/domain/pricing';

export type CartLine = {
  productId: string;
  name: string;
  unitPrice: Kurus;
  vatRate: VatRate;
  qtyMilli: number;
};

/** The cart's id becomes the sale's id, so a repeated checkout cannot sell twice. */
export type Cart = { id: string; lines: CartLine[] };

export type CartAction =
  | { type: 'add'; product: ProductRecord }
  | { type: 'increment' | 'decrement' | 'remove'; productId: string }
  | { type: 'clear' }
  | { type: 'refresh'; products: readonly ProductRecord[] };

const STORAGE_KEY = 'mk2.cart';
const ONE = 1000;

export function emptyCart(id: string = newId()): Cart {
  return { id, lines: [] };
}

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'add': {
      const { product } = action;
      const line = findLine(cart, product.id);
      if (line) {
        return withQuantity(cart, product.id, line.qtyMilli + ONE);
      }
      const added: CartLine = {
        productId: product.id,
        name: product.name,
        unitPrice: product.sellPrice,
        vatRate: product.vatRate,
        qtyMilli: ONE,
      };
      return { ...cart, lines: [...cart.lines, added] };
    }
    case 'increment':
    case 'decrement': {
      const line = findLine(cart, action.productId);
      const step = action.type === 'increment' ? ONE : -ONE;
      return line ? withQuantity(cart, action.productId, line.qtyMilli + step) : cart;
    }
    case 'remove':
      return withQuantity(cart, action.productId, 0);
    case 'clear':
      return emptyCart();
    case 'refresh':
      return refreshLines(cart, action.products);
  }
}

export function cartTotals(cart: Cart): CartTotals {
  return computeCart(
    cart.lines.map(({ qtyMilli, unitPrice, vatRate }) => ({ qtyMilli, unitPrice, vatRate })),
  );
}

/** Keeps the cart across reloads; a full or blocked storage leaves it in memory only. */
export function saveCart(cart: Cart, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Nothing to do: the cart still works, it just will not survive a reload.
  }
}

export function loadCart(storage?: Pick<Storage, 'getItem'>): Cart {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return isCart(parsed) ? parsed : emptyCart();
  } catch {
    return emptyCart();
  }
}

function findLine(cart: Cart, productId: string): CartLine | undefined {
  return cart.lines.find((line) => line.productId === productId);
}

function withQuantity(cart: Cart, productId: string, qtyMilli: number): Cart {
  const lines =
    qtyMilli <= 0
      ? cart.lines.filter((line) => line.productId !== productId)
      : cart.lines.map((line) => (line.productId === productId ? { ...line, qtyMilli } : line));
  return { ...cart, lines };
}

/** Copies current names and prices into the lines; returns the same cart when nothing changed. */
function refreshLines(cart: Cart, products: readonly ProductRecord[]): Cart {
  const byId = new Map(products.map((product) => [product.id, product]));
  let changed = false;
  const lines = cart.lines.map((line) => {
    const product = byId.get(line.productId);
    if (
      !product ||
      (product.name === line.name &&
        product.sellPrice === line.unitPrice &&
        product.vatRate === line.vatRate)
    ) {
      return line;
    }
    changed = true;
    return { ...line, name: product.name, unitPrice: product.sellPrice, vatRate: product.vatRate };
  });
  return changed ? { ...cart, lines } : cart;
}

function isCart(value: unknown): value is Cart {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { id, lines } = value as Record<string, unknown>;
  return typeof id === 'string' && id !== '' && Array.isArray(lines) && lines.every(isLine);
}

function isLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const line = value as Record<string, unknown>;
  return (
    typeof line.productId === 'string' &&
    typeof line.name === 'string' &&
    Number.isSafeInteger(line.unitPrice) &&
    (VAT_RATES as readonly unknown[]).includes(line.vatRate) &&
    Number.isSafeInteger(line.qtyMilli) &&
    Number(line.qtyMilli) > 0
  );
}
