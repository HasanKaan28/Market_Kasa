import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE } from '@/app/device';
import { PairDialog, PairingAction } from './PairDialog';

const claimed = {
  marketId: 'kursunlu',
  marketName: 'Kurşunlu Market',
  deviceId: 'd1',
  deviceCode: 'K2',
};

function setup(overrides: Partial<Parameters<typeof PairDialog>[0]> = {}) {
  const props = {
    current: DEFAULT_DEVICE,
    pendingCount: 0,
    createCode: vi.fn(async () => ({
      code: 'ABCD2345',
      market: { id: 'kursunlu', name: 'Kurşunlu Market' },
    })),
    claim: vi.fn(async () => claimed),
    onPaired: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<PairDialog {...props} />);
  return props;
}

describe('PairDialog', () => {
  it('pairs with a code and saves the register', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'abcd2345');
    await userEvent.clear(screen.getByLabelText('Kasa kodu'));
    await userEvent.type(screen.getByLabelText('Kasa kodu'), 'k2');
    await userEvent.clear(screen.getByLabelText('Kasa adı'));
    await userEvent.type(screen.getByLabelText('Kasa adı'), 'Kasa 2');
    await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));

    expect(props.claim).toHaveBeenCalledWith({
      code: 'abcd2345',
      deviceCode: 'K2',
      deviceName: 'Kasa 2',
    });
    expect(props.onPaired).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: 'kursunlu',
        deviceCode: 'K2',
        paired: true,
        databaseId: 'kursunlu',
      }),
    );
  });

  it('sends this register’s queue only when chosen', async () => {
    const props = setup({ pendingCount: 12 });
    expect(screen.getByRole('radio', { name: 'Boş başla' })).toBeChecked();
    await userEvent.click(
      screen.getByRole('radio', { name: 'Bu kasadaki 12 işlemi markete gönder' }),
    );
    await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'ABCD2345');
    await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));

    expect(props.onPaired).toHaveBeenCalledWith(expect.objectContaining({ databaseId: 'yerel' }));
  });

  it('makes a code with the owner’s sign-in', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Kod üret' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'sahip@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli');
    await userEvent.click(screen.getByRole('button', { name: 'Kodu üret' }));

    expect(props.createCode).toHaveBeenCalledWith({
      email: 'sahip@example.com',
      password: 'gizli',
    });
    expect(
      await screen.findByText('Kod: ABCD2345 · Kurşunlu Market · 10 dakika geçerli'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Bağlantı kodu')).toHaveValue('ABCD2345');
    expect(screen.queryByLabelText('Şifre')).not.toBeInTheDocument();
  });

  it('asks which market when the owner has several', async () => {
    const createCode = vi.fn(async (input: { marketId?: string }) =>
      input.marketId
        ? { code: 'ZZZZ2345', market: { id: 'b', name: 'B Market' } }
        : {
            markets: [
              { id: 'a', name: 'A Market' },
              { id: 'b', name: 'B Market' },
            ],
          },
    );
    setup({ createCode });
    await userEvent.click(screen.getByRole('button', { name: 'Kod üret' }));
    await userEvent.type(screen.getByLabelText('E-posta'), 'sahip@example.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli');
    await userEvent.click(screen.getByRole('button', { name: 'Kodu üret' }));
    await userEvent.selectOptions(await screen.findByLabelText('Market'), 'b');
    await userEvent.click(screen.getByRole('button', { name: 'Kodu üret' }));

    expect(createCode).toHaveBeenLastCalledWith({
      email: 'sahip@example.com',
      password: 'gizli',
      marketId: 'b',
    });
    expect(
      await screen.findByText('Kod: ZZZZ2345 · B Market · 10 dakika geçerli'),
    ).toBeInTheDocument();
  });

  it('says when the register code is taken', async () => {
    const props = setup({
      claim: vi.fn(async () => {
        throw new Error('K2 kodu bu markette kullanılıyor.');
      }),
    });
    await userEvent.type(screen.getByLabelText('Bağlantı kodu'), 'ABCD2345');
    await userEvent.click(screen.getByRole('button', { name: 'Bağla' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('K2 kodu bu markette kullanılıyor.');
    expect(props.onPaired).not.toHaveBeenCalled();
  });
});

describe('PairingAction', () => {
  it('hides pairing when the app has no server', () => {
    const { rerender } = render(<PairingAction config={null} onOpen={() => {}} paired={false} />);
    expect(screen.queryByRole('button', { name: 'Sunucuya bağla' })).not.toBeInTheDocument();
    rerender(
      <PairingAction
        config={{ url: 'https://x.supabase.co', key: 'sb_publishable_x' }}
        onOpen={() => {}}
        paired={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Sunucuya bağla' })).toBeInTheDocument();
    rerender(
      <PairingAction
        config={{ url: 'https://x.supabase.co', key: 'sb_publishable_x' }}
        onOpen={() => {}}
        paired
      />,
    );
    expect(screen.getByText('Sunucuya bağlı')).toBeInTheDocument();
  });
});
