import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '@/data/types';
import { FakeServer } from './fakeServer';

const at = '2026-10-29T09:00:00.000Z';
const insert = (
  seq: number,
  table: OutboxItem['table'],
  record: { id: string } & Record<string, unknown>,
): OutboxItem =>
  ({
    seq,
    opId: `op-${table}-${record.id}`,
    createdAt: at,
    kind: 'insert',
    table,
    recordId: record.id,
    record,
  }) as OutboxItem;
const patch = (
  seq: number,
  id: string,
  fields: Record<string, unknown>,
  opId = `op-${seq}`,
): OutboxItem =>
  ({
    seq,
    opId,
    createdAt: at,
    kind: 'patch',
    table: 'products',
    recordId: id,
    patch: fields,
  }) as OutboxItem;

describe('FakeServer', () => {
  it('applies an insert once however often it is pushed', async () => {
    const server = new FakeServer();
    const op = insert(1, 'sales', { id: 's1', total: 100 });
    expect(await server.push({ ops: [op] })).toEqual({ acknowledged: [1] });
    expect(await server.push({ ops: [{ ...op, seq: 7 }] })).toEqual({ acknowledged: [7] });
    expect(server.rows('sales')).toEqual([{ id: 's1', total: 100 }]);
  });

  it('merges patches and clears null fields', async () => {
    const server = new FakeServer();
    await server.push({
      ops: [insert(1, 'products', { id: 'p1', name: 'Süt', barcode: 'B1', sellPrice: 4250 })],
    });
    await server.push({ ops: [patch(2, 'p1', { sellPrice: 4500, barcode: null })] });
    expect(server.rows('products')).toEqual([{ id: 'p1', name: 'Süt', sellPrice: 4500 }]);
  });

  it('ignores a retried patch so a newer edit survives', async () => {
    const server = new FakeServer();
    await server.push({ ops: [insert(1, 'products', { id: 'p1', name: 'Süt', sellPrice: 4250 })] });
    const first = patch(2, 'p1', { sellPrice: 4500 }, 'op-a');
    await server.push({ ops: [first] });
    await server.push({ ops: [patch(1, 'p1', { sellPrice: 5000 }, 'op-b')] });
    expect(await server.push({ ops: [first] })).toEqual({ acknowledged: [2] });
    expect(server.rows('products')).toEqual([{ id: 'p1', name: 'Süt', sellPrice: 5000 }]);
  });

  it('refuses the ops its rule names and sends the record again', async () => {
    const server = new FakeServer();
    await server.push({ ops: [insert(1, 'products', { id: 'p1', name: 'Süt', sellPrice: 4250 })] });
    server.refuse((op) => (op.kind === 'patch' ? 'Fiyat değiştirme yetkisi yok' : undefined));
    expect(await server.push({ ops: [patch(2, 'p1', { sellPrice: 1 })] })).toEqual({
      acknowledged: [],
      rejected: [{ seq: 2, reason: 'Fiyat değiştirme yetkisi yok' }],
    });
    expect(server.rows('products')).toEqual([{ id: 'p1', name: 'Süt', sellPrice: 4250 }]);
    expect((await server.pull({ since: 1, limit: 10 })).rows.map((r) => r.id)).toEqual(['p1']);
  });

  it('pages changes in server order', async () => {
    const server = new FakeServer();
    await server.push({
      ops: [
        insert(1, 'sales', { id: 'a' }),
        insert(2, 'sales', { id: 'b' }),
        insert(3, 'sales', { id: 'c' }),
      ],
    });
    const first = await server.pull({ since: 0, limit: 2 });
    expect(first.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(first.latest).toBe(2);
    const second = await server.pull({ since: first.latest, limit: 2 });
    expect(second.rows.map((r) => r.id)).toEqual(['c']);
    expect(await server.pull({ since: 3, limit: 2 })).toEqual({ rows: [], latest: 3 });
  });

  it('lets the earliest product keep a contested barcode', async () => {
    const server = new FakeServer();
    await server.push({ ops: [insert(1, 'products', { id: 'p-2', name: 'Geç', barcode: 'X' })] });
    await server.push({ ops: [insert(1, 'products', { id: 'p-1', name: 'Erken', barcode: 'X' })] });
    expect(server.rows('products')).toEqual([
      { id: 'p-1', name: 'Erken', barcode: 'X' },
      { id: 'p-2', name: 'Geç' },
    ]);
    const changes = await server.pull({ since: 0, limit: 10 });
    expect(changes.rows.at(-1)).toMatchObject({ id: 'p-2', row: { id: 'p-2', name: 'Geç' } });
  });

  it('can fail a push on purpose', async () => {
    const server = new FakeServer();
    server.failNextPush();
    await expect(server.push({ ops: [insert(1, 'sales', { id: 's1' })] })).rejects.toThrow(
      'network down',
    );
    expect(await server.push({ ops: [insert(1, 'sales', { id: 's1' })] })).toEqual({
      acknowledged: [1],
    });
  });
});
