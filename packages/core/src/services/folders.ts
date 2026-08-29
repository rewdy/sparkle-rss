import * as schema from "@sparkle/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { ServicesDeps } from "./entries";
import { AppError } from "./errors";

export interface FolderDto {
  id: string;
  name: string;
  feedCount: number;
  unreadCount: number;
}

export function createFoldersService({ db }: ServicesDeps) {
  return {
    async list(userId: string): Promise<FolderDto[]> {
      const rows = await db
        .select({
          id: schema.categories.id,
          name: schema.categories.name,
          feedCount: sql<number>`count(${schema.subscriptions.feedId})::int`,
        })
        .from(schema.categories)
        .leftJoin(
          schema.subscriptions,
          eq(schema.subscriptions.categoryId, schema.categories.id),
        )
        .where(eq(schema.categories.userId, userId))
        .groupBy(schema.categories.id, schema.categories.name)
        .orderBy(asc(schema.categories.name));

      const unreadRows = await db
        .select({
          categoryId: schema.subscriptions.categoryId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.userEntries)
        .innerJoin(
          schema.subscriptions,
          and(
            eq(schema.subscriptions.userId, schema.userEntries.userId),
            eq(schema.subscriptions.feedId, schema.userEntries.feedId),
            eq(schema.userEntries.isRead, false),
          ),
        )
        .where(eq(schema.userEntries.userId, userId))
        .groupBy(schema.subscriptions.categoryId);

      const unreadByFolder = new Map<number, number>();
      for (const row of unreadRows) {
        if (row.categoryId !== null) {
          unreadByFolder.set(row.categoryId, Number(row.count));
        }
      }

      return rows.map((r) => ({
        id: r.id.toString(),
        name: r.name,
        feedCount: Number(r.feedCount),
        unreadCount: unreadByFolder.get(r.id) ?? 0,
      }));
    },

    async create(userId: string, name: string): Promise<FolderDto> {
      const existing = await db
        .select()
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.userId, userId),
            eq(schema.categories.name, name),
          ),
        );
      if (existing.length > 0) {
        throw new AppError(409, `folder "${name}" already exists`);
      }
      const inserted = await db
        .insert(schema.categories)
        .values({ userId, name })
        .returning();
      const row = inserted[0];
      if (!row) throw new AppError(500, "folder insert failed");
      return {
        id: row.id.toString(),
        name: row.name,
        feedCount: 0,
        unreadCount: 0,
      };
    },

    async rename(
      userId: string,
      categoryId: number,
      name: string,
    ): Promise<void> {
      const conflict = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.userId, userId),
            eq(schema.categories.name, name),
          ),
        );
      if (conflict.some((c) => c.id !== categoryId)) {
        throw new AppError(409, `folder "${name}" already exists`);
      }
      const updated = await db
        .update(schema.categories)
        .set({ name })
        .where(
          and(
            eq(schema.categories.userId, userId),
            eq(schema.categories.id, categoryId),
          ),
        )
        .returning({ id: schema.categories.id });
      if (updated.length === 0) throw new AppError(404, "folder not found");
    },

    // No FKs on DSQL: detach member subscriptions explicitly before deleting.
    async delete(userId: string, categoryId: number): Promise<void> {
      await db
        .update(schema.subscriptions)
        .set({ categoryId: null })
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.categoryId, categoryId),
          ),
        );
      const deleted = await db
        .delete(schema.categories)
        .where(
          and(
            eq(schema.categories.userId, userId),
            eq(schema.categories.id, categoryId),
          ),
        )
        .returning({ id: schema.categories.id });
      if (deleted.length === 0) throw new AppError(404, "folder not found");
    },

    async findByName(userId: string, name: string): Promise<number | null> {
      const rows = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.userId, userId),
            eq(schema.categories.name, name),
          ),
        );
      return rows.at(0)?.id ?? null;
    },

    async assertOwned(
      userId: string,
      categoryId: number | null,
    ): Promise<void> {
      if (categoryId === null) return;
      const rows = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.userId, userId),
            eq(schema.categories.id, categoryId),
          ),
        );
      if (rows.length === 0) throw new AppError(404, "folder not found");
    },
  };
}
