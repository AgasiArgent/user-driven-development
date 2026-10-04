import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://udd:udd@localhost:55432/udd";
const TEST_DB = "udd_delivery_test";

/** A separate database for delivery tests, so they never touch the demo's data. */
export async function freshTestDb(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  const migrate = fileURLToPath(new URL("../../demo/scripts/migrate.mjs", import.meta.url));
  execFileSync("node", [migrate], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "ignore" });
  return new pg.Pool({ connectionString: url.toString(), max: 4 });
}
