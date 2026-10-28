import { describe, expect, it } from 'vitest';
import { newId } from './ids';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('lays out a UUID v7 from time and random bytes', () =>
    expect(newId(1793178000000, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(
      '01a181bc-da80-7001-8203-040506070809',
    ));

  it('produces version 7 ids by default', () => expect(newId()).toMatch(V7));

  it('sorts by creation time', () => {
    const early = newId(1000, new Uint8Array(10).fill(255));
    const late = newId(1001, new Uint8Array(10));
    expect(early < late).toBe(true);
  });
});
