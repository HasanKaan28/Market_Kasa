/** A Turkish identity number (TCKN): 11 digits, no leading zero, and its two check digits. */
export function isValidTckn(text: string): boolean {
  const value = text.trim();
  if (!/^[1-9]\d{10}$/.test(value)) {
    return false;
  }
  const d = digits(value);
  const odd = d(0) + d(2) + d(4) + d(6) + d(8);
  const even = d(1) + d(3) + d(5) + d(7);
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  let eleventh = 0;
  for (let i = 0; i < 10; i += 1) {
    eleventh += d(i);
  }
  return d(9) === tenth && d(10) === eleventh % 10;
}

/** A Turkish tax number (VKN): 10 digits, the last a check digit over the other nine. */
export function isValidVkn(text: string): boolean {
  const value = text.trim();
  if (!/^\d{10}$/.test(value)) {
    return false;
  }
  const d = digits(value);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const shifted = (d(i) + 9 - i) % 10;
    sum += shifted === 9 ? 9 : (shifted * 2 ** (9 - i)) % 9;
  }
  return d(9) === (10 - (sum % 10)) % 10;
}

/** A company's tax id: a VKN, or a sole trader's TCKN, told apart by their length. */
export function isValidTaxId(text: string): boolean {
  return text.trim().length === 11 ? isValidTckn(text) : isValidVkn(text);
}

/** The digit at each place of a string already checked to be digits. */
function digits(value: string): (index: number) => number {
  return (index) => Number(value.charAt(index));
}
