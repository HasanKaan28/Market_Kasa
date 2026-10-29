import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('renders the main landmark', async () => {
    render(<App />);
    expect(await screen.findByRole('main')).toBeInTheDocument();
  });

  it("shows the sync runner's state in the shell", async () => {
    render(<App />);
    expect(await screen.findByText('Çevrimdışı')).toBeInTheDocument();
  });

  it('opens the products screen from the menu', async () => {
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Ürünler' }));
    expect(await screen.findByRole('heading', { name: 'Ürünler', level: 1 })).toBeInTheDocument();
    const shown = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(within(shown).getByRole('link', { name: 'Ürünler' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
