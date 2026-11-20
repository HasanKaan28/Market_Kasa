// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Code = {
  code: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  status: 'unused' | 'used' | 'expired' | 'revoked';
  marketId: string | null;
  marketName: string | null;
};
type Market = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
  activatedAt: string | null;
  devices: number;
  lastSyncAt: string | null;
  ownerEmail: string | null;
};

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Every operator function, with arguments it accepts from an operator. */
const OPERATOR_CALLS: [string, unknown[]][] = [
  ['op_whoami', []],
  ['op_issue_code', ['Test', 30]],
  ['op_list_codes', []],
  ['op_revoke_code', ['ABCD-2345']],
  ['op_extend_code', ['ABCD-2345', 30]],
  ['op_list_markets', []],
  ['op_set_market_status', ['kursunlu', 'suspended']],
];

const SIGNATURES = [
  'public.op_whoami()',
  'public.op_issue_code(text, integer)',
  'public.op_list_codes()',
  'public.op_revoke_code(text)',
  'public.op_extend_code(text, integer)',
  'public.op_list_markets()',
  'public.op_set_market_status(text, text)',
];

let server: TestServer;
let operator: string;

beforeEach(async () => {
  server = await createTestServer();
  // Signed in with a password (not anonymous), with no email: the panel never needs one.
  operator = await server.addUser({ anonymous: false });
  await server.query('insert into app.operators (user_id) values ($1)', [operator]);
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const op = () => server.as(operator);

describe('who may use the operator functions', () => {
  it('refuses every operator function to a signed-in person who is not an operator', async () => {
    const stranger = await server.addUser({ anonymous: false });
    await server.addMarket('kursunlu', 'Kurşunlu Market');
    for (const [name, args] of OPERATOR_CALLS) {
      expect(await errorOf(server.as(stranger).rpc(name, args)), name).toContain('not_operator');
    }
    const [market] = await server.query<{ status: string }>(
      "select status from app.markets where id = 'kursunlu'",
    );
    expect(market?.status).toBe('active');
    const [codes] = await server.query<{ n: number }>(
      'select count(*)::int as n from app.activation_codes',
    );
    expect(codes?.n).toBe(0);
  });

  it('refuses a register’s anonymous session, even one listed as an operator', async () => {
    await server.addMarket('kursunlu');
    const { userId } = await server.addDevice('kursunlu', 'K1');
    await server.query('insert into app.operators (user_id) values ($1)', [userId]);
    for (const [name, args] of OPERATOR_CALLS) {
      expect(await errorOf(server.as(userId).rpc(name, args)), name).toContain('not_operator');
    }
  });

  it('gives anon no execute on any operator function', async () => {
    for (const [name, args] of OPERATOR_CALLS) {
      expect(await errorOf(server.as(null).rpc(name, args)), name).toMatch(/permission denied/);
    }
    for (const signature of SIGNATURES) {
      const [grants] = await server.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
           has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth,
           has_function_privilege('service_role', $1::regprocedure, 'execute') as svc`,
        [signature],
      );
      expect(grants, signature).toEqual({ anon: false, auth: true, svc: false });
    }
  });

  it('keeps the operators table and the check out of every client role’s reach', async () => {
    for (const session of [server.as(operator), server.as(null)]) {
      expect(await errorOf(session.query('select * from app.operators'))).toMatch(
        /permission denied/,
      );
      expect(await errorOf(session.query('select app.is_operator()'))).toMatch(/permission denied/);
    }
    const [table] = await server.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'app.operators'::regclass",
    );
    expect(table?.rls).toBe(true);
    const [grants] = await server.query<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants
       where table_schema = 'app' and table_name = 'operators'
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`,
    );
    expect(grants?.n).toBe(0);
  });

  it('runs every operator function as security definer with an empty search path', async () => {
    for (const signature of SIGNATURES) {
      const [fn] = await server.query<{ definer: boolean; config: string[] | null }>(
        'select prosecdef as definer, proconfig as config from pg_proc where oid = $1::regprocedure',
        [signature],
      );
      expect(fn, signature).toEqual({ definer: true, config: ['search_path=""'] });
    }
  });
});

describe('the one-time operator claim', () => {
  let email: string;

  beforeEach(async () => {
    // A fresh server with no operator, and a claim for one address.
    server = await createTestServer();
    email = `${crypto.randomUUID()}@example.com`;
    await server.query('insert into app.operator_claims (email) values ($1)', [email]);
  });

  const operators = async () =>
    (await server.query<{ user_id: string }>('select user_id from app.operators')).map(
      (row) => row.user_id,
    );

  it('makes the person with the claimed email the operator, once, and spends the claim', async () => {
    const kaan = await server.addUser({ email: email.toUpperCase() });
    expect(await server.as(kaan).rpc('op_claim')).toBe(true);
    expect(await operators()).toEqual([kaan]);
    expect(await server.query('select * from app.operator_claims')).toEqual([]);
    expect(await server.as(kaan).rpc('op_whoami')).toBe(true);
    // A second call changes nothing and says so.
    expect(await server.as(kaan).rpc('op_claim')).toBe(false);
    expect(await operators()).toEqual([kaan]);
  });

  it('refuses another email', async () => {
    const stranger = await server.addUser({ email: `${crypto.randomUUID()}@example.com` });
    expect(await server.as(stranger).rpc('op_claim')).toBe(false);
    expect(await operators()).toEqual([]);
    expect(await server.query('select * from app.operator_claims')).toHaveLength(1);
  });

  it('refuses everyone once an operator exists, even the claimed email', async () => {
    const first = await server.addUser({ anonymous: false });
    await server.query('insert into app.operators (user_id) values ($1)', [first]);
    const claimant = await server.addUser({ email });
    expect(await server.as(claimant).rpc('op_claim')).toBe(false);
    expect(await operators()).toEqual([first]);
  });

  it('refuses an anonymous register', async () => {
    await server.addMarket('kursunlu');
    const { userId } = await server.addDevice('kursunlu', 'K1');
    expect(await server.as(userId).rpc('op_claim')).toBe(false);
    expect(await operators()).toEqual([]);
  });

  it('gives anon no execute, and keeps the claims table out of every client role’s reach', async () => {
    expect(await errorOf(server.as(null).rpc('op_claim'))).toMatch(/permission denied/);
    const [grants] = await server.query<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', 'public.op_claim()', 'execute') as anon,
         has_function_privilege('authenticated', 'public.op_claim()', 'execute') as auth,
         has_function_privilege('service_role', 'public.op_claim()', 'execute') as svc`,
    );
    expect(grants).toEqual({ anon: false, auth: true, svc: false });
    const [fn] = await server.query<{ definer: boolean; config: string[] | null }>(
      "select prosecdef as definer, proconfig as config from pg_proc where oid = 'public.op_claim()'::regprocedure",
    );
    expect(fn).toEqual({ definer: true, config: ['search_path=""'] });
    const user = await server.addUser({ email });
    expect(await errorOf(server.as(user).query('select * from app.operator_claims'))).toMatch(
      /permission denied/,
    );
    const [table] = await server.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'app.operator_claims'::regclass",
    );
    expect(table?.rls).toBe(true);
  });
});

describe('the operator’s codes', () => {
  it('says the operator is one', async () => {
    expect(await op().rpc('op_whoami')).toBe(true);
  });

  it('issues a code with the generator’s rules', async () => {
    const code = await op().rpc<string>('op_issue_code', ['Yıldız Bakkal', 7]);
    expect(code).toMatch(CODE);
    const [row] = await server.query<{ note: string; days: number }>(
      `select note, round(extract(epoch from expires_at - created_at) / 86400)::int as days
       from app.activation_codes where code = $1`,
      [code],
    );
    expect(row).toEqual({ note: 'Yıldız Bakkal', days: 7 });
    expect(await errorOf(op().rpc('op_issue_code', ['  ', 7]))).toContain('bad_note');
    expect(await errorOf(op().rpc('op_issue_code', ['A', 0]))).toContain('bad_days');
    expect(await errorOf(op().rpc('op_issue_code', ['A', 400]))).toContain('bad_days');
  });

  it('lists codes newest first, each with its status and the market it opened', async () => {
    const used = await op().rpc<string>('op_issue_code', ['Kurşunlu', 30]);
    const revoked = await op().rpc<string>('op_issue_code', ['İptal', 30]);
    const expired = await op().rpc<string>('op_issue_code', ['Eski', 30]);
    const fresh = await op().rpc<string>('op_issue_code', ['Yeni', 30]);
    const owner = await server.addUser({ anonymous: false });
    const market = await server
      .as(owner)
      .rpc<{ id: string }>('create_own_market', ['Kurşunlu Market', used]);
    await op().rpc('op_revoke_code', [revoked]);
    await server.query(
      "update app.activation_codes set expires_at = now() - interval '1 day' where code = $1",
      [expired],
    );
    await server.query(
      `update app.activation_codes set created_at = now() - (interval '1 minute' * $2)
       where code = $1`,
      [used, 4],
    );

    const codes = await op().rpc<Code[]>('op_list_codes');
    expect(codes.map((c) => c.code).at(-1)).toBe(used);
    const byCode = new Map(codes.map((c) => [c.code, c]));
    expect(byCode.get(used)).toMatchObject({
      note: 'Kurşunlu',
      status: 'used',
      marketId: market.id,
      marketName: 'Kurşunlu Market',
    });
    expect(byCode.get(used)?.usedAt).not.toBeNull();
    expect(byCode.get(revoked)).toMatchObject({ status: 'revoked', marketId: null });
    expect(byCode.get(expired)).toMatchObject({ status: 'expired' });
    expect(byCode.get(fresh)).toMatchObject({ status: 'unused', usedAt: null, revokedAt: null });
    expect(byCode.get(fresh)?.expiresAt).toBeTruthy();
    expect(byCode.get(fresh)?.createdAt).toBeTruthy();
  });

  it('revokes an unused code, which then opens nothing', async () => {
    const code = await op().rpc<string>('op_issue_code', ['Test', 30]);
    await op().rpc('op_revoke_code', [code.toLowerCase().replace('-', '')]);
    const owner = await server.addUser({ anonymous: false });
    expect(await errorOf(server.as(owner).rpc('create_own_market', ['M', code]))).toContain(
      'activation_invalid',
    );
    expect(await errorOf(op().rpc('op_revoke_code', ['ZZZZ-ZZZZ']))).toContain('code_not_found');
  });

  it('leaves a used code as it is', async () => {
    const code = await op().rpc<string>('op_issue_code', ['Test', 30]);
    const owner = await server.addUser({ anonymous: false });
    await server.as(owner).rpc('create_own_market', ['M', code]);
    expect(await errorOf(op().rpc('op_revoke_code', [code]))).toContain('code_used');
    expect(await errorOf(op().rpc('op_extend_code', [code, 30]))).toContain('code_used');
  });

  it('extends a code from its end while it runs, and from now once it has expired', async () => {
    const running = await op().rpc<string>('op_issue_code', ['Test', 10]);
    const expired = await op().rpc<string>('op_issue_code', ['Eski', 10]);
    await server.query(
      "update app.activation_codes set expires_at = now() - interval '5 days' where code = $1",
      [expired],
    );
    await op().rpc('op_extend_code', [running, 20]);
    await op().rpc('op_extend_code', [expired, 20]);
    const rows = await server.query<{ code: string; days: number }>(
      `select code, round(extract(epoch from expires_at - now()) / 86400)::int as days
       from app.activation_codes where code = any($1)`,
      [[running, expired]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.code, row.days]))).toEqual({
      [running]: 30,
      [expired]: 20,
    });
    const owner = await server.addUser({ anonymous: false });
    await expect(server.as(owner).rpc('create_own_market', ['M', expired])).resolves.toBeTruthy();
  });

  it('refuses to extend a revoked or unknown code, or by a strange number of days', async () => {
    const code = await op().rpc<string>('op_issue_code', ['Test', 10]);
    expect(await errorOf(op().rpc('op_extend_code', [code, 0]))).toContain('bad_days');
    expect(await errorOf(op().rpc('op_extend_code', [code, 400]))).toContain('bad_days');
    expect(await errorOf(op().rpc('op_extend_code', ['ZZZZ-ZZZZ', 10]))).toContain(
      'code_not_found',
    );
    await op().rpc('op_revoke_code', [code]);
    expect(await errorOf(op().rpc('op_extend_code', [code, 10]))).toContain('code_revoked');
  });
});

describe('the operator’s markets', () => {
  it('lists every market with its registers, last sync and owner email', async () => {
    await server.addMarket('kursunlu', 'Kurşunlu Market');
    await server.addMarket('bos', 'Boş Market');
    const email = `${crypto.randomUUID()}@example.com`;
    await server.addOwner('kursunlu', email);
    await server.addDevice('kursunlu', 'K1');
    const second = await server.addDevice('kursunlu', 'K2');
    await server.addDevice('kursunlu', 'K3');
    await server.query("update app.devices set revoked_at = now() where code = 'K3'");
    await server.query(
      "update app.devices set last_seen_at = now() - interval '1 hour' where id = $1",
      [second.deviceId],
    );

    const markets = await op().rpc<Market[]>('op_list_markets');
    const byId = new Map(markets.map((m) => [m.id, m]));
    expect(byId.get('kursunlu')).toMatchObject({
      name: 'Kurşunlu Market',
      status: 'active',
      devices: 2,
      ownerEmail: email,
    });
    expect(byId.get('kursunlu')?.lastSyncAt).not.toBeNull();
    expect(byId.get('kursunlu')?.activatedAt).toBeNull();
    expect(byId.get('bos')).toMatchObject({ devices: 0, lastSyncAt: null, ownerEmail: null });
  });

  it('suspends a market, whose registers are then refused, and activates it again', async () => {
    await server.addMarket('kursunlu');
    const { userId } = await server.addDevice('kursunlu', 'K1');
    await op().rpc('op_set_market_status', ['kursunlu', 'suspended']);
    expect(await errorOf(server.as(userId).rpc('sync_pull', [0, 10]))).toContain(
      'market_suspended',
    );
    expect((await op().rpc<Market[]>('op_list_markets'))[0]?.status).toBe('suspended');

    await op().rpc('op_set_market_status', ['kursunlu', 'active']);
    await expect(server.as(userId).rpc('sync_pull', [0, 10])).resolves.toBeTruthy();
  });

  it('accepts only active or suspended, for a market that exists', async () => {
    await server.addMarket('kursunlu');
    expect(await errorOf(op().rpc('op_set_market_status', ['kursunlu', 'deleted']))).toContain(
      'bad_status',
    );
    expect(await errorOf(op().rpc('op_set_market_status', ['yok', 'active']))).toContain(
      'market_not_found',
    );
  });
});
