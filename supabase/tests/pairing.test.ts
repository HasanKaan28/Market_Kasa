// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Claimed = { marketId: string; marketName: string; deviceId: string; deviceCode: string };
type Mine = Claimed & { revoked: boolean };

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
  await server.addMarket('a', 'A Market');
  await server.addMarket('b', 'B Market');
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const claim = (userId: string, code: string, deviceCode = 'K1') =>
  server.as(userId).rpc<Claimed>('claim_device', [code, deviceCode, `Kasa ${deviceCode}`, 'web']);

describe('pairing', () => {
  it('lists only the markets a person owns', async () => {
    const owner = await server.addOwner('a');
    await server.query(
      "insert into app.memberships (market_id, user_id, role) values ('b', $1, 'manager')",
      [owner],
    );
    const anonymous = await server.addUser({ anonymous: true });

    expect(await server.as(owner).rpc('owner_markets')).toEqual([{ id: 'a', name: 'A Market' }]);
    expect(await server.as(anonymous).rpc('owner_markets')).toEqual([]);
  });

  it('gives a pairing code only to an owner who signed in with a password', async () => {
    const owner = await server.addOwner('a');
    const code = await server.as(owner).rpc<string>('create_pairing', ['a']);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    expect(await errorOf(server.as(owner).rpc('create_pairing', ['b']))).toContain('not_owner');
    const anonymous = await server.addUser({ anonymous: true });
    expect(await errorOf(server.as(anonymous).rpc('create_pairing', ['a']))).toContain('not_owner');
    expect(await errorOf(server.as(null).rpc('create_pairing', ['a']))).toContain(
      'permission denied',
    );
  });

  it('uses a pairing code once', async () => {
    const owner = await server.addOwner('a');
    const code = await server.as(owner).rpc<string>('create_pairing', ['a']);
    const first = await server.addUser({ anonymous: true });
    const second = await server.addUser({ anonymous: true });

    const claimed = await claim(first, code);
    expect(claimed).toMatchObject({ marketId: 'a', marketName: 'A Market', deviceCode: 'K1' });
    expect(claimed.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await errorOf(claim(second, code, 'K2'))).toContain('pairing_invalid');
    expect(await errorOf(claim(second, 'NOPE2345', 'K2'))).toContain('pairing_invalid');
  });

  it('refuses an expired code', async () => {
    const owner = await server.addOwner('a');
    const code = await server.as(owner).rpc<string>('create_pairing', ['a']);
    await server.query("update app.pairings set expires_at = now() - interval '1 second'");
    const device = await server.addUser({ anonymous: true });

    expect(await errorOf(claim(device, code))).toContain('pairing_invalid');
  });

  it('keeps register codes unique in a market', async () => {
    const owner = await server.addOwner('a');
    const pairing = () => server.as(owner).rpc<string>('create_pairing', ['a']);
    const first = await server.addUser({ anonymous: true });
    const second = await server.addUser({ anonymous: true });
    const third = await server.addUser({ anonymous: true });
    const firstClaim = await claim(first, await pairing(), 'K1');

    expect(await errorOf(claim(second, await pairing(), 'K1'))).toContain('device_code_taken');
    expect(await errorOf(claim(second, await pairing(), 'k1'))).toContain('device_code_taken');
    expect(await errorOf(claim(first, await pairing(), 'K2'))).toContain('already_registered');
    expect(
      await errorOf(
        server.as(second).rpc('claim_device', [await pairing(), 'K2', 'Kasa 2', 'ios']),
      ),
    ).toContain('bad_platform');

    await server.as(owner).rpc('revoke_device', [firstClaim.deviceId]);
    expect(await claim(third, await pairing(), 'K1')).toMatchObject({ deviceCode: 'K1' });
  });

  it('takes over a register code only when asked', async () => {
    const owner = await server.addOwner('a');
    const old = await server.addUser({ anonymous: true });
    const fresh = await server.addUser({ anonymous: true });
    const first = await claim(old, await server.as(owner).rpc('create_pairing', ['a']), 'K1');
    const code = await server.as(owner).rpc<string>('create_pairing', ['a']);
    expect(await errorOf(claim(fresh, code, 'K1'))).toContain('device_code_taken');

    const taken = await server
      .as(fresh)
      .rpc<Claimed>('claim_device', [code, 'K1', 'Kasa 1', 'web', true]);
    expect(taken.deviceCode).toBe('K1');
    expect(await errorOf(server.as(old).rpc('sync_pull', [0, 10]))).toContain('device_revoked');
    expect(first.deviceId).not.toBe(taken.deviceId);
  });

  it('lets only the owner revoke a device', async () => {
    const owner = await server.addOwner('a');
    const other = await server.addOwner('b');
    const device = await server.addUser({ anonymous: true });
    const { deviceId } = await claim(device, await server.as(owner).rpc('create_pairing', ['a']));

    expect(await errorOf(server.as(other).rpc('revoke_device', [deviceId]))).toContain('not_owner');
    expect(await errorOf(server.as(device).rpc('revoke_device', [deviceId]))).toContain(
      'not_owner',
    );
    await server.as(owner).rpc('revoke_device', [deviceId]);
    expect(await errorOf(server.as(device).rpc('sync_pull', [0, 10]))).toContain('device_revoked');
  });

  it('tells a device where it belongs', async () => {
    const owner = await server.addOwner('a');
    const device = await server.addUser({ anonymous: true });
    expect(await server.as(device).rpc('my_device')).toBeNull();

    const claimed = await claim(device, await server.as(owner).rpc('create_pairing', ['a']));
    expect(await server.as(device).rpc<Mine>('my_device')).toEqual({ ...claimed, revoked: false });

    await server.as(owner).rpc('revoke_device', [claimed.deviceId]);
    expect((await server.as(device).rpc<Mine>('my_device')).revoked).toBe(true);
  });

  it('opens a market only from the operator role', async () => {
    await server.addUser({ email: 'sahip@example.com' });
    await server.query(
      "select app.create_market('kursunlu', 'Kurşunlu Market', 'sahip@example.com')",
    );
    const [market] = await server.query<{ name: string }>(
      "select name from app.markets where id = 'kursunlu'",
    );
    expect(market?.name).toBe('Kurşunlu Market');
    const [membership] = await server.query<{ role: string }>(
      "select role from app.memberships where market_id = 'kursunlu'",
    );
    expect(membership?.role).toBe('owner');

    expect(
      await errorOf(server.query("select app.create_market('x', 'X', 'yok@example.com')")),
    ).toContain('owner_not_found');
    const owner = await server.addOwner('a');
    expect(
      await errorOf(
        server.as(owner).query("select app.create_market('y', 'Y', 'sahip@example.com')"),
      ),
    ).toContain('permission denied');
  });

  it('takes the market lock before every write', async () => {
    for (const name of ['sync_push', 'claim_device', 'revoke_device']) {
      const [definition] = await server.query<{ body: string }>(
        `select pg_get_functiondef(p.oid) as body from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1`,
        [name],
      );
      expect(definition?.body, name).toContain('app.lock_market(');
    }
  });
});
