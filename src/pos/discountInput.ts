import { percentOf } from '@/domain/discount';
import { parseTRY, type Kurus } from '@/domain/money';

export type DiscountMode = 'amount' | 'percent';

/** A typed discount in kuruş (empty means none), or null when it cannot be read. */
export function readDiscount(text: string, mode: DiscountMode, base: Kurus): Kurus | null {
  const value = text.trim();
  if (value === '') {
    return 0;
  }
  if (mode === 'percent') {
    const percent = /^\d{1,3}$/.test(value) ? Number(value) : NaN;
    return percent >= 1 && percent <= 100 ? percentOf(base, percent) : null;
  }
  try {
    return parseTRY(value);
  } catch {
    return null;
  }
}
