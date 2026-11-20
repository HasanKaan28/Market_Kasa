import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE } from './device';
import { finishPairing } from './finishPairing';

const paired = { ...DEFAULT_DEVICE, marketId: 'kursunlu-ab12cd', paired: true };

describe('finishPairing', () => {
  it('leaves no cart of the old market behind', () => {
    const save = vi.fn(() => true);
    const clearCarts = vi.fn();
    expect(finishPairing(paired, { save, clearCarts })).toBe(true);
    expect(save).toHaveBeenCalledWith(paired);
    // A cart from before holds products the new market does not have.
    expect(clearCarts).toHaveBeenCalled();
  });

  it('keeps the carts when the pairing could not be saved', () => {
    const clearCarts = vi.fn();
    expect(finishPairing(paired, { save: () => false, clearCarts })).toBe(false);
    expect(clearCarts).not.toHaveBeenCalled();
  });
});
