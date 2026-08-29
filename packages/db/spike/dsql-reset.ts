import { createPoolFromEnv } from "../src/env-pool";

const { pool, dispose } = await createPoolFromEnv();
for (const stmt of [
  "DROP TABLE IF EXISTS user_entries CASCADE",
  "DROP TABLE IF EXISTS subscriptions CASCADE",
  "DROP TABLE IF EXISTS feeds CASCADE",
  "DROP TABLE IF EXISTS categories CASCADE",
  "DROP TABLE IF EXISTS api_tokens CASCADE",
  "DROP TABLE IF EXISTS user_settings CASCADE",
  "DROP TABLE IF EXISTS users CASCADE",
  "DROP TABLE IF EXISTS _p1 CASCADE",
  "DROP TABLE IF EXISTS _p2 CASCADE",
  "DROP TABLE IF EXISTS _p3 CASCADE",
  'DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations"',
]) {
  await pool.query(stmt);
  const remaining = await pool.query(
    "select tablename from pg_tables where schemaname='public'",
  );
  console.log(
    `after [${stmt.slice(16, 40)}]: ${remaining.rows.length} tables left`,
  );
}
await dispose();
