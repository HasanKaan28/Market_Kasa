import { describe, expect, it } from 'vitest';
import { normalizeForSearch } from './text';

describe('normalizeForSearch', () => {
  it.each([
    ['LIPTON ICE TEA', 'lipton ice tea'],
    ['  SİMİT ', 'simit'],
    ['Çağrı Öğüş', 'cagri ogus'],
    ['IŞIK', 'isik'],
  ])('%j → %j', (input, expected) => expect(normalizeForSearch(input)).toBe(expected));
});
