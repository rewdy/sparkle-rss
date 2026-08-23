import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Client } from 'pg';

const ALREADY_EXISTS_RE = /relation "([^"]+)" already exists/u;
const CREATE_RE = /^\s*CREATE (TABLE|UNIQUE INDEX|INDEX|SCHEMA)\b/u;

/**
 * Statement rewrites applied ONLY when applying migrations to DSQL:
 * - CREATE [UNIQUE] INDEX gains ASYNC (DSQL builds indexes asynchronously;
 *   synchronous index creation is rejected).
 * Vanilla Postgres cannot parse these forms, so the rewrite lives here rather
 * than in the generated migration files.
 */
function toDsqlStatement(statement: string): string {
  return statement.replace(/^(\s*CREATE\s)(UNIQUE\sINDEX|INDEX)(\s)/u, '$1$2 ASYNC$3');
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
export async function migrateDsql(client: Client, migrationsFolder: string): Promise<void> {
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
      const statement = toDsqlStatement(rawStatement);
      index += 1;
      const started = Date.now();
      try {
        await client.query(statement);
        console.log(
          `[migrate] ${migration.hash.slice(0, 8)}#${index} ok (${Date.now() - started}ms):`,
          statement.replace(/\s+/g, ' ').slice(0, 72),
        );
      } catch (error) {
        const message = (error as Error).message;
        const tolerated = await tolerateAlreadyExists(client, statement, message);
        if (!tolerated) {
          throw new Error(
            `migration ${migration.hash} statement ${index} failed after ${Date.now() - started}ms: ${message}\nstatement: ${statement}`,
            { cause: error },
          );
        }
        console.log(
          `[migrate] ${migration.hash.slice(0, 8)}#${index} already applied (verified):`,
          statement.replace(/\s+/g, ' ').slice(0, 72),
        );
      }
    }
    await client.query(
      'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      [migration.hash, String(migration.folderMillis)],
    );
  }
}
