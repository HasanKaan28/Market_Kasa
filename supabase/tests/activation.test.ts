// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Market = { id: string; name: string };
type Claimed = { marketId: string; marketName: string; deviceId: string; deviceCode: string };
type CodeRow = {
  code: string;
  note: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
  expires_in_days: number;
};

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

/** A code as Kaan issues it in the SQL editor (as `postgres`). */
async function issue(note = 'Test Market', days?: number): Promise<string> {
  const [row] = await server.query<{ code: string }>(
    days === undefined
      ? 'select app.issue_activation_code($1) as code'
      : 'select app.issue_activation_code($1, $2) as code',
    days === undefined ? [note] : [note, days],
  );
  return row?.code ?? '';
}

async function codeRow(code: string): Promise<CodeRow | undefined> {
  const [row] = await server.query<CodeRow>(
    `select code, note, used_at, used_by, revoked_at,
       round(extract(epoch from expires_at - created_at) / 86400)::int as expires_in_days
     from app.activation_codes where code = $1`,
    [code],
  );
  return row;
}

describe('the operator issues activation codes', () => {
  it('issues short, unambiguous codes with a note and a 30-day expiry', async () => {
    const codes = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      codes.add(await issue(`Market ${index}`));
    }
    expect(codes.size).toBe(20);
    for (const code of codes) {
      expect(code).toMatch(CODE);
    }
    const [first] = [...codes];
    expect(await codeRow(first ?? '')).toMatchObject({
      note: 'Market 0',
      used_at: null,
      revoked_at: null,
      expires_in_days: 30,
    });
    expect(await codeRow(await issue('Uzun süreli', 90))).toMatchObject({ expires_in_days: 90 });
  });

  it('draws codes from a strong random source', async () => {
    const [definition] = await server.query<{ body: string }>(
      "select pg_get_functiondef('app.new_activation_code()'::regprocedure) as body",
    );
    expect(definition?.body).toContain('gen_random_uuid()');
    expect(definition?.body).not.toContain('random()');
  });

  it('needs a note and a sensible number of days', async () => {
    expect(await errorOf(server.query("select app.issue_activation_code('  ')"))).toContain(
      'bad_note',
    );
    expect(await errorOf(server.query("select app.issue_activation_code('A', 0)"))).toContain(
      'bad_days',
    );
    expect(await errorOf(server.query("select app.issue_activation_code('A', 400)"))).toContain(
      'bad_days',
    );
  });

  it('refuses the generator and the code table to every client role', async () => {
    const owner = await server.addUser({ email: 'kotu@example.com' });
    for (const session of [server.as(owner), server.as(null)]) {
      expect(await errorOf(session.query("select app.issue_activation_code('x')"))).toMatch(
        /permission denied/,
      );
      expect(await errorOf(session.query('select * from app.activation_codes'))).toMatch(
        /permission denied/,
      );
      expect(await errorOf(session.query("select public.issue_activation_code('x')"))).toMatch(
        /does not exist/,
      );
    }
    const [grants] = await server.query<{ anon: boolean; authenticated: boolean; svc: boolean }>(
      `select has_function_privilege('anon', 'app.issue_activation_code(text, integer)', 'execute') as anon,
         has_function_privilege('authenticated', 'app.issue_activation_code(text, integer)', 'execute')
           as authenticated,
         has_function_privilege('service_role', 'app.issue_activation_code(text, integer)', 'execute')
           as svc`,
    );
    expect(grants).toEqual({ anon: false, authenticated: false, svc: true });
  });
});

describe('opening a new market needs an activation code', () => {
  it('opens the market with a valid code and uses the code up', async () => {
    const code = await issue('Kurşunlu Market');
    const owner = await server.addUser({ email: 'emin@example.com' });
    const market = await server
      .as(owner)
      .rpc<Market>('create_own_market', ['Kurşunlu Market', code]);

    expect(market.name).toBe('Kurşunlu Market');
    expect(market.id).toMatch(/^kursunlu-market-[a-z0-9]{6}$/);
    expect(await server.as(owner).rpc('owner_markets')).toEqual([market]);
    expect(await codeRow(code)).toMatchObject({ used_by: owner });
    expect((await codeRow(code))?.used_at).not.toBeNull();
    const [row] = await server.query<{ activation_code: string; activated: boolean }>(
      'select activation_code, activated_at is not null as activated from app.markets where id = $1',
      [market.id],
    );
    expect(row).toEqual({ activation_code: code, activated: true });
  });

  it('reads the code however it was typed', async () => {
    const code = await issue();
    const owner = await server.addUser({ email: 'a@example.com' });
    const typed = ` ${code.toLowerCase().replace('-', ' ')} `;
    expect(
      await server.as(owner).rpc<Market>('create_own_market', ['Market', typed]),
    ).toMatchObject({ name: 'Market' });
  });

  it('reads O as zero and I or L as one, as Crockford base32 does', async () => {
    await server.query(
      "insert into app.activation_codes (code, note) values ('1100-AB2C', 'elle yazılmış')",
    );
    const owner = await server.addUser({ email: 'a@example.com' });
    await server.as(owner).rpc('create_own_market', ['Market', 'ilOO-ab2c']);
    expect((await codeRow('1100-AB2C'))?.used_at).not.toBeNull();
  });

  it('refuses a used, an expired, a revoked and an unknown code, each with its reason', async () => {
    const owner = await server.addUser({ email: 'a@example.com' });
    const other = await server.addUser({ email: 'b@example.com' });
    const used = await issue();
    await server.as(owner).rpc('create_own_market', ['Bir', used]);
    expect(await errorOf(server.as(other).rpc('create_own_market', ['İki', used]))).toContain(
      'activation_used',
    );

    const expired = await issue();
    await server.query(
      "update app.activation_codes set expires_at = now() - interval '1 minute' where code = $1",
      [expired],
    );
    expect(await errorOf(server.as(other).rpc('create_own_market', ['İki', expired]))).toContain(
      'activation_expired',
    );

    const revoked = await issue();
    await server.query('update app.activation_codes set revoked_at = now() where code = $1', [
      revoked,
    ]);
    expect(await errorOf(server.as(other).rpc('create_own_market', ['İki', revoked]))).toContain(
      'activation_invalid',
    );

    for (const unknown of ['ZZZZ-ZZZZ', 'kısa', '', null]) {
      expect(
        await errorOf(server.as(other).rpc('create_own_market', ['İki', unknown])),
        String(unknown),
      ).toContain('activation_invalid');
    }
    expect(await server.as(other).rpc('owner_markets')).toEqual([]);
    expect((await codeRow(expired))?.used_at).toBeNull();
  });

  it('tells a register built before codes to update', async () => {
    const owner = await server.addUser({ email: 'a@example.com' });
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['Market']))).toContain(
      'activation_required',
    );
    expect(await server.as(owner).rpc('owner_markets')).toEqual([]);
  });

  it('keeps the code unused when the market is refused for another reason', async () => {
    const code = await issue();
    const anonymous = await server.addUser({ anonymous: true });
    expect(await errorOf(server.as(anonymous).rpc('create_own_market', ['X', code]))).toContain(
      'not_signed_in',
    );
    const owner = await server.addUser({ email: 'a@example.com' });
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['  ', code]))).toContain(
      'bad_name',
    );
    expect((await codeRow(code))?.used_at).toBeNull();
  });

  it('still allows three markets per person, and a fourth code stays unused', async () => {
    const owner = await server.addUser({ email: 'a@example.com' });
    for (const name of ['Bir', 'İki', 'Üç']) {
      await server.as(owner).rpc('create_own_market', [name, await issue(name)]);
    }
    const fourth = await issue('Dört');
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['Dört', fourth]))).toContain(
      'too_many_markets',
    );
    expect((await codeRow(fourth))?.used_at).toBeNull();
  });

  it('takes the per-person lock before counting markets or using the code', async () => {
    const [definition] = await server.query<{ body: string }>(
      "select pg_get_functiondef('public.create_own_market(text, text)'::regprocedure) as body",
    );
    const body = definition?.body ?? '';
    expect(body).toContain("pg_advisory_xact_lock(hashtext('owner:' || auth.uid()::text))");
    expect(body.indexOf('pg_advisory_xact_lock')).toBeLessThan(body.indexOf('count(*)'));
    expect(body.indexOf('count(*)')).toBeLessThan(body.indexOf('update app.activation_codes'));
  });

  it('keeps security definer, the empty search path and the grants', async () => {
    const rows = await server.query<{
      name: string;
      definer: boolean;
      config: string[];
      anon: boolean;
      authenticated: boolean;
    }>(
      `select p.oid::regprocedure::text as name, p.prosecdef as definer, p.proconfig as config,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated
       from pg_proc p
       where p.oid in ('public.create_own_market(text)'::regprocedure,
         'public.create_own_market(text, text)'::regprocedure)`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row, row.name).toMatchObject({
        definer: true,
        config: ['search_path=""'],
        anon: false,
        authenticated: true,
      });
    }
  });
});

describe('markets that existed before codes', () => {
  const EXISTING = `
    insert into auth.users (id, email) values
      ('00000000-0000-4000-8000-000000000001', 'emin@example.com');
    insert into app.markets (id, name) values ('kursunlu-ab12cd', 'Kurşunlu Market');
    insert into app.memberships (market_id, user_id, role) values
      ('kursunlu-ab12cd', '00000000-0000-4000-8000-000000000001', 'owner');
  `;
  const EMIN = '00000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    server = await createTestServer({
      before: { migration: '20261120170000', sql: EXISTING },
    });
  });

  it('are marked activated by the migration, without a code', async () => {
    const [row] = await server.query<{ activated: boolean; activation_code: string | null }>(
      `select activated_at is not null as activated, activation_code
       from app.markets where id = 'kursunlu-ab12cd'`,
    );
    expect(row).toEqual({ activated: true, activation_code: null });
  });

  it('keep their owner, who signs in and pairs new registers with no code', async () => {
    expect(await server.as(EMIN).rpc('owner_markets')).toEqual([
      { id: 'kursunlu-ab12cd', name: 'Kurşunlu Market' },
    ]);
    const pair = async () => {
      const code = await server.as(EMIN).rpc<string>('create_pairing', ['kursunlu-ab12cd']);
      const device = await server.addUser({ anonymous: true });
      return server.as(device).rpc<Claimed>('claim_device', [code, null, 'Kasa', 'windows']);
    };
    expect((await pair()).deviceCode).toBe('K1');
    expect((await pair()).deviceCode).toBe('K2');
  });

  it('let a reinstalled register take its old code back with the owner’s pairing code', async () => {
    const first = await server.as(EMIN).rpc<string>('create_pairing', ['kursunlu-ab12cd']);
    const old = await server.addUser({ anonymous: true });
    await server.as(old).rpc('claim_device', [first, 'K1', 'Kasa 1', 'windows']);

    const again = await server.as(EMIN).rpc<string>('create_pairing', ['kursunlu-ab12cd']);
    const reinstalled = await server.addUser({ anonymous: true });
    const claimed = await server
      .as(reinstalled)
      .rpc<Claimed>('claim_device', [again, 'K1', 'Kasa 1', 'windows', true]);
    expect(claimed).toMatchObject({ marketId: 'kursunlu-ab12cd', deviceCode: 'K1' });
    expect(await server.as(reinstalled).rpc('my_device')).toMatchObject({
      marketId: 'kursunlu-ab12cd',
      deviceCode: 'K1',
    });
  });

  it('count toward the owner’s three markets, and a new one still needs a code', async () => {
    expect(
      await errorOf(server.as(EMIN).rpc('create_own_market', ['İkinci', 'ZZZZ-ZZZZ'])),
    ).toContain('activation_invalid');
    await server.as(EMIN).rpc('create_own_market', ['İkinci', await issue()]);
    await server.as(EMIN).rpc('create_own_market', ['Üçüncü', await issue()]);
    expect(
      await errorOf(server.as(EMIN).rpc('create_own_market', ['Dördüncü', await issue()])),
    ).toContain('too_many_markets');
  });
});
