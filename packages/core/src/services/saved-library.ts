import type * as schema from "@sparkle/db";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createEntriesService, type EntryDto } from "./entries";
import { AppError } from "./errors";
import type { createSavedImagesService, SavedImageDto } from "./saved-images";

export type SavedLibraryItem =
  | { kind: "article"; id: string; savedAtMs: number; entry: EntryDto }
  | { kind: "image"; id: string; savedAtMs: number; item: SavedImageDto };
interface Cursor {
  v: 1;
  scope: "saved-library";
  sort: "asc" | "desc";
  at: string;
  kind: "article" | "image";
  id: string;
}

function decode(raw: string, sort: "asc" | "desc"): Cursor {
  try {
    if (raw.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString(),
    ) as Cursor;
    if (
      value.v !== 1 ||
      value.scope !== "saved-library" ||
      value.sort !== sort ||
      !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?\+00$/.test(value.at) ||
      !Number.isFinite(Date.parse(value.at)) ||
      !["article", "image"].includes(value.kind) ||
      !(value.kind === "article"
        ? /^[1-9]\d*$/.test(value.id)
        : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            value.id,
          ))
    )
      throw new Error();
    if (value.kind === "article" && !Number.isSafeInteger(Number(value.id)))
      throw new Error();
    return value;
  } catch {
    throw new AppError(400, "invalid saved cursor");
  }
}

export function createSavedLibraryService({
  db,
  images,
}: {
  db: NodePgDatabase<typeof schema>;
  images: ReturnType<typeof createSavedImagesService>;
}) {
  const entries = createEntriesService({ db });
  return {
    async list(
      userId: string,
      query: { limit?: number; cursor?: string; sort?: "asc" | "desc" } = {},
    ): Promise<{ items: SavedLibraryItem[]; nextCursor: string | null }> {
      const sort = query.sort ?? "desc";
      const cursor =
        query.cursor === undefined ? null : decode(query.cursor, sort);
      const compare = sql.raw(sort === "desc" ? "<" : ">");
      const direction = sql.raw(sort === "desc" ? "DESC" : "ASC");
      const rank = cursor?.kind === "article" ? 0 : 1;
      const predicate = cursor
        ? sql`WHERE (saved_at ${compare} ${cursor.at}::timestamptz OR (saved_at = ${cursor.at}::timestamptz AND (rank ${compare} ${rank} OR (rank = ${rank} AND ${cursor.kind === "article" ? sql`article_id ${compare} ${cursor.id}::bigint` : sql`image_id ${compare} ${cursor.id}::uuid`}))))`
        : sql``;
      const limit = Math.min(200, Math.max(1, query.limit ?? 50));
      const result = await db.execute<{
        kind: "article" | "image";
        id: string;
        at: string;
      }>(sql`
        SELECT kind, CASE WHEN rank = 0 THEN article_id::text ELSE image_id::text END AS id,
          (saved_at AT TIME ZONE 'UTC')::text || '+00' AS at
        FROM (
          SELECT 'article' AS kind, 0 AS rank, id AS article_id, NULL::uuid AS image_id, starred_at AS saved_at
          FROM user_entries WHERE user_id = ${userId} AND is_starred = true AND starred_at IS NOT NULL
          UNION ALL
          SELECT 'image' AS kind, 1 AS rank, NULL::bigint AS article_id, id AS image_id, saved_at
          FROM user_media WHERE user_id = ${userId} AND kind = 'saved_article_image' AND saved_at IS NOT NULL
        ) AS saved ${predicate}
        ORDER BY saved_at ${direction}, rank ${direction}, article_id ${direction}, image_id ${direction}
        LIMIT ${limit + 1}`);
      const rows = result.rows.slice(0, limit);
      const [articles, imageItems] = await Promise.all([
        entries.getByIds(
          userId,
          rows.filter((r) => r.kind === "article").map((r) => Number(r.id)),
        ),
        images.getMany(
          userId,
          rows.filter((r) => r.kind === "image").map((r) => r.id),
        ),
      ]);
      const articleMap = new Map(articles.map((e) => [e.id, e]));
      const imageMap = new Map(imageItems.map((e) => [e.id, e]));
      const items: SavedLibraryItem[] = [];
      for (const row of rows) {
        const savedAtMs = Date.parse(row.at);
        if (row.kind === "article") {
          const entry = articleMap.get(row.id);
          if (entry)
            items.push({ kind: "article", id: row.id, savedAtMs, entry });
        } else {
          const item = imageMap.get(row.id);
          if (item) items.push({ kind: "image", id: row.id, savedAtMs, item });
        }
      }
      const last = rows.at(-1);
      const nextCursor =
        result.rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ v: 1, scope: "saved-library", sort, ...last }),
            ).toString("base64url")
          : null;
      return { items, nextCursor };
    },
  };
}
