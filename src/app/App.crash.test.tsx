import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELD_STORAGE_KEY } from '@/pos/held';
import { App } from './App';

vi.mock('@/products/ProductsScreen', () => ({
  ProductsScreen: () => {
    throw new Error('Ürünler ekranı çöktü');
  },
}));

describe('App after a crash', () => {
  afterEach(() => {
    window.location.hash = '';
    vi.restoreAllMocks();
  });

  it('goes back to the register from a crashed screen and keeps the carts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(HELD_STORAGE_KEY, '[]');
    window.location.hash = '#/products';
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Kasaya dön' }));
    expect(window.location.hash).toBe('#/pos');
    expect(localStorage.getItem(HELD_STORAGE_KEY)).toBe('[]');
  });
});
