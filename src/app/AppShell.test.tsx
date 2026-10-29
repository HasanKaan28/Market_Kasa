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
  it('lists the built sections and marks the active one', () => {
    render(<AppShell {...base} syncState="online" />);
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Kasa', 'Ürünler', 'Stok', 'Müşteriler', 'Tedarikçiler']);
    expect(within(nav).getByRole('link', { name: 'Kasa' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Ürünler' })).toHaveAttribute(
      'href',
      '#/products',
    );
  });

  it.each([
    ['online', undefined, 'Çevrimiçi'],
    ['offline', undefined, 'Çevrimdışı'],
    ['pending', 3, '3 işlem bekliyor'],
    ['error', undefined, 'Eşitleme hatası'],
  ] as const)('shows sync state %s', (state, n, label) => {
    render(<AppShell {...base} syncState={state} pendingCount={n} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('shows the cart panel it is given and the app version', () => {
    render(<AppShell {...base} syncState="online" cart={<p>Sepet boş</p>} />);
    expect(screen.getByRole('complementary', { name: 'Sepet' })).toHaveTextContent('Sepet boş');
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
  });

  it('leaves out the cart panel when a screen has none', () => {
    render(
      <AppShell {...base} activeNav="products" syncState="online">
        <h1>Ürünler</h1>
      </AppShell>,
    );
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Ürünler');
  });

  it('hides the staff name when there is none', () => {
    render(
      <AppShell
        marketName="Kurşunlu Market"
        deviceName="Kasa 1"
        activeNav="pos"
        syncState="online"
      />,
    );
    expect(screen.queryByText('Elif Y.')).not.toBeInTheDocument();
    expect(screen.getByText('Kasa 1')).toBeInTheDocument();
  });
});
