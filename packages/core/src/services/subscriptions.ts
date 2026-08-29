import { createHash } from "node:crypto";
import * as schema from "@sparkle/db";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { discoverFeed, type FetchLike } from "../feed/discover";
import { AppError } from "./errors";

export interface ServicesDeps {
  db: NodePgDatabase<typeof schema>;
}

export interface SubscriptionDto {
  feedId: string;
  url: string;
  siteUrl: string;
  iconUrl: string;
  customTitle: string | null;
  feedTitle: string;
  displayTitle: string;
  categoryId: string | null;
  categoryName: string | null;
  entryCount: number;
  newestEntryAtMs: number | null;
}

export function guidHash(guid: string): string {
  return createHash("sha256").update(guid).digest("hex");
}

export function createSubscriptionsService(
  { db }: ServicesDeps,
  hooks: { onSubscribed?: (feedId: number) => void } = {},
) {
  async function ensureFeedRow(
    feedUrl: string,
    discoveredTitle: string | null,
    discoveredIconUrl = "",
  ): Promise<number> {
    await db
      .insert(schema.feeds)
      .values({
        url: feedUrl,
        title: discoveredTitle ?? "",
        ...(discoveredIconUrl ? { iconUrl: discoveredIconUrl } : {}),
      })
      .onConflictDoNothing();
    const rows = await db
      .select()
      .from(schema.feeds)
      .where(eq(schema.feeds.url, feedUrl));
    const row = rows[0];
    if (!row) throw new AppError(500, "feed row missing after upsert");
    return row.id;
  }

  return {
    async list(userId: string): Promise<SubscriptionDto[]> {
      const rows = await db
        .select({
          feedId: schema.subscriptions.feedId,
          customTitle: schema.subscriptions.title,
          categoryId: schema.subscriptions.categoryId,
          categoryName: schema.categories.name,
          url: schema.feeds.url,
          siteUrl: schema.feeds.siteUrl,
          iconUrl: schema.feeds.iconUrl,
          feedTitle: schema.feeds.title,
          entryCount: sql<number>`(
            select count(*)::int from ${schema.userEntries}
            where ${schema.userEntries.userId} = ${schema.subscriptions.userId}
              and ${schema.userEntries.feedId} = ${schema.subscriptions.feedId}
          )`,
          newestMs: sql<Date | null>`(
            select max(${schema.userEntries.publishedAt}) from ${schema.userEntries}
            where ${schema.userEntries.userId} = ${schema.subscriptions.userId}
              and ${schema.userEntries.feedId} = ${schema.subscriptions.feedId}
          )`,
        })
        .from(schema.subscriptions)
        .innerJoin(
          schema.feeds,
          eq(schema.feeds.id, schema.subscriptions.feedId),
        )
        .leftJoin(
          schema.categories,
          eq(schema.categories.id, schema.subscriptions.categoryId),
        )
        .where(eq(schema.subscriptions.userId, userId));

      return rows.map((r) => ({
        feedId: r.feedId.toString(),
        url: r.url,
        siteUrl: r.siteUrl,
        iconUrl: r.iconUrl,
        customTitle: r.customTitle,
        feedTitle: r.feedTitle,
        displayTitle: r.customTitle || r.feedTitle || r.url,
        categoryId: r.categoryId?.toString() ?? null,
        categoryName: r.categoryName ?? null,
        entryCount: Number(r.entryCount),
        newestEntryAtMs: r.newestMs ? new Date(r.newestMs).getTime() : null,
      }));
    },

    async subscribe(
      userId: string,
      inputUrl: string,
      opts: {
        title?: string;
        categoryId?: number | null;
        fetch?: FetchLike;
      } = {},
    ): Promise<{ subscription: SubscriptionDto; created: boolean }> {
      if (opts.categoryId !== undefined && opts.categoryId !== null) {
        const folder = await db
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(
            and(
              eq(schema.categories.userId, userId),
              eq(schema.categories.id, opts.categoryId),
            ),
          );
        if (folder.length === 0) throw new AppError(404, "folder not found");
      }

      const existingByUrl =
        (
          await db
            .select()
            .from(schema.feeds)
            .where(eq(schema.feeds.url, inputUrl))
        )[0] ?? null;

      let feedId: number;
      let resolvedTitle = opts.title ?? null;
      let siteUrl = "";
      if (existingByUrl) {
        feedId = existingByUrl.id;
      } else {
        const discovered = await discoverFeed(inputUrl, opts.fetch);
        siteUrl = discovered.siteUrl;
        if (!resolvedTitle && discovered.title)
          resolvedTitle = discovered.title;
        feedId = await ensureFeedRow(
          discovered.feedUrl,
          resolvedTitle,
          discovered.iconUrl,
        );
      }

      const inserted = await db
        .insert(schema.subscriptions)
        .values({
          userId,
          feedId,
          categoryId: opts.categoryId ?? null,
          title: opts.title ?? null,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length === 0) {
        throw new AppError(409, "already subscribed to this feed");
      }

      await db
        .update(schema.feeds)
        .set({ orphanedAt: null })
        .where(eq(schema.feeds.id, feedId));

      hooks.onSubscribed?.(feedId);

      const list = await this.list(userId);
      const dto = list.find((s) => s.feedId === feedId.toString());
      if (!dto) throw new AppError(500, "subscription vanished after insert");
      void siteUrl;
      return { subscription: dto, created: true };
    },

    /**
     * Subscribe without network validation (OPML imports defer feed checks to
     * the first refresh cycle).
     */
    async subscribeDirect(
      userId: string,
      feedUrl: string,
      opts: {
        title?: string | null;
        categoryId?: number | null;
        siteUrl?: string;
      } = {},
    ): Promise<SubscriptionDto> {
      if (opts.categoryId != null) {
        const folder = await db
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(
            and(
              eq(schema.categories.userId, userId),
              eq(schema.categories.id, opts.categoryId),
            ),
          );
        if (folder.length === 0) throw new AppError(404, "folder not found");
      }
      await db
        .insert(schema.feeds)
        .values({
          url: feedUrl,
          title: opts.title ?? "",
          siteUrl: opts.siteUrl ?? "",
        })
        .onConflictDoNothing();
      const feedId =
        (
          await db
            .select()
            .from(schema.feeds)
            .where(eq(schema.feeds.url, feedUrl))
        ).at(0)?.id ?? -1;
      const inserted = await db
        .insert(schema.subscriptions)
        .values({
          userId,
          feedId,
          categoryId: opts.categoryId ?? null,
          title: opts.title ?? null,
        })
        .onConflictDoNothing()
        .returning();
      const list = await this.list(userId);
      const dto = list.find((s) => s.url === feedUrl);
      if (!dto) throw new AppError(500, "subscription missing after insert");
      if (inserted.length > 0) {
        await db
          .update(schema.feeds)
          .set({ orphanedAt: null })
          .where(eq(schema.feeds.id, feedId));
        hooks.onSubscribed?.(feedId);
      }
      return dto;
    },

    async unsubscribe(userId: string, feedId: number): Promise<void> {
      await db
        .delete(schema.userEntries)
        .where(
          and(
            eq(schema.userEntries.userId, userId),
            eq(schema.userEntries.feedId, feedId),
          ),
        );
      const deleted = await db
        .delete(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.feedId, feedId),
          ),
        )
        .returning({ feedId: schema.subscriptions.feedId });
      if (deleted.length === 0)
        throw new AppError(404, "subscription not found");

      await db
        .update(schema.feeds)
        .set({ orphanedAt: new Date() })
        .where(
          and(
            eq(schema.feeds.id, feedId),
            sql`not exists (
              select 1 from ${schema.subscriptions}
              where ${schema.subscriptions.feedId} = ${schema.feeds.id}
            )`,
          ),
        );
    },

    async edit(
      userId: string,
      feedId: number,
      changes: { title?: string | null; categoryId?: number | null },
    ): Promise<SubscriptionDto> {
      const patch: Partial<typeof schema.subscriptions.$inferInsert> = {};
      if (changes.title !== undefined) patch.title = changes.title;
      if (changes.categoryId !== undefined)
        patch.categoryId = changes.categoryId;
      if (Object.keys(patch).length === 0)
        throw new AppError(400, "nothing to change");

      const updated = await db
        .update(schema.subscriptions)
        .set(patch)
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.feedId, feedId),
          ),
        )
        .returning({ feedId: schema.subscriptions.feedId });
      if (updated.length === 0)
        throw new AppError(404, "subscription not found");

      const list = await this.list(userId);
      const dto = list.find((s) => s.feedId === feedId.toString());
      if (!dto) throw new AppError(500, "subscription vanished after update");
      return dto;
    },

    async assertOwned(userId: string, feedId: number): Promise<void> {
      const rows = await db
        .select({ feedId: schema.subscriptions.feedId })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.feedId, feedId),
          ),
        );
      if (rows.length === 0) throw new AppError(404, "subscription not found");
    },
  };
}

export async function insertEntriesForUser(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  feedId: number,
  entries: Array<{
    guid: string;
    title?: string;
    contentHtml?: string;
    url?: string;
    author?: string;
    publishedAt: Date;
    enclosures?: unknown;
  }>,
): Promise<number> {
  if (entries.length === 0) return 0;
  const inserted = await db
    .insert(schema.userEntries)
    .values(
      entries.map((e) => ({
        userId,
        feedId,
        guid: e.guid,
        guidHash: guidHash(e.guid),
        title: e.title ?? "",
        contentHtml: e.contentHtml ?? "",
        url: e.url ?? "",
        author: e.author ?? "",
        publishedAt: e.publishedAt,
        enclosures: (e.enclosures ??
          []) as (typeof schema.userEntries.$inferInsert)["enclosures"],
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.userEntries.id });
  return inserted.length;
}
