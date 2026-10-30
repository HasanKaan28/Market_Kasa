/** A Turkish identity number (TCKN): 11 digits, no leading zero, and its two check digits. */
export function isValidTckn(text: string): boolean {
  const value = text.trim();
  if (!/^[1-9]\d{10}$/.test(value)) {
    return false;
  }
  const d = [...value].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

/** A Turkish tax number (VKN): 10 digits, the last a check digit over the other nine. */
export function isValidVkn(text: string): boolean {
  const value = text.trim();
  if (!/^\d{10}$/.test(value)) {
    return false;
  }
  const d = [...value].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const shifted = (d[i] + 9 - i) % 10;
    sum += shifted === 9 ? 9 : (shifted * 2 ** (9 - i)) % 9;
  }
  return d[9] === (10 - (sum % 10)) % 10;
}
