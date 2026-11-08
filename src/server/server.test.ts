import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE } from '@/app/device';
import { OWNER_CLIENT_OPTIONS, type ServerClient } from './client';
import { serverConfig } from './config';
import { createPairingCode, pairDevice, pairedSettings, unpairedSettings } from './pairing';
import {
  DeviceRevokedError,
  DeviceUnpairedError,
  supabaseTransport,
} from '@/sync/supabaseTransport';

type Call = { fn: string; args?: Record<string, unknown> };

/** A stand-in Supabase client: answers each RPC from `answers` and records every call. */
function fakeClient(
  answers: Record<string, { data?: unknown; error?: { message: string; code?: string } }>,
) {
  const calls: Call[] = [];
  const auth = {
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
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

afterEach(() => vi.restoreAllMocks());

describe('server config', () => {
  it('refuses a secret key in the app', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = 'https://abc.supabase.co';
    expect(
      serverConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }),
    ).toEqual({
      url,
      key: 'sb_publishable_x',
    });
    expect(
      serverConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' }),
    ).toBeNull();
    expect(
      serverConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJ.service_role.x' }),
    ).toBeNull();
    expect(
      serverConfig({
        VITE_SUPABASE_URL: 'http://abc',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      }),
    ).toBeNull();
    expect(serverConfig({})).toBeNull();
  });
});

describe('pairing', () => {
  it('keeps no owner session on the device', async () => {
    expect(OWNER_CLIENT_OPTIONS.auth).toMatchObject({
      persistSession: false,
      autoRefreshToken: false,
    });
    const { client, auth } = fakeClient({
      owner_markets: { data: [{ id: 'kursunlu', name: 'Kurşunlu Market' }] },
      create_pairing: { data: 'ABCD2345' },
    });
    const made = await createPairingCode({
      owner: client,
      email: 'sahip@example.com',
      password: 'gizli',
    });
    expect(made).toEqual({ code: 'ABCD2345', market: { id: 'kursunlu', name: 'Kurşunlu Market' } });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('asks which market when the owner has more than one', async () => {
    const markets = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const { client, calls } = fakeClient({
      owner_markets: { data: markets },
      create_pairing: { data: 'ZZZZ2345' },
    });
    expect(
      await createPairingCode({ owner: client, email: 'x@example.com', password: 'p' }),
    ).toEqual({ markets });
    expect(
      await createPairingCode({
        owner: client,
        email: 'x@example.com',
        password: 'p',
        marketId: 'b',
      }),
    ).toEqual({
      code: 'ZZZZ2345',
      market: markets[1],
    });
    expect(calls.filter((call) => call.fn === 'create_pairing').map((call) => call.args)).toEqual([
      { market_id: 'b' },
    ]);
  });

  it('says when the owner has no market or a wrong password', async () => {
    const none = fakeClient({ owner_markets: { data: [] } });
    await expect(
      createPairingCode({ owner: none.client, email: 'x@example.com', password: 'p' }),
    ).rejects.toThrow('Bu hesabın sahibi olduğu market yok.');
    const wrong = fakeClient({});
    wrong.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    } as never);
    await expect(
      createPairingCode({ owner: wrong.client, email: 'x@example.com', password: 'p' }),
    ).rejects.toThrow('E-posta ya da şifre yanlış.');
  });

  it('pairs a register and remembers its market', async () => {
    const { client, calls, auth } = fakeClient({
      claim_device: {
        data: {
          marketId: 'kursunlu',
          marketName: 'Kurşunlu Market',
          deviceId: 'd1',
          deviceCode: 'K2',
        },
      },
    });
    const claimed = await pairDevice({
      device: client,
      code: ' abcd2345 ',
      deviceCode: 'k2',
      deviceName: 'Kasa 2',
      platform: 'web',
    });
    expect(auth.signInAnonymously).toHaveBeenCalled();
    expect(calls).toEqual([
      {
        fn: 'claim_device',
        args: {
          code: 'ABCD2345',
          device_code: 'K2',
          device_name: 'Kasa 2',
          platform: 'web',
          replace: false,
        },
      },
    ]);
    expect(claimed).toEqual({
      marketId: 'kursunlu',
      marketName: 'Kurşunlu Market',
      deviceId: 'd1',
      deviceCode: 'K2',
    });
  });

  it('says when the register code is taken or the code is wrong', async () => {
    const taken = fakeClient({ claim_device: { error: { message: 'device_code_taken' } } });
    await expect(
      pairDevice({
        device: taken.client,
        code: 'ABCD2345',
        deviceCode: 'K2',
        deviceName: 'Kasa 2',
        platform: 'web',
      }),
    ).rejects.toThrow('K2 kodu bu markette kullanılıyor.');
    const invalid = fakeClient({ claim_device: { error: { message: 'pairing_invalid' } } });
    await expect(
      pairDevice({
        device: invalid.client,
        code: 'ABCD2345',
        deviceCode: 'K2',
        deviceName: 'Kasa 2',
        platform: 'web',
      }),
    ).rejects.toThrow('Kod geçersiz ya da süresi doldu. Yeni kod üretin.');
  });

  it('picks up a claim whose answer was lost', async () => {
    const mine = {
      marketId: 'kursunlu',
      marketName: 'Kurşunlu Market',
      deviceId: 'd1',
      deviceCode: 'K2',
    };
    const { client, calls, auth } = fakeClient({
      claim_device: { error: { message: 'already_registered' } },
      my_device: { data: { ...mine, revoked: false } },
    });
    auth.getSession.mockResolvedValue({ data: { session: { user: {} } } } as never);
    const claimed = await pairDevice({
      device: client,
      code: 'ABCD2345',
      deviceCode: 'K2',
      deviceName: 'Kasa 2',
      platform: 'web',
    });
    expect(claimed).toEqual(mine);
    expect(calls.map((call) => call.fn)).not.toContain('claim_device');
  });

  it('starts a new session for a revoked register', async () => {
    const { client, calls, auth } = fakeClient({
      my_device: {
        data: { marketId: 'k', marketName: 'K', deviceId: 'old', deviceCode: 'K1', revoked: true },
      },
      claim_device: { data: { marketId: 'k', marketName: 'K', deviceId: 'new', deviceCode: 'K1' } },
    });
    auth.getSession.mockResolvedValue({ data: { session: { user: {} } } } as never);
    const claimed = await pairDevice({
      device: client,
      code: 'ABCD2345',
      deviceCode: 'K1',
      deviceName: 'Kasa 1',
      platform: 'web',
      replace: true,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.signInAnonymously).toHaveBeenCalled();
    expect(calls.find((call) => call.fn === 'claim_device')?.args).toMatchObject({ replace: true });
    expect(claimed.deviceId).toBe('new');
  });

  it('unpairs a register but keeps its data and queue', () => {
    const paired = {
      ...DEFAULT_DEVICE,
      marketId: 'kursunlu',
      databaseId: 'kursunlu',
      paired: true,
    };
    expect(unpairedSettings(paired)).toEqual({
      ...DEFAULT_DEVICE,
      marketId: 'kursunlu',
      databaseId: 'kursunlu',
    });
    const kept = { ...DEFAULT_DEVICE, marketId: 'kursunlu', paired: true };
    expect(unpairedSettings(kept).databaseId).toBe('kursunlu');
  });

  it('sends this register’s queue to the market when asked', () => {
    const claimed = {
      marketId: 'kursunlu',
      marketName: 'Kurşunlu Market',
      deviceId: 'd1',
      deviceCode: 'K2',
    };
    expect(pairedSettings(DEFAULT_DEVICE, claimed, 'Kasa 2', true)).toEqual({
      marketId: 'kursunlu',
      marketName: 'Kurşunlu Market',
      deviceCode: 'K2',
      deviceName: 'Kasa 2',
      databaseId: 'yerel',
      paired: true,
    });
  });

  it('starts empty without sending the old queue', () => {
    const claimed = {
      marketId: 'kursunlu',
      marketName: 'Kurşunlu Market',
      deviceId: 'd1',
      deviceCode: 'K2',
    };
    expect(pairedSettings(DEFAULT_DEVICE, claimed, 'Kasa 2', false)).toMatchObject({
      marketId: 'kursunlu',
      databaseId: 'kursunlu',
      paired: true,
    });
  });
});

describe('supabase transport', () => {
  it('calls the sync functions', async () => {
    const { client, calls } = fakeClient({
      sync_push: { data: { acknowledged: [1] } },
      sync_pull: { data: { rows: [], latest: 7 } },
    });
    const transport = supabaseTransport(client);
    expect(await transport.push({ ops: [] })).toEqual({ acknowledged: [1] });
    expect(await transport.pull({ since: 7, limit: 500 })).toEqual({ rows: [], latest: 7 });
    expect(calls).toEqual([
      { fn: 'sync_push', args: { ops: [] } },
      { fn: 'sync_pull', args: { since: 7, lim: 500 } },
    ]);
  });

  it('asks to pair again when the session cannot be renewed', async () => {
    const lost = fakeClient({
      sync_pull: { error: { message: 'permission denied for function sync_pull', code: '42501' } },
    });
    await expect(supabaseTransport(lost.client).pull({ since: 0, limit: 1 })).rejects.toThrow(
      DeviceUnpairedError,
    );
    await expect(supabaseTransport(lost.client).pull({ since: 0, limit: 1 })).rejects.toThrow(
      'Kasayı yeniden bağlayın.',
    );
    const unknown = fakeClient({ sync_push: { error: { message: 'device_not_registered' } } });
    await expect(supabaseTransport(unknown.client).push({ ops: [] })).rejects.toThrow(
      DeviceUnpairedError,
    );
    const revoked = fakeClient({ sync_push: { error: { message: 'device_revoked' } } });
    await expect(supabaseTransport(revoked.client).push({ ops: [] })).rejects.toThrow(
      'Bu kasanın kaydı iptal edildi.',
    );
    expect(new DeviceRevokedError()).toBeInstanceOf(Error);
  });
});
