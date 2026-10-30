export type Kurus = number;

export class MoneyParseError extends Error {
  constructor(input: string) {
    super(`Geçersiz tutar: "${input}"`);
    this.name = 'MoneyParseError';
  }
}

const TRY_FORMAT = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

/** Guards the "no fractional kuruş or quantities" rule at every domain entry point. */
export function assertSafeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a safe integer, got ${value}`);
  }
}

export function formatTRY(k: Kurus): string {
  assertSafeInteger(k, 'Kuruş');
  // k === 0 also catches -0, which Intl would print as "-₺0,00".
  return TRY_FORMAT.format(k === 0 ? 0 : k / 100);
}

/** Integer division rounded to the nearest integer, halves away from zero. */
export function divRoundHalfUp(n: number, d: number): number {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d <= 0) {
    throw new RangeError(`Expected an integer and a positive integer divisor, got ${n} / ${d}`);
  }
  if (n < 0) {
    const magnitude = divRoundHalfUp(-n, d);
    return magnitude === 0 ? 0 : -magnitude;
  }
  return Math.floor((2 * n + d) / (2 * d));
}

const CURRENCY_MARKS = /₺|tl/gi;

/**
 * Reads an amount typed the Turkish way ("1.234,50") or with a dot as the decimal mark ("12.50").
 * A dot followed by exactly three digits is a thousands separator ("1.250" is 1250 TL).
 */
export function parseTRY(input: string): Kurus {
  const text = input.replace(CURRENCY_MARKS, '').replace(/\s+/g, '');
  if (!/^[\d.,]+$/.test(text)) {
    throw new MoneyParseError(input);
  }
  const [whole, fraction] = splitWholeAndFraction(text, input);
  if (!/^\d+$/.test(whole)) {
    throw new MoneyParseError(input);
  }
  const kurus = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kurus)) {
    throw new MoneyParseError(input);
  }
  return kurus;
}

function splitWholeAndFraction(text: string, input: string): [string, string] {
  if (text.includes(',')) {
    const [whole = '', fraction = '', ...rest] = text.split(',');
    if (rest.length > 0 || !/^\d{1,2}$/.test(fraction)) {
      throw new MoneyParseError(input);
    }
    return [thousands(whole, input), fraction];
  }
  const groups = text.split('.');
  const [head = '', ...tail] = groups;
  if (tail.length === 1 && /^\d{1,2}$/.test(tail[0] ?? '')) {
    return [head, tail[0] ?? ''];
  }
  return [thousands(text, input), ''];
}

/**
 * The digits of a whole part, its dots read as thousands separators only where they can be:
 * a first group of one to three digits not starting with 0, then groups of exactly three.
 * "0.500" or "1.23" is refused rather than read as ₺500 or ₺123.
 */
function thousands(whole: string, input: string): string {
  if (!whole.includes('.')) {
    return whole;
  }
  const [head = '', ...tail] = whole.split('.');
  if (!/^[1-9]\d{0,2}$/.test(head) || !tail.every((group) => /^\d{3}$/.test(group))) {
    throw new MoneyParseError(input);
  }
  return whole.replaceAll('.', '');
}
