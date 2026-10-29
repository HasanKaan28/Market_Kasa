import { describe, expect, it } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it('reads the screen from the address', () => {
    expect(parseRoute('#/products')).toBe('products');
    expect(parseRoute('#/pos')).toBe('pos');
    expect(parseRoute('#/stock')).toBe('stock');
    expect(parseRoute('')).toBe('pos');
    expect(parseRoute('#/bilinmeyen')).toBe('pos');
  });
});
