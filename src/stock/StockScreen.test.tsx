import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';

describe('StockScreen', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('opens from the menu', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Stok' }));
    expect(await screen.findByRole('heading', { name: 'Stok', level: 1 })).toBeInTheDocument();
    const view = screen.getByRole('group', { name: 'Göster' });
    expect(within(view).getByRole('radio', { name: 'Mal kabul' })).toBeChecked();
    expect(within(view).getByRole('radio', { name: 'Kritik stok' })).not.toBeChecked();
  });
});
