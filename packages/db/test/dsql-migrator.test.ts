import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDsql, toDsqlStatements } from "../src/dsql-migrator";

vi.mock("drizzle-orm/migrator", () => ({ readMigrationFiles: vi.fn() }));
const statements = readFileSync(
  new URL("../drizzle/0005_dry_violations.sql", import.meta.url),
  "utf8",
).split("--> statement-breakpoint");
beforeEach(() => {
  vi.mocked(readMigrationFiles).mockReturnValue([
    { sql: statements, hash: "original-0005-hash", folderMillis: 1, bps: true },
  ]);
});
function engine(partial = true) {
  const columns = new Map<string, string>();
  if (partial)
    for (const statement of statements.slice(0, 8)) {
      const [, table, column, type] =
        /ALTER TABLE "(\w+)" ADD COLUMN "(\w+)" (.+);/.exec(statement) ?? [];
      columns.set(`${table}.${column}`, type ?? "");
    }
  let journaled = false;
  let failDefault = false;
  const query = vi.fn(
    async (
      text: string,
      values?: unknown[],
    ): Promise<{
      rowCount: number;
      rows: Record<string, string | boolean>[];
    }> => {
      if (text.startsWith('select 1 from "drizzle"'))
        return { rowCount: journaled ? 1 : 0, rows: [] };
      if (text.startsWith("select t.typname")) {
        const type = columns.get(`${values?.[0]}.${values?.[1]}`);
        return {
          rowCount: type ? 1 : 0,
          rows: type
            ? [
                {
                  data_type:
                    type === "timestamp with time zone"
                      ? "timestamptz"
                      : type === "integer"
                        ? "int4"
                        : type,
                  not_null: false,
                },
              ]
            : [],
        };
      }
      if (text.startsWith('insert into "drizzle"')) {
        journaled = true;
        return { rowCount: 1, rows: [] };
      }
      if (/ADD COLUMN.*(?:DEFAULT|NOT NULL)/u.test(text))
        throw new Error("ALTER TABLE ADD COLUMN with constraint not supported");
      const add = /ALTER TABLE "(\w+)" ADD COLUMN "(\w+)" (.+);/.exec(text);
      if (add) {
        const key = `${add[1]}.${add[2]}`;
        if (columns.has(key))
          throw Object.assign(new Error("column already exists"), {
            code: "42701",
          });
        columns.set(key, add[3] ?? "");
      }
      if (text.includes("SET DEFAULT") && failDefault) {
        failDefault = false;
        throw new Error("connection interrupted");
      }
      return { rowCount: 0, rows: [] };
    },
  );
  return {
    client: { query } as unknown as Client,
    columns,
    query,
    journaled: () => journaled,
    failNextDefault: () => {
      failDefault = true;
    },
  };
}
describe("DSQL migration recovery", () => {
  it("splits only the known admission ADDs into nullable addition and separate default", () => {
    expect(toDsqlStatements(statements[8] ?? "")).toEqual([
      'ALTER TABLE "user_settings" ADD COLUMN "content_fetch_admissions" jsonb;',
      'ALTER TABLE "user_settings" ALTER COLUMN "content_fetch_admissions" SET DEFAULT \'[]\'::jsonb;',
    ]);
    expect(toDsqlStatements('CREATE INDEX "test" ON "users" ("id");')).toEqual([
      'CREATE INDEX ASYNC "test" ON "users" ("id");',
    ]);
  });
  it.each([false, true])(
    "completes original migration with partial schema=%s and skips journaled reruns",
    async (partial) => {
      const db = engine(partial);
      await migrateDsql(db.client, "/unused");
      expect(db.columns.size).toBe(10);
      expect(db.journaled()).toBe(true);
      expect(
        db.query.mock.calls.filter(([text]) =>
          text.includes('insert into "drizzle"'),
        ),
      ).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('("hash", "created_at")'),
        ["original-0005-hash", "1"],
      );
      const count = db.query.mock.calls.length;
      await migrateDsql(db.client, "/unused");
      expect(db.query.mock.calls.length).toBe(count + 1);
    },
  );
  it("recovers after an added column committed but setting its default failed", async () => {
    const db = engine();
    db.failNextDefault();
    await expect(migrateDsql(db.client, "/unused")).rejects.toThrow(
      "connection interrupted",
    );
    expect(db.journaled()).toBe(false);
    await migrateDsql(db.client, "/unused");
    expect(db.journaled()).toBe(true);
  });
  it("does not silently accept an existing column with the wrong type", async () => {
    const db = engine();
    db.columns.set("user_entries.full_content_html", "integer");
    await expect(migrateDsql(db.client, "/unused")).rejects.toThrow(
      "column already exists",
    );
    expect(db.journaled()).toBe(false);
  });
});
