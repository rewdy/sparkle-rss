import { ensureMigrationJournal } from "../src/dsql-journal";
import { migrateDsql } from "../src/dsql-migrator";

const endpoint = process.env.DSQL_ENDPOINT;
if (!endpoint) throw new Error("DSQL_ENDPOINT required");

const { createPoolFromEnv } = await import("../src/env-pool");
const { pool, dispose } = await createPoolFromEnv();

try {
  await ensureMigrationJournal(pool);
  await migrateDsql(pool, new URL("../drizzle", import.meta.url).pathname);
  console.log("migrations applied to DSQL");
  const res = await pool.query(
    "select tablename from pg_tables where schemaname='public' order by 1",
  );
  console.log(
    "tables:",
    res.rows.map((r) => r.tablename),
  );
} finally {
  await dispose();
}
