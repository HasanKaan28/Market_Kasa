import { describe, expect, it } from 'vitest';
import { activationCodeOf, typedActivationCode } from './activationCode';

describe('activation codes', () => {
  it('shows what is typed in capitals, grouped in fours', () => {
    expect(typedActivationCode('ab')).toBe('AB');
    expect(typedActivationCode('abcd')).toBe('ABCD');
    expect(typedActivationCode('abcd2')).toBe('ABCD-2');
    expect(typedActivationCode('ABCD-2345')).toBe('ABCD-2345');
    expect(typedActivationCode(' abcd 2345 ')).toBe('ABCD-2345');
    expect(typedActivationCode('ABCD-23456')).toBe('ABCD-2345');
    expect(typedActivationCode('')).toBe('');
  });

  it('reads O as zero and I or L as one, and drops letters a code never has', () => {
    expect(typedActivationCode('o1il')).toBe('0111');
    expect(typedActivationCode('ı')).toBe('1');
    expect(typedActivationCode('ab.cd/ü2u3')).toBe('ABCD-23');
  });

  it('is whole only with eight characters', () => {
    expect(activationCodeOf('ABCD-2345')).toBe('ABCD-2345');
    expect(activationCodeOf('ABCD-234')).toBeNull();
    expect(activationCodeOf('')).toBeNull();
  });
});
