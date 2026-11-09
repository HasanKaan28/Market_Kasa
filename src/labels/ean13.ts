import { withCheckDigit } from '@/domain/scaleBarcode';

// The left-hand (odd parity) patterns; G is R reversed, R is L inverted.
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const R = L.map((pattern) => Array.from(pattern, (bit) => (bit === '1' ? '0' : '1')).join(''));
const G = R.map((pattern) => Array.from(pattern).reverse().join(''));
// Which of the left six digits use G, by the first digit.
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

/**
 * The 95 modules of an EAN-13 barcode, `1` a bar and `0` a space, or null when the code is not
 * thirteen digits with a correct check digit (a scale item code, an internal code).
 */
export function ean13Modules(code: string): string | null {
  if (!/^\d{13}$/.test(code) || withCheckDigit(code.slice(0, 12)) !== code) {
    return null;
  }
  const digits = Array.from(code, Number);
  const parity = PARITY[digits[0] as number] as string;
  let modules = '101';
  for (let index = 1; index <= 6; index += 1) {
    const table = parity[index - 1] === 'G' ? G : L;
    modules += table[digits[index] as number];
  }
  modules += '01010';
  for (let index = 7; index <= 12; index += 1) {
    modules += R[digits[index] as number];
  }
  return `${modules}101`;
}
