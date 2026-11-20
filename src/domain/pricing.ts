import { assertSafeInteger, divRoundHalfUp, type Kurus } from './money';

export type VatRate = 0 | 1 | 10 | 20;

export const VAT_RATES: readonly VatRate[] = [0, 1, 10, 20];

/** ₺1.000.000,00: far above any shelf price, and low enough that line totals stay exact. */
export const MAX_UNIT_PRICE: Kurus = 100_000_000;

export type CartLineInput = {
  qtyMilli: number;
  unitPrice: Kurus;
  vatRate: VatRate;
  lineDiscount?: Kurus;
};

export type CartLineTotals = {
  gross: Kurus;
  lineDiscount: Kurus;
  cartShare: Kurus;
  net: Kurus;
  vat: Kurus;
};

export type CartTotals = {
  lines: CartLineTotals[];
  subtotal: Kurus;
  cartDiscount: Kurus;
  total: Kurus;
  vatTotal: Kurus;
  vatByRate: Partial<Record<VatRate, Kurus>>;
};

export function assertVatRate(rate: number): asserts rate is VatRate {
  if (!(VAT_RATES as readonly number[]).includes(rate)) {
    throw new RangeError(`VAT rate must be one of ${VAT_RATES.join(', ')}, got ${rate}`);
  }
}

/** Price of `qtyMilli` thousandths of a unit, rounded to the kuruş. */
export function lineTotal(qtyMilli: number, unitPrice: Kurus): Kurus {
  assertSafeInteger(qtyMilli, 'Quantity (thousandths)');
  assertSafeInteger(unitPrice, 'Unit price');
  return divRoundHalfUp(qtyMilli * unitPrice, 1000);
}

/** The VAT contained in a VAT-inclusive amount. */
export function vatIncluded(total: Kurus, rate: VatRate): Kurus {
  assertSafeInteger(total, 'Amount');
  assertVatRate(rate);
  return total - divRoundHalfUp(total * 100, 100 + rate);
}

/**
 * Splits `discount` across lines in proportion to their totals (largest remainder method):
 * every line gets the floor of its exact share, and the leftover kuruş go to the lines with
 * the largest remainders, earlier lines first on ties.
 */
export function distributeDiscount(lineTotals: readonly Kurus[], discount: Kurus): Kurus[] {
  assertSafeInteger(discount, 'Discount');
  lineTotals.forEach((value) => assertSafeInteger(value, 'Line total'));
  const sum = sumOf(lineTotals);
  if (lineTotals.some((value) => value < 0) || discount < 0 || discount > sum) {
    throw new RangeError(`Cannot spread a discount of ${discount} over lines totalling ${sum}`);
  }
  if (discount === 0) {
    return lineTotals.map(() => 0);
  }
  const parts = lineTotals.map((value, index) => {
    const product = value * discount;
    const rest = product % sum;
    return { index, share: (product - rest) / sum, rest };
  });
  let leftover = discount - sumOf(parts.map((part) => part.share));
  const byRemainder = [...parts].sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const part of byRemainder) {
    if (leftover === 0) break;
    part.share += 1;
    leftover -= 1;
  }
  return parts.map((part) => part.share);
}

export function computeCart(lines: readonly CartLineInput[], cartDiscount: Kurus = 0): CartTotals {
  const discounted = lines.map((line) => {
    const gross = lineTotal(line.qtyMilli, line.unitPrice);
    const lineDiscount = line.lineDiscount ?? 0;
    assertSafeInteger(lineDiscount, 'Line discount');
    if (lineDiscount < 0) {
      throw new RangeError(`A line discount cannot be negative, got ${lineDiscount}`);
    }
    return { line, gross, lineDiscount, base: gross - lineDiscount };
  });
  const shares = distributeDiscount(
    discounted.map((entry) => entry.base),
    cartDiscount,
  );
  const totals = discounted.map((entry, index) => {
    const cartShare = shares[index] ?? 0;
    const net = entry.base - cartShare;
    const vat = vatIncluded(net, entry.line.vatRate);
    return {
      rate: entry.line.vatRate,
      gross: entry.gross,
      lineDiscount: entry.lineDiscount,
      cartShare,
      net,
      vat,
    };
  });

  const vatByRate: Partial<Record<VatRate, Kurus>> = {};
  for (const { rate, vat } of totals) {
    vatByRate[rate] = (vatByRate[rate] ?? 0) + vat;
  }

  return {
    lines: totals.map(({ gross, lineDiscount, cartShare, net, vat }) => ({
      gross,
      lineDiscount,
      cartShare,
      net,
      vat,
    })),
    subtotal: sumOf(discounted.map((entry) => entry.base)),
    cartDiscount,
    total: sumOf(totals.map((entry) => entry.net)),
    vatTotal: sumOf(totals.map((entry) => entry.vat)),
    vatByRate,
  };
}

function sumOf(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

/** A price written without VAT, as the price paid with it: kuruş rounded half up. */
export function withVat(price: Kurus, rate: VatRate): Kurus {
  return divRoundHalfUp(price * (100 + rate), 100);
}
