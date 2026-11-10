import { describe, expect, it } from 'vitest';
import { hashPin, isValidPin, verifyPin } from './pin';

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

describe('PIN', () => {
  it('accepts only four to six digits', () => {
    expect(['1234', '123456', '0000'].every(isValidPin)).toBe(true);
    expect(['123', '1234567', '12a4', ' 1234', '١٢٣٤', ''].some(isValidPin)).toBe(false);
  });

  it('hashes a PIN with its own salt and enough rounds', async () => {
    const first = await hashPin('1234');
    const second = await hashPin('1234');
    expect(first.iterations).toBeGreaterThanOrEqual(100_000);
    expect(bytes(first.salt)).toHaveLength(16);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    // Worked out apart from the module: PBKDF2-SHA256 over the stated rounds and salt.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('1234'),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const expected = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(first.salt), iterations: first.iterations },
      key,
      256,
    );
    expect(bytes(first.hash)).toEqual(new Uint8Array(expected));
    await expect(hashPin('12')).rejects.toThrow(RangeError);
  });

  it('verifies the right PIN and refuses a wrong one', async () => {
    const stored = await hashPin('4821');
    expect(await verifyPin('4821', stored)).toBe(true);
    expect(await verifyPin('4822', stored)).toBe(false);
    expect(await verifyPin('482', stored)).toBe(false);
    expect(await verifyPin('4821', { ...stored, iterations: 10 })).toBe(false);
  });
});
