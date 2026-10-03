import pg from "pg";

export type Db = Pick<pg.Pool, "query">;

let pool: pg.Pool | undefined;

/** One pool per server process. */
export function db(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://udd:udd@localhost:55432/udd",
    max: 5,
    connectionTimeoutMillis: 3000,
  });
  return pool;
}
