import { createTestServer } from '../../supabase/tests/harness';
import { sqlTransport, type AckSwitch } from '../../supabase/tests/sqlTransport';
import { FakeServer } from '@/sync/fakeServer';
import type { SyncTable, SyncTransport } from '@/sync/protocol';

/** One server for a test: registers connect to it, and the test reads what it holds. */
export type TestBackend = {
  /** A new register's connection. */
  device(): Promise<SyncTransport>;
  /** The server's current rows of a table, ordered by id. */
  rows(table: SyncTable): Promise<Record<string, unknown>[]>;
  /** The next push is applied, then its answer is lost. */
  loseNextAck(): void;
};

const MARKET = 'test';

/** The in-memory fake and the real SQL on PGlite: a contract test runs against both. */
export const SERVERS: { name: string; make(): Promise<TestBackend> }[] = [
  {
    name: 'fake',
    async make() {
      const server = new FakeServer();
      return {
        device: async () => server,
        rows: async (table) => server.rows(table),
        loseNextAck: () => server.loseNextAck(),
      };
    },
  },
  {
    name: 'sql',
    async make() {
      const server = await createTestServer();
      await server.addMarket(MARKET);
      const ack: AckSwitch = { lost: false };
      let registers = 0;
      return {
        async device() {
          registers += 1;
          const { userId } = await server.addDevice(MARKET, `K${registers}`);
          return sqlTransport(server, userId, ack);
        },
        async rows(table) {
          const rows = await server.query<{ row: Record<string, unknown> }>(
            `select row from app.rows where market_id = $1 and tbl = $2 order by id collate "C"`,
            [MARKET, table],
          );
          return rows.map(({ row }) => row);
        },
        loseNextAck() {
          ack.lost = true;
        },
      };
    },
  },
];
