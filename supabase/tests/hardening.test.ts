// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type Session, type TestServer } from './harness';

type PushResult = { acknowledged: number[]; rejected?: { seq: number; reason: string }[] };
type PullResult = { rows: { table: string; id: string; row: Record<string, unknown> }[] };

let seq = 0;
const insert = (table: string, recordId: string, record: object) => ({
  kind: 'insert',
  table,
  recordId,
  record,
  seq: ++seq,
  opId: crypto.randomUUID(),
  createdAt: '2026-11-20T07:05:00.000Z',
});
const patch = (table: string, recordId: string, fields: object) => ({
  kind: 'patch',
  table,
  recordId,
  patch: fields,
  seq: ++seq,
  opId: crypto.randomUUID(),
  createdAt: '2026-11-20T07:06:00.000Z',
});

const person = (id: string, role = 'owner') => ({
  id,
  name: id === 'o1' ? 'Emin' : 'Ayşe',
  role,
  permissions: {},
  pinHash: 'aGFzaA==',
  pinSalt: 'c2FsdA==',
  pinIterations: 150000,
  createdAt: '2026-11-20T07:00:00.000Z',
  updatedAt: '2026-11-20T07:00:00.000Z',
});

let server: TestServer;
let session: Session;

beforeEach(async () => {
  server = await createTestServer();
  await server.addMarket('a', 'A Market');
  session = server.as((await server.addDevice('a', 'K1')).userId);
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

/** The reason each op was refused for, or 'ok', in the order sent. */
async function outcome(...ops: { seq: number }[]): Promise<string[]> {
  const result = await session.rpc<PushResult>('sync_push', [ops]);
  return ops.map(
    (op) =>
      result.rejected?.find((rejection) => rejection.seq === op.seq)?.reason ??
      (result.acknowledged.includes(op.seq) ? 'ok' : 'unanswered'),
  );
}

async function stored(table: string, id: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await server.query<{ row: Record<string, unknown> }>(
    "select row from app.rows where market_id = 'a' and tbl = $1 and id = $2",
    [table, id],
  );
  return row?.row;
}

describe('push size', () => {
  it('refuses more than a thousand operations in one call', async () => {
    const ops = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        insert('categories', `c${index}`, { id: `c${index}`, name: 'K' }),
      );
    expect(await errorOf(session.rpc('sync_push', [ops(1001)]))).toContain('too_many_ops');
    const result = await session.rpc<PushResult>('sync_push', [ops(1000)]);
    expect(result.acknowledged).toHaveLength(1000);
  });

  it('refuses a record over a megabyte, as sent or once merged', async () => {
    const big = 'x'.repeat(1_100_000);
    const half = 'y'.repeat(600_000);
    expect(
      await outcome(
        insert('products', 'p1', { id: 'p1', name: big }),
        insert('products', 'p2', { id: 'p2', name: 'Süt', note: half }),
        patch('products', 'p2', { other: half }),
      ),
    ).toEqual(['too_large', 'ok', 'too_large']);
    expect(await stored('products', 'p1')).toBeUndefined();
    expect(await stored('products', 'p2')).not.toHaveProperty('other');
  });

  it('keeps a shelf count of three thousand products', async () => {
    const lines = Array.from({ length: 3000 }, (_, index) => ({
      productId: `01JCZ${String(index).padStart(21, '0')}`,
      name: `Ülker Çikolatalı Gofret ${index}`,
      unit: 'piece',
      expectedMilli: 12000,
      knownBeforeMilli: 12000,
      countedMilli: 11000,
    }));
    expect(
      await outcome(insert('stockCounts', 'n1', { id: 'n1', deviceCode: 'K1', lines })),
    ).toEqual(['ok']);
  });
});

describe('record ids', () => {
  it('keeps a record under its own id', async () => {
    expect(
      await outcome(
        insert('products', 'p1', { id: 'p2', name: 'Süt' }),
        insert('products', 'p1', { id: 'p1', name: 'Süt' }),
        patch('products', 'p1', { id: null }),
        patch('products', 'p1', { id: 'p9' }),
        patch('products', 'p1', { id: 'p1', name: 'Ayran' }),
        insert('sales', 's1', { id: 's2', total: 1 }),
      ),
    ).toEqual(['id_mismatch', 'ok', 'id_mismatch', 'id_mismatch', 'ok', 'id_mismatch']);
    expect(await stored('products', 'p1')).toEqual({ id: 'p1', name: 'Ayran' });
    expect(await stored('products', 'p2')).toBeUndefined();
  });

  it('keeps a record sent without an id as it was sent', async () => {
    expect(await outcome(insert('settings', 'market', { cutoffMinutes: 0 }))).toEqual(['ok']);
    expect(await stored('settings', 'market')).toEqual({ cutoffMinutes: 0 });
  });

  it('checks only size and id on a table it does not know, as another app on the server', async () => {
    await server.exec(`create or replace function app.entity_tables() returns text[]
      language sql immutable as $$ select array['products', 'staff', 'tabs'] $$`);
    expect(
      await outcome(
        insert('tabs', 't1', { id: 't1', tableId: 'd1', role: null, name: null }),
        patch('tabs', 't1', { closedAt: '2026-11-20T08:00:00.000Z', pinHash: null }),
        insert('tabs', 't2', { id: 't3' }),
      ),
    ).toEqual(['ok', 'ok', 'id_mismatch']);
  });
});

describe('staff', () => {
  it('keeps every person’s name, role and PIN hash', async () => {
    expect(
      await outcome(
        insert('staff', 'o1', person('o1')),
        insert('staff', 'c1', { ...person('c1', 'cashier'), pinHash: null }),
        patch('staff', 'o1', { pinHash: null }),
        patch('staff', 'o1', { role: null }),
        patch('staff', 'o1', { name: null }),
        patch('staff', 'o1', { name: 'Emin Bey', updatedAt: '2026-11-20T08:00:00.000Z' }),
      ),
    ).toEqual(['ok', 'missing_field', 'missing_field', 'missing_field', 'missing_field', 'ok']);
    expect(await stored('staff', 'o1')).toMatchObject({ name: 'Emin Bey', role: 'owner' });
  });

  it('refuses a PIN hash of more than two million iterations', async () => {
    expect(
      await outcome(
        insert('staff', 'o1', { ...person('o1'), pinIterations: 2_000_001 }),
        insert('staff', 'o1', person('o1')),
        patch('staff', 'o1', { pinHash: 'bmV3', pinIterations: 1e9 }),
        patch('staff', 'o1', { pinIterations: '150000' }),
        patch('staff', 'o1', { pinHash: 'bmV3', pinIterations: 2_000_000 }),
      ),
    ).toEqual(['bad_pin_iterations', 'ok', 'bad_pin_iterations', 'bad_pin_iterations', 'ok']);
  });

  it('keeps the last active owner', async () => {
    expect(
      await outcome(
        insert('staff', 'o1', person('o1')),
        insert('staff', 'c1', person('c1', 'cashier')),
        patch('staff', 'o1', { archivedAt: '2026-11-20T08:00:00.000Z' }),
        patch('staff', 'o1', { role: 'manager' }),
        patch('staff', 'c1', { archivedAt: '2026-11-20T08:00:00.000Z' }),
      ),
    ).toEqual(['ok', 'ok', 'last_owner', 'last_owner', 'ok']);
    expect(await stored('staff', 'o1')).toMatchObject({ role: 'owner' });
    expect(await stored('staff', 'o1')).not.toHaveProperty('archivedAt');
  });

  it('lets an owner go once another owner is active', async () => {
    expect(
      await outcome(
        insert('staff', 'o1', person('o1')),
        insert('staff', 'o2', { ...person('o2'), archivedAt: '2026-11-19T08:00:00.000Z' }),
        patch('staff', 'o1', { role: 'manager' }),
        patch('staff', 'o2', { archivedAt: null }),
        patch('staff', 'o1', { role: 'manager' }),
        patch('staff', 'o1', { archivedAt: '2026-11-20T08:00:00.000Z' }),
      ),
    ).toEqual(['ok', 'ok', 'last_owner', 'ok', 'ok', 'ok']);
  });

  it('sends a refused record again, so the register’s value reverts', async () => {
    await outcome(insert('staff', 'o1', person('o1')));
    const before = await session.rpc<PullResult>('sync_pull', [0, 100]);
    const latest = (before as unknown as { latest: number }).latest;
    expect(await outcome(patch('staff', 'o1', { role: 'cashier' }))).toEqual(['last_owner']);
    const after = await session.rpc<PullResult>('sync_pull', [latest, 100]);
    expect(after.rows.map(({ id, row }) => [id, row.role])).toEqual([['o1', 'owner']]);
  });
});

describe('a suspended market', () => {
  it('refuses its registers until it is active again', async () => {
    await server.query("update app.markets set status = 'suspended' where id = 'a'");
    expect(await errorOf(session.rpc('sync_push', [[]]))).toContain('market_suspended');
    expect(await errorOf(session.rpc('sync_pull', [0, 10]))).toContain('market_suspended');

    await server.query("update app.markets set status = 'active' where id = 'a'");
    expect(await session.rpc('sync_push', [[]])).toEqual({ acknowledged: [] });
  });

  // A push waits on the market's lock while another push runs. Here the lock itself suspends the
  // market or revokes the register, as a change committed during that wait would.
  it('refuses a push whose market was suspended while it waited for the lock', async () => {
    await server.exec(`create or replace function app.lock_market(p_market text) returns void
      language sql set search_path = '' as $$
        update app.markets set status = 'suspended' where id = p_market
      $$`);
    expect(
      await errorOf(
        session.rpc('sync_push', [[insert('products', 'p1', { id: 'p1', name: 'Süt' })]]),
      ),
    ).toContain('market_suspended');
    expect(await stored('products', 'p1')).toBeUndefined();
  });

  it('refuses a push whose register was revoked while it waited for the lock', async () => {
    await server.exec(`create or replace function app.lock_market(p_market text) returns void
      language sql set search_path = '' as $$
        update app.devices set revoked_at = now() where market_id = p_market
      $$`);
    expect(
      await errorOf(
        session.rpc('sync_push', [[insert('products', 'p1', { id: 'p1', name: 'Süt' })]]),
      ),
    ).toContain('device_revoked');
    expect(await stored('products', 'p1')).toBeUndefined();
  });

  it('gives its owner no pairing code until it is active again', async () => {
    const owner = await server.addOwner('a');
    await server.query("update app.markets set status = 'suspended' where id = 'a'");
    expect(await errorOf(server.as(owner).rpc('create_pairing', ['a']))).toContain(
      'market_suspended',
    );
    const [{ count } = { count: -1 }] = await server.query<{ count: number }>(
      "select count(*)::int as count from app.pairings where market_id = 'a'",
    );
    expect(count).toBe(0);

    await server.query("update app.markets set status = 'active' where id = 'a'");
    expect(await server.as(owner).rpc<string>('create_pairing', ['a'])).toMatch(
      /^[A-HJ-NP-Z2-9]{8}$/,
    );
  });

  it('still tells a stranger it is not their market', async () => {
    const other = await server.addUser({ email: 'x@example.com' });
    await server.query("update app.markets set status = 'suspended' where id = 'a'");
    expect(await errorOf(server.as(other).rpc('create_pairing', ['a']))).toContain('not_owner');
  });

  it('does not refuse a market whose licence ended', async () => {
    await server.query(
      "update app.markets set license_expires_at = now() - interval '30 days' where id = 'a'",
    );
    expect(await outcome(insert('products', 'p1', { id: 'p1', name: 'Süt' }))).toEqual(['ok']);
  });
});

describe('opening a market', () => {
  it('takes a lock per person before counting their markets', async () => {
    const [definition] = await server.query<{ body: string }>(
      "select pg_get_functiondef('public.create_own_market(text)'::regprocedure) as body",
    );
    const body = definition?.body ?? '';
    expect(body).toContain("pg_advisory_xact_lock(hashtext('owner:' || auth.uid()::text))");
    expect(body.indexOf('pg_advisory_xact_lock')).toBeLessThan(body.indexOf('count(*)'));
  });

  it('draws market ids and pairing codes from a strong random source', async () => {
    for (const name of ['app.market_id_for(text)', 'public.create_pairing(text)']) {
      const [definition] = await server.query<{ body: string }>(
        `select pg_get_functiondef('${name}'::regprocedure) as body`,
      );
      expect(definition?.body, name).not.toContain('random()');
      expect(definition?.body, name).toContain('gen_random_uuid()');
    }
    const owner = await server.addOwner('a');
    const codes = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      codes.add(await server.as(owner).rpc<string>('create_pairing', ['a']));
    }
    expect(codes.size).toBe(20);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
    const [{ id } = { id: '' }] = await server.query<{ id: string }>(
      "select app.market_id_for('Kurşunlu Market') as id",
    );
    expect(id).toMatch(/^kursunlu-market-[a-z0-9]{6}$/);
  });

  it('keeps the empty search path on every function it replaced', async () => {
    const config = await server.query<{ name: string; config: string[] }>(
      `select p.oid::regprocedure::text as name, p.proconfig as config from pg_proc p
       where p.oid in ('app.apply_op(text, jsonb)'::regprocedure, 'public.sync_push(jsonb)'::regprocedure,
         'app.current_device()'::regprocedure, 'public.my_device()'::regprocedure,
         'app.market_id_for(text)'::regprocedure, 'public.create_pairing(text)'::regprocedure,
         'public.create_own_market(text)'::regprocedure)`,
    );
    expect(config).toHaveLength(7);
    for (const { name, config: settings } of config) {
      expect(settings, name).toEqual(['search_path=""']);
    }
  });
});
