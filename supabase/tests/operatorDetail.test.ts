// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type Sum = { count: number; total: number };
type Overview = {
  markets: { total: number; active: number; suspended: number; new30: number };
  codes: { issued: number; used: number; unused: number; expired: number; revoked: number };
  devices: { total: number; seenToday: number };
  sales: { today: Sum; last30: Sum };
  expiringCodes: { code: string; note: string; expiresAt: string }[];
  planDue: { id: string; name: string; plan: string | null; planUntil: string }[];
  quiet: { id: string; name: string; lastSyncAt: string | null }[];
};
type Detail = {
  id: string;
  name: string;
  status: string;
  activationCode: string | null;
  code: { note: string } | null;
  people: { email: string; role: string }[];
  devices: { id: string; code: string; revokedAt: string | null; lastSeenAt: string | null }[];
  staff: { active: number; archived: number };
  rowCounts: { table: string; count: number }[];
  bytes: number;
  lastSyncAt: string | null;
  lastSaleAt: string | null;
  sales: { today: Sum; last30: Sum; all: Sum };
  voids30: number;
  returns30: Sum;
  activeDevices30: number;
  info: { plan: string | null; planUntil: string | null; note: string | null } | null;
};
type Log = {
  id: number;
  action: string;
  marketId: string | null;
  marketName: string | null;
  details: Record<string, unknown>;
};

/** Every new or replaced operator function, with arguments it accepts from an operator. */
const OPERATOR_CALLS: [string, unknown[]][] = [
  ['op_overview', []],
  ['op_list_markets', []],
  ['op_market', ['kursunlu']],
  ['op_history', [50, null, null]],
  ['op_list_codes', []],
  ['op_issue_code', ['Test', 30]],
  ['op_issue_codes', ['Test', 30, 2]],
  ['op_revoke_code', ['ABCD-2345']],
  ['op_extend_code', ['ABCD-2345', 30]],
  ['op_set_market_status', ['kursunlu', 'suspended']],
  ['op_revoke_device', ['00000000-0000-4000-8000-000000000000']],
  ['op_set_market_plan', ['kursunlu', 'Yıllık', '2027-01-01']],
  ['op_set_market_note', ['kursunlu', 'Not']],
];

const SIGNATURES = [
  'public.op_overview()',
  'public.op_list_markets()',
  'public.op_market(text)',
  'public.op_history(integer, bigint, text)',
  'public.op_list_codes()',
  'public.op_issue_code(text, integer)',
  'public.op_issue_codes(text, integer, integer)',
  'public.op_revoke_code(text)',
  'public.op_extend_code(text, integer)',
  'public.op_set_market_status(text, text)',
  'public.op_revoke_device(uuid)',
  'public.op_set_market_plan(text, text, date)',
  'public.op_set_market_note(text, text)',
];

const HELPERS = [
  'app.op_log(text, text, jsonb)',
  'app.op_today()',
  'app.op_month_start()',
  'app.op_sales(text, text)',
  'app.op_last_sync(text)',
  'app.op_last_sale(text)',
  'app.op_staff(text)',
];

let server: TestServer;
let operator: string;

beforeEach(async () => {
  server = await createTestServer();
  operator = await server.addUser({ anonymous: false });
  await server.query('insert into app.operators (user_id) values ($1)', [operator]);
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const op = () => server.as(operator);

/** A business day N days back from today in Turkey (UTC+3), as a register writes it. */
const dayAgo = (days: number) =>
  new Date(Date.now() + 3 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10);

let seq = 0;
async function addRow(market: string, tbl: string, id: string, row: Record<string, unknown>) {
  seq += 1;
  await server.query(
    'insert into app.rows (market_id, tbl, id, server_seq, row) values ($1, $2, $3, $4, $5)',
    [market, tbl, id, seq, JSON.stringify({ id, ...row })],
  );
}

/** What the shop's own tables hold, to show a call left them as they were. */
async function shopTables() {
  return {
    markets: await server.query('select * from app.markets order by id'),
    memberships: await server.query('select * from app.memberships order by market_id, user_id'),
    devices: await server.query('select * from app.devices order by id'),
    rows: await server.query('select * from app.rows order by market_id, tbl, id'),
    pairings: await server.query('select * from app.pairings order by code'),
    applied: await server.query('select * from app.applied_ops order by market_id, op_id'),
  };
}

async function log() {
  return op().rpc<Log[]>('op_history', [200, null, null]);
}

describe('who may use the new operator functions', () => {
  it('refuses every one to a signed-in person who is not an operator, changing nothing', async () => {
    await server.addMarket('kursunlu', 'Kurşunlu Market');
    const { deviceId } = await server.addDevice('kursunlu', 'K1');
    const stranger = await server.addUser({ anonymous: false });
    const before = await shopTables();
    const calls: [string, unknown[]][] = [...OPERATOR_CALLS, ['op_revoke_device', [deviceId]]];
    for (const [name, args] of calls) {
      expect(await errorOf(server.as(stranger).rpc(name, args)), name).toContain('not_operator');
    }
    expect(await shopTables()).toEqual(before);
    expect(await server.query('select * from app.operator_log')).toEqual([]);
    expect(await server.query('select * from app.operator_market_info')).toEqual([]);
    expect(await server.query('select * from app.activation_codes')).toEqual([]);
  });

  it('refuses a register’s anonymous session, even one listed as an operator', async () => {
    await server.addMarket('kursunlu');
    const { userId } = await server.addDevice('kursunlu', 'K1');
    await server.query('insert into app.operators (user_id) values ($1)', [userId]);
    for (const [name, args] of OPERATOR_CALLS) {
      expect(await errorOf(server.as(userId).rpc(name, args)), name).toContain('not_operator');
    }
  });

  it('grants execute to authenticated only, as security definer with an empty search path', async () => {
    for (const signature of SIGNATURES) {
      const [row] = await server.query<{
        anon: boolean;
        auth: boolean;
        svc: boolean;
        definer: boolean;
        config: string[] | null;
      }>(
        `select has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
           has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth,
           has_function_privilege('service_role', $1::regprocedure, 'execute') as svc,
           prosecdef as definer, proconfig as config
         from pg_proc where oid = $1::regprocedure`,
        [signature],
      );
      expect(row, signature).toEqual({
        anon: false,
        auth: true,
        svc: false,
        definer: true,
        config: ['search_path=""'],
      });
    }
    for (const [name, args] of OPERATOR_CALLS) {
      expect(await errorOf(server.as(null).rpc(name, args)), name).toMatch(/permission denied/);
    }
  });

  it('keeps the helpers and the new tables out of every client role’s reach', async () => {
    for (const signature of HELPERS) {
      const [row] = await server.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
           has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth,
           has_function_privilege('service_role', $1::regprocedure, 'execute') as svc`,
        [signature],
      );
      expect(row, signature).toEqual({ anon: false, auth: false, svc: false });
    }
    for (const table of ['app.operator_log', 'app.operator_market_info']) {
      expect(await errorOf(op().query(`select * from ${table}`)), table).toMatch(
        /permission denied/,
      );
      const [rls] = await server.query<{ rls: boolean }>(
        'select relrowsecurity as rls from pg_class where oid = $1::regclass',
        [table],
      );
      expect(rls?.rls, table).toBe(true);
      const [grants] = await server.query<{ n: number }>(
        `select count(*)::int as n from information_schema.role_table_grants
         where table_schema || '.' || table_name = $1
           and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`,
        [table],
      );
      expect(grants?.n, table).toBe(0);
    }
  });

  it('runs again over itself without failing (the SQL editor may run it twice)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20261121090000_m6_operator_panel_detail.sql'),
      'utf8',
    );
    await server.exec(sql);
    expect(await op().rpc('op_overview')).toBeTruthy();
  });
});

describe('the operator’s figures', () => {
  beforeEach(async () => {
    await server.addMarket('kursunlu', 'Kurşunlu Market');
    await server.addMarket('bos', 'Boş Market');
    await server.addMarket('kapali', 'Kapalı Market');
    await server.query("update app.markets set status = 'suspended' where id = 'kapali'");
    // Sales: two today, one 10 days ago, one 40 days ago, and one of today's voided.
    await addRow('kursunlu', 'sales', 's1', {
      total: 1000,
      businessDate: dayAgo(0),
      occurredAt: '2026-11-20T08:00:00Z',
    });
    await addRow('kursunlu', 'sales', 's2', {
      total: 2550,
      businessDate: dayAgo(0),
      occurredAt: '2026-11-20T09:00:00Z',
    });
    await addRow('kursunlu', 'sales', 's3', {
      total: 400,
      businessDate: dayAgo(10),
      occurredAt: '2026-11-10T09:00:00Z',
    });
    await addRow('kursunlu', 'sales', 's4', {
      total: 9999,
      businessDate: dayAgo(40),
      occurredAt: '2026-10-11T09:00:00Z',
    });
    await addRow('kursunlu', 'sales', 's5', {
      total: 700,
      businessDate: dayAgo(0),
      occurredAt: '2026-11-20T10:00:00Z',
    });
    await addRow('kursunlu', 'saleVoids', 'v1', { saleId: 's5', businessDate: dayAgo(0) });
    // A malformed total counts as nothing rather than failing the read.
    await addRow('bos', 'sales', 'b1', { total: 'x', businessDate: dayAgo(1) });
    await addRow('kursunlu', 'returns', 'r1', { amount: 300, businessDate: dayAgo(2) });
    await addRow('kursunlu', 'staff', 'p1', { name: 'Emin', role: 'owner' });
    await addRow('kursunlu', 'staff', 'p2', { name: 'Ali', role: 'cashier' });
    await addRow('kursunlu', 'staff', 'p3', {
      name: 'Eski',
      role: 'cashier',
      archivedAt: '2026-11-01T00:00:00Z',
    });
    await addRow('kursunlu', 'products', 'u1', { name: 'Ekmek' });
  });

  it('adds up sales, voids, returns, staff and records for one market', async () => {
    const owner = `${crypto.randomUUID()}@example.com`;
    const manager = `${crypto.randomUUID()}@example.com`;
    await server.addOwner('kursunlu', owner);
    const managerId = await server.addUser({ email: manager });
    await server.query(
      "insert into app.memberships (market_id, user_id, role) values ('kursunlu', $1, 'manager')",
      [managerId],
    );
    const live = await server.addDevice('kursunlu', 'K1');
    await server.addDevice('kursunlu', 'K2');
    await server.query("update app.devices set revoked_at = now() where code = 'K2'");
    await server.query('update app.devices set last_seen_at = now() where id = $1', [
      live.deviceId,
    ]);

    const detail = await op().rpc<Detail>('op_market', ['kursunlu']);
    expect(detail).toMatchObject({
      id: 'kursunlu',
      name: 'Kurşunlu Market',
      status: 'active',
      sales: {
        today: { count: 2, total: 3550 },
        last30: { count: 3, total: 3950 },
        all: { count: 4, total: 13949 },
      },
      voids30: 1,
      returns30: { count: 1, total: 300 },
      staff: { active: 2, archived: 1 },
      activeDevices30: 1,
      info: null,
      lastSaleAt: '2026-11-20T10:00:00Z',
    });
    expect(detail.people).toEqual([
      { email: owner, role: 'owner' },
      { email: manager, role: 'manager' },
    ]);
    expect(detail.devices.map((d) => [d.code, d.revokedAt === null])).toEqual([
      ['K1', true],
      ['K2', false],
    ]);
    expect(detail.rowCounts).toEqual([
      { table: 'products', count: 1 },
      { table: 'returns', count: 1 },
      { table: 'saleVoids', count: 1 },
      { table: 'sales', count: 5 },
      { table: 'staff', count: 3 },
    ]);
    expect(detail.bytes).toBeGreaterThan(0);
    expect(detail.lastSyncAt).not.toBeNull();
    expect(await errorOf(op().rpc('op_market', ['yok']))).toContain('market_not_found');
  });

  it('names the activation code that opened a market', async () => {
    const code = await op().rpc<string>('op_issue_code', ['Yıldız Bakkal', 30]);
    const owner = await server.addUser({ anonymous: false });
    const market = await server
      .as(owner)
      .rpc<{ id: string }>('create_own_market', ['Yıldız Bakkal', code]);
    const detail = await op().rpc<Detail>('op_market', [market.id]);
    expect(detail.activationCode).toBe(code);
    expect(detail.code?.note).toBe('Yıldız Bakkal');
    expect(detail.sales.all).toEqual({ count: 0, total: 0 });
    const codes = await op().rpc<{ code: string; usedByEmail: string | null }[]>('op_list_codes');
    expect(codes.find((c) => c.code === code)).toHaveProperty('usedByEmail');
  });

  it('lists markets with their staff, 30-day sales, newest sale and plan record', async () => {
    await op().rpc('op_set_market_plan', ['kursunlu', 'Yıllık', '2027-01-15']);
    const markets = await op().rpc<Record<string, unknown>[]>('op_list_markets');
    const byId = new Map(markets.map((m) => [m.id, m]));
    expect(byId.get('kursunlu')).toMatchObject({
      staff: 2,
      sales30: { count: 3, total: 3950 },
      lastSaleAt: '2026-11-20T10:00:00Z',
      plan: 'Yıllık',
      planUntil: '2027-01-15',
    });
    expect(byId.get('bos')).toMatchObject({
      staff: 0,
      sales30: { count: 1, total: 0 },
      plan: null,
      planUntil: null,
    });
  });

  it('gives the overview’s totals across markets', async () => {
    await server.addDevice('kursunlu', 'K1');
    const quiet = await server.addDevice('bos', 'K1');
    await server.query(
      "update app.devices set last_seen_at = now() - interval '10 days' where id = $1",
      [quiet.deviceId],
    );
    await server.query(
      "update app.rows set received_at = now() - interval '10 days' where market_id = 'bos'",
    );
    const soon = await op().rpc<string>('op_issue_code', ['Yakında', 3]);
    await op().rpc('op_issue_code', ['Uzak', 30]);
    const gone = await op().rpc<string>('op_issue_code', ['Eski', 30]);
    await server.query(
      "update app.activation_codes set expires_at = now() - interval '1 day' where code = $1",
      [gone],
    );
    const revoked = await op().rpc<string>('op_issue_code', ['İptal', 30]);
    await op().rpc('op_revoke_code', [revoked]);
    await op().rpc('op_set_market_plan', ['kursunlu', 'Aylık', dayAgo(-3)]);
    await op().rpc('op_set_market_plan', ['bos', 'Yıllık', dayAgo(-200)]);

    const overview = await op().rpc<Overview>('op_overview');
    expect(overview.markets).toEqual({ total: 3, active: 2, suspended: 1, new30: 3 });
    expect(overview.codes).toEqual({ issued: 4, used: 0, unused: 2, expired: 1, revoked: 1 });
    expect(overview.devices).toEqual({ total: 2, seenToday: 0 });
    expect(overview.sales).toEqual({
      today: { count: 2, total: 3550 },
      last30: { count: 4, total: 3950 },
    });
    expect(overview.expiringCodes.map((c) => c.code)).toEqual([soon]);
    expect(overview.planDue).toEqual([
      { id: 'kursunlu', name: 'Kurşunlu Market', plan: 'Aylık', planUntil: dayAgo(-3) },
    ]);
    // kursunlu has a register never seen and records just taken, so only bos is quiet.
    expect(overview.quiet.map((q) => q.id)).toEqual(['bos']);
  });
});

describe('the operator’s changes', () => {
  beforeEach(async () => {
    await server.addMarket('kursunlu', 'Kurşunlu Market');
  });

  it('revokes one register, which is then refused, and logs it', async () => {
    const k1 = await server.addDevice('kursunlu', 'K1');
    const k2 = await server.addDevice('kursunlu', 'K2');
    await op().rpc('op_revoke_device', [k1.deviceId]);

    expect(await errorOf(server.as(k1.userId).rpc('sync_pull', [0, 10]))).toContain(
      'device_revoked',
    );
    await expect(server.as(k2.userId).rpc('sync_pull', [0, 10])).resolves.toBeTruthy();
    const [entry] = await log();
    expect(entry).toMatchObject({
      action: 'device.revoke',
      marketId: 'kursunlu',
      marketName: 'Kurşunlu Market',
      details: { deviceId: k1.deviceId, code: 'K1', name: 'Kasa K1' },
    });
    expect(await errorOf(op().rpc('op_revoke_device', [k1.deviceId]))).toContain('device_revoked');
    expect(await errorOf(op().rpc('op_revoke_device', [crypto.randomUUID()]))).toContain(
      'device_not_found',
    );
  });

  it('changes nothing but the one register', async () => {
    const k1 = await server.addDevice('kursunlu', 'K1');
    await addRow('kursunlu', 'sales', 's1', { total: 100, businessDate: dayAgo(0) });
    const before = await shopTables();
    await op().rpc('op_revoke_device', [k1.deviceId]);
    const after = await shopTables();
    expect({ ...after, devices: [] }).toEqual({ ...before, devices: [] });
    expect(after.devices).toEqual([
      { ...(before.devices[0] as object), revoked_at: expect.any(Date) as unknown },
    ]);
  });

  it('logs every write the panel makes, newest first, and filters by market', async () => {
    const code = await op().rpc<string>('op_issue_code', ['Yıldız', 30]);
    const many = await op().rpc<string[]>('op_issue_codes', ['Toplu', 10, 3]);
    await op().rpc('op_extend_code', [code, 5]);
    await op().rpc('op_revoke_code', [many[0]]);
    await op().rpc('op_set_market_status', ['kursunlu', 'suspended']);
    await op().rpc('op_set_market_status', ['kursunlu', 'active']);
    await op().rpc('op_set_market_plan', ['kursunlu', ' Yıllık ', '2027-01-15']);
    await op().rpc('op_set_market_note', ['kursunlu', 'Emin abi, öğlen arar.']);

    const entries = await log();
    expect(entries.map((e) => e.action)).toEqual([
      'market.note',
      'market.plan',
      'market.status',
      'market.status',
      'code.revoke',
      'code.extend',
      'code.issue',
      'code.issue',
    ]);
    expect(entries[7]?.details).toMatchObject({
      count: 1,
      days: 30,
      note: 'Yıldız',
      codes: [code],
    });
    expect(entries[6]?.details).toMatchObject({ count: 3, days: 10, codes: many });
    expect(entries[2]?.details).toEqual({ from: 'suspended', to: 'active' });
    expect(entries[1]?.details).toEqual({
      from: { plan: null, until: null },
      to: { plan: 'Yıllık', until: '2027-01-15' },
    });
    expect(entries[0]?.details).toEqual({ length: 21 });

    const own = await op().rpc<Log[]>('op_history', [50, null, 'kursunlu']);
    expect(own).toHaveLength(4);
    const older = await op().rpc<Log[]>('op_history', [2, entries[1]?.id, null]);
    expect(older.map((e) => e.id)).toEqual([entries[2]?.id, entries[3]?.id]);
  });

  it('issues 1–50 codes at once with the generator’s rules', async () => {
    const codes = await op().rpc<string[]>('op_issue_codes', ['Toplu', 10, 5]);
    expect(codes).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    }
    expect(await errorOf(op().rpc('op_issue_codes', ['Toplu', 10, 0]))).toContain('bad_count');
    expect(await errorOf(op().rpc('op_issue_codes', ['Toplu', 10, 51]))).toContain('bad_count');
    expect(await errorOf(op().rpc('op_issue_codes', [' ', 10, 2]))).toContain('bad_note');
    expect(await errorOf(op().rpc('op_issue_codes', ['Toplu', 0, 2]))).toContain('bad_days');
    // A refused batch leaves no code behind.
    const [row] = await server.query<{ n: number }>(
      'select count(*)::int as n from app.activation_codes',
    );
    expect(row?.n).toBe(5);
  });

  it('keeps a plan record and a note, for the operator only, and leaves the market as it is', async () => {
    const { userId } = await server.addDevice('kursunlu', 'K1');
    const before = await shopTables();
    await op().rpc('op_set_market_plan', ['kursunlu', 'Deneme', dayAgo(30)]);
    await op().rpc('op_set_market_note', ['kursunlu', 'Not']);
    expect((await op().rpc<Detail>('op_market', ['kursunlu'])).info).toMatchObject({
      plan: 'Deneme',
      planUntil: dayAgo(30),
      note: 'Not',
    });
    // A date long past restricts nothing: the register keeps syncing.
    await op().rpc('op_set_market_plan', ['kursunlu', 'Deneme', dayAgo(300)]);
    await expect(server.as(userId).rpc('sync_pull', [0, 10])).resolves.toBeTruthy();
    // Nothing the shop reads changed; only last_seen_at moves with the pull.
    const after = await shopTables();
    expect({ ...after, devices: [] }).toEqual({ ...before, devices: [] });

    await op().rpc('op_set_market_plan', ['kursunlu', '', null]);
    await op().rpc('op_set_market_note', ['kursunlu', '  ']);
    expect((await op().rpc<Detail>('op_market', ['kursunlu'])).info).toBeNull();
    expect(await server.query('select * from app.operator_market_info')).toEqual([]);

    expect(
      await errorOf(op().rpc('op_set_market_plan', ['kursunlu', 'x'.repeat(41), null])),
    ).toContain('bad_plan');
    expect(
      await errorOf(op().rpc('op_set_market_plan', ['kursunlu', 'A', '1990-01-01'])),
    ).toContain('bad_date');
    expect(await errorOf(op().rpc('op_set_market_plan', ['yok', 'A', null]))).toContain(
      'market_not_found',
    );
    expect(await errorOf(op().rpc('op_set_market_note', ['kursunlu', 'x'.repeat(2001)]))).toContain(
      'note_too_long',
    );
    expect(await errorOf(op().rpc('op_set_market_note', ['yok', 'A']))).toContain(
      'market_not_found',
    );
  });

  it('reads nothing into the shop’s tables', async () => {
    await server.addDevice('kursunlu', 'K1');
    await addRow('kursunlu', 'sales', 's1', { total: 100, businessDate: dayAgo(0) });
    const before = await shopTables();
    await op().rpc('op_overview');
    await op().rpc('op_list_markets');
    await op().rpc('op_market', ['kursunlu']);
    await op().rpc('op_history', [50, null, null]);
    await op().rpc('op_list_codes');
    expect(await shopTables()).toEqual(before);
  });

  it('still refuses a bad status or an unknown market, logging nothing', async () => {
    expect(await errorOf(op().rpc('op_set_market_status', ['kursunlu', 'deleted']))).toContain(
      'bad_status',
    );
    expect(await errorOf(op().rpc('op_set_market_status', ['yok', 'active']))).toContain(
      'market_not_found',
    );
    expect(await log()).toEqual([]);
  });
});
