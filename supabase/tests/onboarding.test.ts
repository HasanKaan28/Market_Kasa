// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Market = { id: string; name: string };
type Claimed = { marketId: string; marketName: string; deviceId: string; deviceCode: string };

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

describe('a shop opens its own market', () => {
  it('opens a market for the person who signed in and makes them its owner', async () => {
    const owner = await server.addUser({ email: 'emin@example.com' });
    const market = await server.as(owner).rpc<Market>('create_own_market', ['Kurşunlu Market']);

    expect(market.name).toBe('Kurşunlu Market');
    expect(market.id).toMatch(/^kursunlu-market-[a-z0-9]{6}$/);
    expect(await server.as(owner).rpc('owner_markets')).toEqual([market]);
  });

  it('refuses an anonymous session, an empty name and a fourth market', async () => {
    const anonymous = await server.addUser({ anonymous: true });
    expect(await errorOf(server.as(anonymous).rpc('create_own_market', ['X']))).toContain(
      'not_signed_in',
    );
    const owner = await server.addUser({ email: 'a@example.com' });
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['  ']))).toContain('bad_name');
    for (const name of ['Bir', 'İki', 'Üç']) {
      await server.as(owner).rpc('create_own_market', [name]);
    }
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['Dört']))).toContain(
      'too_many_markets',
    );
  });

  it('gives each new register the next free code when none is asked for', async () => {
    const owner = await server.addUser({ email: 'b@example.com' });
    const market = await server.as(owner).rpc<Market>('create_own_market', ['Market']);
    const join = async () => {
      const code = await server.as(owner).rpc<string>('create_pairing', [market.id]);
      const device = await server.addUser({ anonymous: true });
      return server.as(device).rpc<Claimed>('claim_device', [code, null, 'Kasa', 'web']);
    };

    expect((await join()).deviceCode).toBe('K1');
    expect((await join()).deviceCode).toBe('K2');
    await server.query("update app.devices set revoked_at = now() where code = 'K1'");
    expect((await join()).deviceCode).toBe('K1');
    expect((await join()).deviceCode).toBe('K3');
  });
});
