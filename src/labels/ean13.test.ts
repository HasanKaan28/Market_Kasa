import { describe, expect, it } from 'vitest';
import { ean13Modules } from './ean13';

describe('ean13Modules', () => {
  // 4006381333931: the first digit 4 sets the left half's parity to L G L L G G.
  const modules = ean13Modules('4006381333931');

  it('draws the 95 modules of an EAN-13 with its guards', () => {
    expect(modules).toHaveLength(95);
    expect(modules?.slice(0, 3)).toBe('101');
    expect(modules?.slice(45, 50)).toBe('01010');
    expect(modules?.slice(92)).toBe('101');
  });

  it('encodes each digit by the parity the first digit sets', () => {
    const left = Array.from({ length: 6 }, (_, index) =>
      modules?.slice(3 + index * 7, 10 + index * 7),
    );
    // 0 (L), 0 (G), 6 (L), 3 (L), 8 (G), 1 (G)
    expect(left).toEqual(['0001101', '0100111', '0101111', '0111101', '0001001', '0110011']);
    const right = Array.from({ length: 6 }, (_, index) =>
      modules?.slice(50 + index * 7, 57 + index * 7),
    );
    // 3 3 3 9 3 1, all R
    expect(right).toEqual(['1000010', '1000010', '1000010', '1110100', '1000010', '1100110']);
  });

  it('draws nothing for a code that is not a valid EAN-13', () => {
    for (const code of ['4006381333932', '400638133393', 'ABC', '', '00123']) {
      expect(ean13Modules(code), code).toBeNull();
    }
  });
});
