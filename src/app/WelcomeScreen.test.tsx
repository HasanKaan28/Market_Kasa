import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE } from './device';
import { shouldWelcome } from './welcome';
import { WelcomeScreen } from './WelcomeScreen';

const claimed = {
  marketId: 'kursunlu-ab12cd',
  marketName: 'Kurşunlu Market',
  deviceId: 'd1',
  deviceCode: 'K1',
};
const server = { url: 'https://x.supabase.co', key: 'sb_publishable_x' };

function setup(overrides: Partial<Parameters<typeof WelcomeScreen>[0]> = {}) {
  const props = {
    current: DEFAULT_DEVICE,
    open: vi.fn(async () => ({ claimed })),
    join: vi.fn(async () => ({ claimed: { ...claimed, deviceCode: 'K2' } })),
    onDone: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
  render(<WelcomeScreen {...props} />);
  return props;
}

describe('WelcomeScreen', () => {
  it('opens a market with the shop’s own email', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Market kur' }));
    await userEvent.type(screen.getByLabelText('Market adı'), 'Kurşunlu Market');
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Marketi kur' }));

    expect(props.open).toHaveBeenCalledWith({
      marketName: 'Kurşunlu Market',
      email: 'emin@example.com',
      password: 'gizli-sifre',
    });
    expect(props.onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: 'kursunlu-ab12cd',
        marketName: 'Kurşunlu Market',
        deviceCode: 'K1',
        deviceName: 'Kasa K1',
        paired: true,
      }),
    );
  });

  it('checks the password before asking the server', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Market kur' }));
    await userEvent.type(screen.getByLabelText('Market adı'), 'M');
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'kisa');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'kisa');
    await userEvent.click(screen.getByRole('button', { name: 'Marketi kur' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Şifre en az 8 karakter olmalı.');

    await userEvent.clear(screen.getByLabelText('Şifre'));
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Marketi kur' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Şifreler aynı değil.');
    expect(props.open).not.toHaveBeenCalled();
  });

  it('tells the shop to confirm its email', async () => {
    setup({ open: vi.fn(async () => ({ confirmEmail: true as const })) });
    await userEvent.click(screen.getByRole('button', { name: 'Market kur' }));
    await userEvent.type(screen.getByLabelText('Market adı'), 'M');
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.type(screen.getByLabelText('Şifre (tekrar)'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Marketi kur' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'E-postanıza gelen bağlantıya tıklayın, sonra “Markete giriş yap” ile girin.',
    );
  });

  it('signs another device into the market', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Markete giriş yap' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(props.join).toHaveBeenCalledWith({ email: 'emin@example.com', password: 'gizli-sifre' });
    expect(props.onDone).toHaveBeenCalledWith(
      expect.objectContaining({ deviceCode: 'K2', deviceName: 'Kasa K2', paired: true }),
    );
  });

  it('asks which market when the owner has several', async () => {
    const join = vi.fn(async (input: { marketId?: string }) =>
      input.marketId
        ? { claimed }
        : {
            markets: [
              { id: 'a', name: 'A Market' },
              { id: 'b', name: 'B Market' },
            ],
          },
    );
    setup({ join });
    await userEvent.click(screen.getByRole('button', { name: 'Markete giriş yap' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'emin@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
    await userEvent.selectOptions(await screen.findByLabelText('Market'), 'b');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
    expect(join).toHaveBeenLastCalledWith(expect.objectContaining({ marketId: 'b' }));
  });

  it('lets the shop try the app without a server', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'İnternetsiz dene' }));
    expect(props.onSkip).toHaveBeenCalled();
  });

  it('appears only on a server build, before pairing, until skipped', () => {
    const storage = { getItem: () => null };
    expect(shouldWelcome(DEFAULT_DEVICE, server, storage)).toBe(true);
    expect(shouldWelcome(DEFAULT_DEVICE, null, storage)).toBe(false);
    expect(shouldWelcome({ ...DEFAULT_DEVICE, paired: true }, server, storage)).toBe(false);
    expect(shouldWelcome(DEFAULT_DEVICE, server, { getItem: () => '1' })).toBe(false);
  });

  it('greets with the Market Kasa logo', () => {
    setup();
    expect(document.querySelector('main img[src$="logo.svg"]')).not.toBeNull();
  });
});
