import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { APP_VERSION } from './version';

const base = {
  marketName: 'Kurşunlu Market',
  deviceName: 'Kasa 1',
  staffName: 'Elif Y.',
  activeNav: 'pos',
} as const;

describe('AppShell', () => {
  it('lists the five sections and marks the active one', () => {
    render(<AppShell {...base} syncState="online" />);
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Kasa', 'Ürünler', 'Stok', 'Veresiye', 'Raporlar']);
    expect(within(nav).getByRole('link', { name: 'Kasa' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['online', undefined, 'Çevrimiçi'],
    ['offline', undefined, 'Çevrimdışı'],
    ['pending', 3, '3 işlem bekliyor'],
  ] as const)('shows sync state %s', (state, n, label) => {
    render(<AppShell {...base} syncState={state} pendingCount={n} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('shows an empty cart and the app version', () => {
    render(<AppShell {...base} syncState="online" />);
    expect(screen.getByRole('complementary', { name: 'Sepet' })).toHaveTextContent('Sepet boş');
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
  });
});
