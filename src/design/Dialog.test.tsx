import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('is named by its title and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Nakit ödeme">
        <p>İçerik</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Nakit ödeme' })).toHaveTextContent('İçerik');
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes from its close button', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Yeni ürün">
        <p>İçerik</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
