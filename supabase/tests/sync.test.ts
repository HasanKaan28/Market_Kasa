// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type PushResult = { acknowledged: number[]; rejected?: { seq: number; reason: string }[] };
type PullResult = {
  rows: { table: string; id: string; serverSeq: number; row: Record<string, unknown> }[];
  latest: number;
};

let seq = 0;
const insert = (table: string, recordId: string, record: object) => ({
  kind: 'insert',
  table,
  recordId,
  record,
  seq: ++seq,
  opId: crypto.randomUUID(),
  createdAt: '2026-10-30T07:05:00.000Z',
});
const patch = (table: string, recordId: string, fields: object) => ({
  kind: 'patch',
  table,
  recordId,
  patch: fields,
  seq: ++seq,
  opId: crypto.randomUUID(),
  createdAt: '2026-10-30T07:06:00.000Z',
});

const sale = (id: string, total = 4250) => ({
  id,
  receiptNo: 'K1-20261030-0001',
  occurredAt: '2026-10-30T07:05:00.000Z',
  businessDate: '2026-10-30',
  lines: [{ productId: 'p1', name: 'Süt', qtyMilli: 1500, unitPrice: 2833, total }],
  payments: [{ method: 'cash', amount: total }],
  total,
});

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

describe('sync functions', () => {
  it("keeps one market's rows from another market's device", async () => {
    const a = await server.addDevice('a', 'K1');
    const b = await server.addDevice('b', 'K1');
    await server.as(a.userId).rpc('sync_push', [[insert('sales', 's1', sale('s1'))]]);

    const pulled = await server.as(b.userId).rpc<PullResult>('sync_pull', [0, 100]);
    expect(pulled.rows).toEqual([]);

    await server.as(b.userId).rpc('sync_push', [[insert('sales', 's1', sale('s1', 1))]]);
    const mine = await server.as(a.userId).rpc<PullResult>('sync_pull', [0, 100]);
    expect(mine.rows.map((row) => row.row.total)).toEqual([4250]);
  });

  it('stops a revoked device', async () => {
    const a = await server.addDevice('a', 'K1');
    await server.query('update app.devices set revoked_at = now() where id = $1', [a.deviceId]);

    expect(await errorOf(server.as(a.userId).rpc('sync_push', [[]]))).toContain('device_revoked');
    expect(await errorOf(server.as(a.userId).rpc('sync_pull', [0, 10]))).toContain(
      'device_revoked',
    );
  });

  it('refuses a session that is not a device', async () => {
    const stranger = await server.addUser({ anonymous: true });
    const owner = await server.addOwner('a');

    expect(await errorOf(server.as(stranger).rpc('sync_pull', [0, 10]))).toContain(
      'device_not_registered',
    );
    expect(await errorOf(server.as(owner).rpc('sync_push', [[]]))).toContain(
      'device_not_registered',
    );
  });

  it('gives the client no way around the functions', async () => {
    const a = await server.addDevice('a', 'K1');

    expect(await errorOf(server.as(a.userId).query('select * from app.rows'))).toContain(
      'permission denied',
    );
    expect(await errorOf(server.as(null).query('select public.sync_pull(0, 10)'))).toContain(
      'permission denied',
    );
    expect(await errorOf(server.as(null).query("select public.sync_push('[]'::jsonb)"))).toContain(
      'permission denied',
    );
  });

  it('never changes an event', async () => {
    const a = await server.addDevice('a', 'K1');
    const session = server.as(a.userId);
    await session.rpc('sync_push', [[insert('sales', 's1', sale('s1'))]]);

    const edit = patch('sales', 's1', { total: 1 });
    const refused = await session.rpc<PushResult>('sync_push', [[edit]]);
    expect(refused.rejected).toEqual([{ seq: edit.seq, reason: 'not_patchable' }]);

    const again = insert('sales', 's1', sale('s1', 1));
    const accepted = await session.rpc<PushResult>('sync_push', [[again]]);
    expect(accepted.acknowledged).toEqual([again.seq]);

    const pulled = await session.rpc<PullResult>('sync_pull', [0, 100]);
    expect(pulled.rows.map((row) => row.row.total)).toEqual([4250]);
  });

  it('keeps every field as the device sent it', async () => {
    const a = await server.addDevice('a', 'K1');
    const session = server.as(a.userId);
    await session.rpc('sync_push', [[insert('sales', 's1', sale('s1'))]]);

    const [row] = (await session.rpc<PullResult>('sync_pull', [0, 100])).rows;
    expect(row?.row).toEqual(sale('s1'));
    expect(row?.row.occurredAt).toBe('2026-10-30T07:05:00.000Z');
  });

  it('pages a large pull', async () => {
    const a = await server.addDevice('a', 'K1');
    const session = server.as(a.userId);
    const products = Array.from({ length: 2500 }, (_, index) =>
      insert('products', `p${String(index).padStart(5, '0')}`, { name: `Ürün ${index}` }),
    );
    for (let start = 0; start < products.length; start += 500) {
      await session.rpc('sync_push', [products.slice(start, start + 500)]);
    }

    const seen: string[] = [];
    let since = 0;
    const sizes: number[] = [];
    for (;;) {
      const page = await session.rpc<PullResult>('sync_pull', [since, 1000]);
      sizes.push(page.rows.length);
      seen.push(...page.rows.map((row) => row.id));
      const seqs = page.rows.map((row) => row.serverSeq);
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
      if (page.rows.length < 1000) {
        break;
      }
      since = page.latest;
    }
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(new Set(seen).size).toBe(2500);

    expect((await session.rpc<PullResult>('sync_pull', [0, 5000])).rows).toHaveLength(1000);
    const fromBelowZero = await session.rpc<PullResult>('sync_pull', [-3, 10]);
    const fromZero = await session.rpc<PullResult>('sync_pull', [0, 10]);
    expect(fromBelowZero).toEqual(fromZero);
  });
});
