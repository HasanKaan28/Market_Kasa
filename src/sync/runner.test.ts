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

  it('never rejects, even when the database is closed', async () => {
    const runner = createSyncRunner({ db, transport: server, isOnline: () => false, now });
    db.close();
    await expect(runner.run()).resolves.toMatchObject({ state: 'error' });
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

  it('keeps syncing when a listener throws', async () => {
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    const seen: string[] = [];
    runner.subscribe(() => {
      throw new Error('broken screen');
    });
    runner.subscribe((status) => seen.push(status.state));
    expect(await runner.run()).toMatchObject({ state: 'online' });
    expect(seen).toContain('online');
  });

  it('gives up on a request that never answers', async () => {
    const silent = {
      push: () => new Promise<never>(() => {}),
      pull: () => new Promise<never>(() => {}),
    };
    const runner = createSyncRunner({
      db,
      transport: silent,
      isOnline: () => true,
      now,
      requestTimeoutMs: 50,
    });
    expect(await runner.run()).toMatchObject({ state: 'error', pendingCount: 1 });
    // The stuck round no longer holds the runner: the next one starts and answers.
    expect(await runner.run()).toMatchObject({ state: 'error' });
  });

  it('shows the real queue before the first round', async () => {
    const offline = createSyncRunner({ db, transport: server, isOnline: () => false, now });
    await vi.waitFor(() => expect(offline.status()).toEqual({ state: 'offline', pendingCount: 1 }));
    const online = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    await vi.waitFor(() => expect(online.status()).toEqual({ state: 'pending', pendingCount: 1 }));
  });
});
