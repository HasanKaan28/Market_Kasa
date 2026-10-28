import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { makeTestDb } from '@/test/db';
import { FakeServer } from './fakeServer';
import { createSyncRunner } from './runner';

let db: MarketDb;
let server: FakeServer;
const now = () => new Date('2026-10-29T09:30:00Z');
beforeEach(async () => {
  db = makeTestDb();
  server = new FakeServer();
  await createProduct(
    db,
    { name: 'Süt', sellPrice: 4250, vatRate: 1 },
    new Date('2026-10-29T09:00:00Z'),
  );
});
afterEach(async () => {
  vi.useRealTimers();
  await db.delete();
});

describe('createSyncRunner', () => {
  it('reports offline without calling the server', async () => {
    const push = vi.spyOn(server, 'push');
    const runner = createSyncRunner({ db, transport: server, isOnline: () => false, now });
    expect(await runner.run()).toEqual({ state: 'offline', pendingCount: 1 });
    expect(push).not.toHaveBeenCalled();
  });

  it('reports online after a clean sync', async () => {
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    expect(await runner.run()).toEqual({
      state: 'online',
      pendingCount: 0,
      lastSyncedAt: '2026-10-29T09:30:00.000Z',
    });
  });

  it('reports an error and keeps the pending count', async () => {
    server.failNextPush();
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    expect(await runner.run()).toEqual({ state: 'error', pendingCount: 1, error: 'network down' });
  });

  it('runs one sync at a time', async () => {
    const push = vi.spyOn(server, 'push');
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    await Promise.all([runner.run(), runner.run()]);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers and syncs on an interval once started', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    const seen: string[] = [];
    runner.subscribe((status) => seen.push(status.state));
    runner.start(1000);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(seen).toContain('online'));
    runner.stop();
  });
});
