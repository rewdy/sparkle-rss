import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Client } from "pg";

const ALREADY_EXISTS_RE = /relation "([^"]+)" already exists/u;
const CREATE_RE = /^\s*CREATE (TABLE|UNIQUE INDEX|INDEX|SCHEMA)\b/u;

/**
 * Statement rewrites applied ONLY when applying migrations to DSQL:
 * - CREATE [UNIQUE] INDEX gains ASYNC (DSQL builds indexes asynchronously;
 *   synchronous index creation is rejected).
 * Vanilla Postgres cannot parse these forms, so the rewrite lives here rather
 * than in the generated migration files.
 */
export function toDsqlStatements(statement: string): string[] {
  const rewritten = statement
    .replace(/\s+USING\s+btree/iu, "")
    .replace(/^(\s*CREATE\s)(UNIQUE\sINDEX|INDEX)(\s)/u, "$1$2 ASYNC$3");
  // Preserve migration 0005's journal hash. DSQL cannot add a column with
  // inline DEFAULT / NOT NULL. These two fields intentionally permit NULL;
  // old rows use application fallbacks. Migration 0006 aligns Postgres too.
  const admission =
    /^\s*ALTER TABLE "user_settings" ADD COLUMN "(content_fetch_admissions|content_fetch_version)" (jsonb|integer) DEFAULT (.+) NOT NULL;?\s*$/u.exec(
      rewritten,
    );
  if (admission) {
    const [, column, type, defaultValue] = admission;
    return [
      `ALTER TABLE "user_settings" ADD COLUMN "${column}" ${type};`,
      `ALTER TABLE "user_settings" ALTER COLUMN "${column}" SET DEFAULT ${defaultValue};`,
    ];
  }
  return [rewritten];
}

/** A failed nontransactional migration can have committed earlier ADDs. Only
 * accept a duplicate when the catalog confirms the requested nullable type. */
async function existingAddedColumn(
  client: Client,
  statement: string,
  error: unknown,
): Promise<boolean> {
  if ((error as { code?: string }).code !== "42701") return false;
  const add =
    /^\s*ALTER TABLE "([a-z_]+)" ADD COLUMN "([a-z_]+)" (text|uuid|timestamp with time zone|jsonb|integer);?\s*$/u.exec(
      statement,
    );
  if (!add) return false;
  const [, table, column, type] = add;
  const result = await client.query(
    "select t.typname as data_type, a.attnotnull as not_null from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace join pg_type t on t.oid = a.atttypid where n.nspname = 'public' and c.relname = $1 and a.attname = $2 and a.attnum > 0 and not a.attisdropped",
    [table, column],
  );
  return (
    result.rows.length === 1 &&
    result.rows[0]?.data_type ===
      (type === "timestamp with time zone"
        ? "timestamptz"
        : type === "integer"
          ? "int4"
          : type) &&
    result.rows[0]?.not_null === false
  );
}

/**
 * DSQL DDL acknowledgments can be spurious during early cluster life: a CREATE
 * may report "already exists" while the object materializes asynchronously, and
 * even catalog-verification reads on the same connection can lag. Forward-only,
 * reviewed migrations make it safe to treat already-exists on a CREATE as
 * "applied"; we log it loudly so surprises stay visible.
 */
async function tolerateAlreadyExists(
  _client: Client,
  statement: string,
  message: string,
): Promise<boolean> {
  if (!ALREADY_EXISTS_RE.test(message)) return false;
  return CREATE_RE.test(statement);
}

/**
 * Aurora DSQL migration runner. Two engine constraints shape this:
 *
 * 1. Multiple DDL statements inside one transaction are rejected, so drizzle's
 *    stock runtime migrator (BEGIN…COMMIT per file) cannot run against it.
 * 2. Catalog visibility across concurrent connections is not immediate for DDL;
 *    running every statement over ONE serialized connection avoids spurious
 *    "relation already exists" style races seen during the Phase-0 spike.
 *
 * Trade-off accepted (docs/03-data-model.md): a failed migration may leave
 * partially-applied objects behind; the error surfaces the exact statement.
 */
export async function migrateDsql(
  client: Client,
  migrationsFolder: string,
): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });

  for (const migration of migrations) {
    const done = await client.query(
      'select 1 from "drizzle"."__drizzle_migrations" where hash = $1',
      [migration.hash],
    );
    if ((done.rowCount ?? 0) > 0) continue;

    let index = -1;
    for (const rawStatement of migration.sql) {
      if (rawStatement.trim().length === 0) continue;
      for (const statement of toDsqlStatements(rawStatement)) {
        index += 1;
        const started = Date.now();
        try {
          await client.query(statement);
          console.log(
            `[migrate] ${migration.hash.slice(0, 8)}#${index} ok (${Date.now() - started}ms):`,
            statement.replace(/\s+/g, " ").slice(0, 72),
          );
        } catch (error) {
          const message = (error as Error).message;
          const tolerated =
            (await existingAddedColumn(client, statement, error)) ||
            (await tolerateAlreadyExists(client, statement, message));
          if (!tolerated) {
            throw new Error(
              `migration ${migration.hash} statement ${index} failed after ${Date.now() - started}ms: ${message}\nstatement: ${statement}`,
              { cause: error },
            );
          }
          console.log(
            `[migrate] ${migration.hash.slice(0, 8)}#${index} already applied (verified):`,
            statement.replace(/\s+/g, " ").slice(0, 72),
          );
        }
      }
    }
    await client.query(
      'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      [migration.hash, String(migration.folderMillis)],
    );
  }
}
