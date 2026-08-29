import { createPoolFromEnv } from "../src/env-pool";

const { pool, dispose } = await createPoolFromEnv();
const t = await pool.query(
  "select tablename from pg_tables where schemaname='public' order by 1",
);
console.log(
  "public:",
  t.rows.map((r) => r.tablename),
);
const j = await pool
  .query('select hash, created_at from "drizzle"."__drizzle_migrations"')
  .catch(() => ({ rows: ["no drizzle schema"] }));
console.log("journal:", j.rows);
await dispose();
