import { readdirSync, readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/**
 * What Supabase gives every project before our migrations run: the client roles, the `auth`
 * schema with `auth.uid()` and `auth.jwt()` read from the request's claims, and execute on new
 * `public` functions granted to the client roles by default.
 */
const SUPABASE_BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text unique,
    is_anonymous boolean not null default false
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;
`;

/** Queries made as one caller: `anon` when there is no user, else that user's session. */
export type Session = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Calls `public.<name>(...)` and returns its result. */
  rpc<T = unknown>(name: string, args?: unknown[]): Promise<T>;
};

export type TestServer = {
  /** Queries as `postgres`, as the operator in the SQL editor would. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  as(userId: string | null): Session;
  addMarket(id: string, name?: string): Promise<void>;
  addUser(options?: { email?: string; anonymous?: boolean }): Promise<string>;
  addDevice(marketId: string, code: string): Promise<{ userId: string; deviceId: string }>;
  addOwner(marketId: string, email?: string): Promise<string>;
};

export async function createTestServer(): Promise<TestServer> {
  const db = new PGlite();
  await db.exec(SUPABASE_BASE);
  for (const name of readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
  }

  const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await db.query<T>(sql, params)).rows;

  const claimsOf = async (userId: string): Promise<string> => {
    const [user] = await query<{ is_anonymous: boolean }>(
      'select is_anonymous from auth.users where id = $1',
      [userId],
    );
    return JSON.stringify({
      sub: userId,
      role: 'authenticated',
      is_anonymous: !!user?.is_anonymous,
    });
  };

  const as = (userId: string | null): Session => {
    // The claims are read before the transaction: PGlite runs one statement at a time, so a query
    // outside the transaction would wait for it forever.
    const run = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      const claims = userId === null ? null : await claimsOf(userId);
      return db.transaction(async (tx: Transaction) => {
        if (claims === null) {
          await tx.query('set local role anon');
        } else {
          await tx.query('set local role authenticated');
          await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
        }
        return (await tx.query<T>(sql, params)).rows;
      });
    };
    return {
      query: run,
      async rpc<T>(name: string, args: unknown[] = []) {
        const list = args.map((_, index) => `$${index + 1}`).join(', ');
        const params = args.map((arg) =>
          typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : arg,
        );
        const [row] = await run<{ result: T }>(`select public.${name}(${list}) as result`, params);
        return row?.result as T;
      },
    };
  };

  const addUser = async (
    { email, anonymous = !email } = {} as { email?: string; anonymous?: boolean },
  ) => {
    const id = crypto.randomUUID();
    await query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [
      id,
      email ?? null,
      anonymous,
    ]);
    return id;
  };

  return {
    query,
    as,
    addUser,
    async addMarket(id, name = id) {
      await query('insert into app.markets (id, name) values ($1, $2)', [id, name]);
    },
    async addDevice(marketId, code) {
      const userId = await addUser({ anonymous: true });
      const deviceId = crypto.randomUUID();
      await query(
        `insert into app.devices (id, market_id, auth_user_id, code, name, platform)
         values ($1, $2, $3, $4, $5, 'web')`,
        [deviceId, marketId, userId, code, `Kasa ${code}`],
      );
      return { userId, deviceId };
    },
    async addOwner(marketId, email = `${crypto.randomUUID()}@example.com`) {
      const userId = await addUser({ email });
      await query(
        "insert into app.memberships (market_id, user_id, role) values ($1, $2, 'owner')",
        [marketId, userId],
      );
      return userId;
    },
  };
}
