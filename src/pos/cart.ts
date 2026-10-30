import { newId } from '@/data/ids';
import type { ProductRecord, ProductUnit } from '@/data/types';
import type { Kurus } from '@/domain/money';
import {
  computeCart,
  lineTotal,
  MAX_UNIT_PRICE,
  VAT_RATES,
  type CartTotals,
  type VatRate,
} from '@/domain/pricing';

export type CartLine = {
  productId: string;
  name: string;
  unit: ProductUnit;
  unitPrice: Kurus;
  vatRate: VatRate;
  qtyMilli: number;
  lineDiscount: Kurus;
};

/** The cart's id becomes the sale's id, so a repeated checkout cannot sell twice. */
export type Cart = { id: string; lines: CartLine[]; cartDiscount: Kurus };

export type CartAction =
  | { type: 'add'; product: ProductRecord }
  | { type: 'increment' | 'decrement' | 'remove'; productId: string }
  | { type: 'clear' }
  | { type: 'renew' }
  | { type: 'replace'; cart: Cart }
  | { type: 'refresh'; products: readonly ProductRecord[] }
  | { type: 'setQuantity'; productId: string; qtyMilli: number }
  | { type: 'setLineDiscount'; productId: string; amount: Kurus }
  | { type: 'setCartDiscount'; amount: Kurus };

/** Where the cart is kept between reloads; other tabs watch it through `storage` events. */
export const CART_STORAGE_KEY = 'mk2.cart';
const ONE = 1000;

export function emptyCart(id: string = newId()): Cart {
  return { id, lines: [], cartDiscount: 0 };
}

/** Applies an action, then trims any discount the new lines can no longer carry. */
export function cartReducer(cart: Cart, action: CartAction): Cart {
  return clampDiscounts(applyAction(cart, action));
}

function applyAction(cart: Cart, action: CartAction): Cart {
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
        unit: product.unit,
        unitPrice: product.sellPrice,
        vatRate: product.vatRate,
        qtyMilli: ONE,
        lineDiscount: 0,
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
    case 'renew':
      // Same lines under a new id, so a checkout cannot be mistaken for an earlier sale.
      return { ...cart, id: newId() };
    case 'replace':
      return action.cart;
    case 'refresh':
      return refreshLines(cart, action.products);
    case 'setQuantity':
      return withQuantity(cart, action.productId, action.qtyMilli);
    case 'setLineDiscount':
      return {
        ...cart,
        lines: cart.lines.map((line) =>
          line.productId === action.productId
            ? { ...line, lineDiscount: Math.max(0, action.amount) }
            : line,
        ),
      };
    case 'setCartDiscount':
      return { ...cart, cartDiscount: Math.max(0, action.amount) };
  }
}

export function cartTotals(cart: Cart): CartTotals {
  return computeCart(
    cart.lines.map(({ qtyMilli, unitPrice, vatRate, lineDiscount }) => ({
      qtyMilli,
      unitPrice,
      vatRate,
      lineDiscount,
    })),
    cart.cartDiscount,
  );
}

/** A line's total before any discount. */
export function lineGross(line: CartLine): Kurus {
  return lineTotal(line.qtyMilli, line.unitPrice);
}

/** What the cart discount may reach: the lines after their own discounts. */
export function discountBase(cart: Cart): Kurus {
  return cart.lines.reduce((sum, line) => sum + lineGross(line) - line.lineDiscount, 0);
}

/**
 * A smaller quantity or a lower price can leave a discount larger than what it applies to;
 * trims it, and returns the same cart when nothing needed trimming.
 */
function clampDiscounts(cart: Cart): Cart {
  let changed = false;
  const lines = cart.lines.map((line) => {
    const gross = lineGross(line);
    if (line.lineDiscount <= gross) {
      return line;
    }
    changed = true;
    return { ...line, lineDiscount: gross };
  });
  const trimmed = changed ? { ...cart, lines } : cart;
  const cartDiscount = Math.min(trimmed.cartDiscount, discountBase(trimmed));
  return cartDiscount === trimmed.cartDiscount ? trimmed : { ...trimmed, cartDiscount };
}

/** Keeps the cart across reloads; a full or blocked storage leaves it in memory only. */
export function saveCart(cart: Cart, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Nothing to do: the cart still works, it just will not survive a reload.
  }
}

export function loadCart(storage?: Pick<Storage, 'getItem'>): Cart {
  try {
    const raw = (storage ?? localStorage).getItem(CART_STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const cart = readCart(parsed);
    if (!cart) {
      return emptyCart();
    }
    cartTotals(cart); // throws for amounts too large to total exactly
    return cart;
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

/**
 * A stored cart checked field by field, or null. Carts saved before discounts and units existed
 * read as piece lines with no discounts.
 */
export function readCart(value: unknown): Cart | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { id, lines, cartDiscount = 0 } = value as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || !Array.isArray(lines) || !isAmount(cartDiscount)) {
    return null;
  }
  const read = lines.map(readLine);
  return read.every((line): line is CartLine => line !== null)
    ? { id, lines: read, cartDiscount }
    : null;
}

function readLine(value: unknown): CartLine | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const line = value as Record<string, unknown>;
  const { productId, name, unitPrice, vatRate, qtyMilli } = line;
  const unit = line.unit ?? 'piece';
  const lineDiscount = line.lineDiscount ?? 0;
  if (
    typeof productId !== 'string' ||
    typeof name !== 'string' ||
    (unit !== 'piece' && unit !== 'kg') ||
    !isAmount(unitPrice) ||
    unitPrice > MAX_UNIT_PRICE ||
    !(VAT_RATES as readonly unknown[]).includes(vatRate) ||
    !Number.isSafeInteger(qtyMilli) ||
    Number(qtyMilli) <= 0 ||
    !isAmount(lineDiscount)
  ) {
    return null;
  }
  return {
    productId,
    name,
    unit,
    unitPrice,
    vatRate: vatRate as VatRate,
    qtyMilli: Number(qtyMilli),
    lineDiscount,
  };
}

function isAmount(value: unknown): value is Kurus {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
