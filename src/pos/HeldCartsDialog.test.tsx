import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { cartReducer, emptyCart } from './cart';
import { HeldCartsDialog } from './HeldCartsDialog';

const milk: ProductRecord = {
  id: 'p',
  name: 'Süt',
  sellPrice: 4250,
  vatRate: 1,
  unit: 'piece',
  buyPrice: 0,
  isQuick: false,
  criticalLevelMilli: 0,
  createdAt: '',
  updatedAt: '',
};
const held = [
  {
    cart: cartReducer(emptyCart('a'), { type: 'add', product: milk }),
    heldAt: '2026-10-29T11:32:00.000Z',
  },
];

describe('HeldCartsDialog', () => {
  it('lists held carts with time, items and total', () => {
    render(<HeldCartsDialog open held={held} onClose={vi.fn()} onResume={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Bekleyen sepetler' });
    expect(dialog).toHaveTextContent('14:32');
    expect(dialog).toHaveTextContent('1 kalem');
    expect(dialog).toHaveTextContent('₺42,50');
  });

  it('resumes the chosen cart', async () => {
    const onResume = vi.fn();
    render(<HeldCartsDialog open held={held} onClose={vi.fn()} onResume={onResume} />);
    await userEvent.click(screen.getByRole('button', { name: 'Devam et · 14:32' }));
    expect(onResume).toHaveBeenCalledWith('a');
  });

  it('says when nothing is held', () => {
    render(<HeldCartsDialog open held={[]} onClose={vi.fn()} onResume={vi.fn()} />);
    expect(screen.getByText('Bekleyen sepet yok')).toBeInTheDocument();
  });
});
