import { openMarketDb, type MarketDb } from '@/data/db';

/** A uniquely named database, so tests never share state. Delete it in afterEach. */
export function makeTestDb(): MarketDb {
  return openMarketDb(`test-${crypto.randomUUID()}`);
}
