import { CART_STORAGE_KEY, cartTotals, readCart, type Cart } from './cart';

/** A cart parked on this device; held carts are not synced. */
export type HeldCart = { cart: Cart; heldAt: string };

export const MAX_HELD = 10;

/** Where held carts live between reloads; other tabs watch it through `storage` events. */
export const HELD_STORAGE_KEY = 'mk2.held';

/** Parks a cart, newest first. The cart keeps its id, so it still sells only once. */
export function holdCart(held: readonly HeldCart[], cart: Cart, at: Date): HeldCart[] {
  if (cart.lines.length === 0) {
    throw new RangeError('An empty cart cannot be held');
  }
  if (held.length >= MAX_HELD) {
    throw new RangeError(`At most ${MAX_HELD} carts can be held`);
  }
  return [{ cart, heldAt: at.toISOString() }, ...held];
}

export function takeHeld(
  held: readonly HeldCart[],
  cartId: string,
): { cart: Cart; rest: HeldCart[] } {
  const found = held.find((entry) => entry.cart.id === cartId);
  if (!found) {
    throw new RangeError(`No held cart ${cartId}`);
  }
  return { cart: found.cart, rest: held.filter((entry) => entry !== found) };
}

export function saveHeld(held: readonly HeldCart[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(HELD_STORAGE_KEY, JSON.stringify(held));
  } catch {
    // Full or blocked storage: the held carts stay in memory for this session.
  }
}

/** The way out of a crash: forgets the stored cart and held carts, nothing else. */
export function clearStoredCarts(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    const target = storage ?? localStorage;
    target.removeItem(CART_STORAGE_KEY);
    target.removeItem(HELD_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing stored to clear.
  }
}

/** The stored held carts; unreadable storage gives none, and a broken entry is skipped. */
export function loadHeld(storage?: Pick<Storage, 'getItem'>): HeldCart[] {
  try {
    const raw = (storage ?? localStorage).getItem(HELD_STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.flatMap((entry) => readHeldCart(entry) ?? []).slice(0, MAX_HELD)
      : [];
  } catch {
    return [];
  }
}

function readHeldCart(value: unknown): HeldCart | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { cart: stored, heldAt } = value as Record<string, unknown>;
  const cart = readCart(stored);
  if (
    typeof heldAt !== 'string' ||
    Number.isNaN(Date.parse(heldAt)) ||
    !cart ||
    cart.lines.length === 0
  ) {
    return null;
  }
  try {
    cartTotals(cart);
    return { cart, heldAt };
  } catch {
    return null;
  }
}
