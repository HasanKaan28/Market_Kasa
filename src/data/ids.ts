const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'));

/**
 * Time-ordered UUID v7: 48-bit Unix milliseconds, version 7, variant 10 and 74 random bits,
 * so ids created later sort after earlier ones.
 */
export function newId(
  now: number = Date.now(),
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
): string {
  const bytes = new Uint8Array(16);
  let time = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
  for (let index = 0; index < 7; index += 1) {
    bytes[9 + index] = random[3 + index] ?? 0;
  }
  const hex = Array.from(bytes, (byte) => HEX[byte]).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
