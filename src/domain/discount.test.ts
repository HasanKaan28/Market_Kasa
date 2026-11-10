import { describe, expect, it } from 'vitest';
import { percentOf } from './discount';

describe('percentOf', () => {
  it('turns a percentage into kuruş', () => {
    expect(percentOf(56640, 10)).toBe(5664);
    expect(percentOf(999, 15)).toBe(150);
    expect(() => percentOf(1000, 0)).toThrow(RangeError);
    expect(() => percentOf(1000, 101)).toThrow(RangeError);
    expect(() => percentOf(1000, 2.5)).toThrow(RangeError);
  });
});
