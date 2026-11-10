import { assertSafeInteger, divRoundHalfUp, type Kurus } from './money';

/**
 * The part of a sold line's amount (net or VAT) that `returningMilli` more units give back,
 * after `alreadyReturnedMilli` were returned before. Each share is the difference of two
 * cumulative roundings, so every series of partial returns adds up to the line exactly.
 */
export function refundShare(
  lineAmount: Kurus,
  soldMilli: number,
  alreadyReturnedMilli: number,
  returningMilli: number,
): Kurus {
  for (const [value, what] of [
    [lineAmount, 'Line amount'],
    [soldMilli, 'Sold quantity'],
    [alreadyReturnedMilli, 'Returned quantity'],
    [returningMilli, 'Returning quantity'],
  ] as const) {
    assertSafeInteger(value, what);
  }
  if (soldMilli <= 0 || returningMilli <= 0 || alreadyReturnedMilli < 0) {
    throw new RangeError('Quantities must be positive');
  }
  if (alreadyReturnedMilli + returningMilli > soldMilli) {
    throw new RangeError(
      `Cannot return ${returningMilli} more of ${soldMilli} after ${alreadyReturnedMilli}`,
    );
  }
  const cumulative = (qtyMilli: number) => divRoundHalfUp(lineAmount * qtyMilli, soldMilli);
  return cumulative(alreadyReturnedMilli + returningMilli) - cumulative(alreadyReturnedMilli);
}
