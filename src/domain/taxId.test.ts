import { describe, expect, it } from 'vitest';
import { isValidTckn, isValidVkn } from './taxId';

describe('tax ids', () => {
  it('checks identity and tax numbers', () => {
    expect(isValidTckn('10000000146')).toBe(true);
    expect(isValidTckn(' 10000000146 ')).toBe(true);
    // A wrong tenth digit, a wrong last digit, a leading zero, a short number.
    expect(isValidTckn('10000000156')).toBe(false);
    expect(isValidTckn('10000000147')).toBe(false);
    expect(isValidTckn('00000000146')).toBe(false);
    expect(isValidTckn('1000000014')).toBe(false);
    expect(isValidTckn('1000000014a')).toBe(false);

    expect(isValidVkn('1234567890')).toBe(true);
    expect(isValidVkn('9876543217')).toBe(true);
    expect(isValidVkn('0012345672')).toBe(true);
    expect(isValidVkn('9876543210')).toBe(false);
    expect(isValidVkn('987654321')).toBe(false);
    expect(isValidVkn('98765432177')).toBe(false);
  });
});
