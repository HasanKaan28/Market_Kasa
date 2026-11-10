import { describe, expect, it, vi } from 'vitest';
import type { ServerClient } from './client';
import { joinMarket, openMarket } from './onboarding';

type Answer = { data?: unknown; error?: { message: string; code?: string } };

function fakeClient(answers: Record<string, Answer>, session: unknown = { user: {} }) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const auth = {
    signUp: vi.fn(async () => ({ data: { session }, error: null as { message: string } | null })),
    signInWithPassword: vi.fn(async () => ({ error: null as { message: string } | null })),
    signInAnonymously: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
  };
  const client: ServerClient = {
    auth,
    async rpc(fn, args) {
      calls.push({ fn, args });
      const answer = answers[fn] ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { client, calls, auth };
}

const claimed = {
  marketId: 'kursunlu-ab12cd',
  marketName: 'Kurşunlu Market',
  deviceId: 'd1',
  deviceCode: 'K1',
};

describe('opening a market', () => {
  it('signs the shop up, opens its market and makes this device the first register', async () => {
    const owner = fakeClient({
      create_own_market: { data: { id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' } },
      create_pairing: { data: 'ABCD2345' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);

    const result = await openMarket({
      owner: owner.client,
      device: device.client,
      email: ' emin@example.com ',
      password: 'gizli-sifre',
      marketName: ' Kurşunlu Market ',
      platform: 'windows',
    });

    expect(owner.auth.signUp).toHaveBeenCalledWith({
      email: 'emin@example.com',
      password: 'gizli-sifre',
    });
    expect(owner.calls.map((call) => call.fn)).toEqual(['create_own_market', 'create_pairing']);
    expect(owner.calls[0]?.args).toEqual({ name: 'Kurşunlu Market' });
    expect(owner.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(device.calls[0]?.args).toMatchObject({ code: 'ABCD2345', device_code: '' });
    expect(result).toEqual({ claimed });
  });

  it('asks to confirm the email when the server wants it', async () => {
    const owner = fakeClient({}, null);
    const device = fakeClient({});
    const result = await openMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketName: 'Market',
      platform: 'web',
    });
    expect(result).toEqual({ confirmEmail: true });
    expect(owner.calls).toEqual([]);
  });

  it('signs in instead when the email already has an account', async () => {
    const owner = fakeClient({
      create_own_market: { data: { id: 'm-1', name: 'Market' } },
      create_pairing: { data: 'ABCD2345' },
    });
    owner.auth.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'User already registered' },
    });
    const device = fakeClient({ claim_device: { data: claimed } }, null);
    await openMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      marketName: 'Market',
      platform: 'web',
    });
    expect(owner.auth.signInWithPassword).toHaveBeenCalled();
  });

  it('says why a market could not be opened', async () => {
    const short = fakeClient({});
    short.auth.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Password should be at least 6 characters.' },
    });
    await expect(
      openMarket({
        owner: short.client,
        device: fakeClient({}).client,
        email: 'a@example.com',
        password: '123',
        marketName: 'M',
        platform: 'web',
      }),
    ).rejects.toThrow('Şifre en az 8 karakter olmalı.');
    const many = fakeClient({ create_own_market: { error: { message: 'too_many_markets' } } });
    await expect(
      openMarket({
        owner: many.client,
        device: fakeClient({}).client,
        email: 'a@example.com',
        password: 'gizli-sifre',
        marketName: 'M',
        platform: 'web',
      }),
    ).rejects.toThrow('Bu hesapla en çok 3 market açılabilir.');
  });
});

describe('joining a market from another device', () => {
  it('signs the owner in once and binds this device as the next register', async () => {
    const owner = fakeClient({
      owner_markets: { data: [{ id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' }] },
      create_pairing: { data: 'ZZZZ2345' },
    });
    const device = fakeClient({ claim_device: { data: { ...claimed, deviceCode: 'K2' } } }, null);
    const result = await joinMarket({
      owner: owner.client,
      device: device.client,
      email: 'emin@example.com',
      password: 'gizli-sifre',
      platform: 'android',
    });
    expect(device.calls[0]?.args).toMatchObject({ code: 'ZZZZ2345', device_code: '' });
    expect(result).toEqual({ claimed: { ...claimed, deviceCode: 'K2' } });
  });

  it('lists the markets when the owner has several', async () => {
    const markets = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const owner = fakeClient({ owner_markets: { data: markets } });
    const result = await joinMarket({
      owner: owner.client,
      device: fakeClient({}).client,
      email: 'e@example.com',
      password: 'p',
      platform: 'web',
    });
    expect(result).toEqual({ markets });
  });
});
