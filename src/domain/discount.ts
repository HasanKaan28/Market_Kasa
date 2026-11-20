import { assertSafeInteger, divRoundHalfUp, type Kurus } from './money';

/** A whole-number percentage (1–100) of an amount, rounded to the nearest kuruş. */
export function percentOf(amount: Kurus, percent: number): Kurus {
  assertSafeInteger(amount, 'Amount');
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new RangeError(`A percentage must be a whole number from 1 to 100, got ${percent}`);
  }
  return divRoundHalfUp(amount * percent, 100);
}
