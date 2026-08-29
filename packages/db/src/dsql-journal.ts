import type pg from "pg";

/**
 * Drizzle's built-in migrations journal (`drizzle.__drizzle_migrations`) is created
 * with a `serial` column, which Aurora DSQL does not support. Pre-creating the
 * journal with a DSQL-compatible identity column makes `CREATE TABLE IF NOT EXISTS`
 * a no-op and lets the standard migrator work unchanged against both targets.
 */
export async function ensureMigrationJournal(client: pg.Client): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id bigint GENERATED ALWAYS AS IDENTITY (CACHE 1) PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}
