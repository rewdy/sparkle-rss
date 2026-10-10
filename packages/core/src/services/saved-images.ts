import { createHash, randomUUID } from "node:crypto";
import * as schema from "@sparkle/db";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fetchSavedImage } from "../article/fetch-image";
import { articleImages, normalizeImageUrl } from "../article/image-source";
import type { SelectedArticleImage } from "../feed/article-image";
import { AppError } from "./errors";
import type { createMediaService } from "./media";

export interface ImageSource {
  kind: "entry" | "read-later";
  id: string;
}
export type ImageProvenance = NonNullable<
  typeof schema.userMedia.$inferSelect.source
>;
export interface SavedImageDto {
  id: string;
  savedAtMs: number;
  imageSourceUrl: string;
  image: { id: string; width: number; height: number; alt: string };
  source: ImageProvenance & { available: boolean };
}

export function createSavedImagesService({
  db,
  media,
  fetchImage = fetchSavedImage,
}: {
  db: NodePgDatabase<typeof schema>;
  media: ReturnType<typeof createMediaService>;
  fetchImage?: (url: string, alt: string) => Promise<SelectedArticleImage>;
}) {
  async function resolveSource(userId: string, requested: ImageSource) {
    let entryId = requested.kind === "entry" ? Number(requested.id) : null;
    let readLaterId: string | null = null;
    let html = "",
      url = "",
      title = "",
      siteName = "";
    if (requested.kind === "read-later") {
      const row = (
        await db
          .select()
          .from(schema.readLaterItems)
          .where(
            and(
              eq(schema.readLaterItems.userId, userId),
              eq(schema.readLaterItems.id, requested.id),
            ),
          )
      ).at(0);
      if (!row) throw new AppError(404, "source article not found");
      readLaterId = row.id;
      entryId = row.entryId;
      html = row.contentHtml;
      url = row.url;
      title = row.title;
      siteName = row.siteName;
    }
    let feedId: string | null = null,
      feedTitle = "",
      feedUrl = "";
    if (entryId !== null) {
      if (!Number.isSafeInteger(entryId) || entryId <= 0)
        throw new AppError(400, "invalid source entry");
      const entry = (
        await db
          .select()
          .from(schema.userEntries)
          .where(
            and(
              eq(schema.userEntries.userId, userId),
              eq(schema.userEntries.id, entryId),
            ),
          )
      ).at(0);
      if (!entry && requested.kind === "entry")
        throw new AppError(404, "source article not found");
      if (entry) {
        html = entry.contentHtml;
        url = entry.url;
        title = entry.title;
        feedId = entry.feedId.toString();
        const feed = (
          await db
            .select()
            .from(schema.feeds)
            .where(eq(schema.feeds.id, entry.feedId))
        ).at(0);
        const sub = (
          await db
            .select()
            .from(schema.subscriptions)
            .where(
              and(
                eq(schema.subscriptions.userId, userId),
                eq(schema.subscriptions.feedId, entry.feedId),
              ),
            )
        ).at(0);
        feedTitle = sub?.title || feed?.title || "";
        feedUrl = feed?.url ?? "";
      } else entryId = null;
    }
    const source: ImageProvenance = {
      kind: entryId !== null ? "entry" : "read-later",
      id: entryId?.toString() ?? requested.id,
      articleTitle: title,
      articleUrl: url,
      feedId,
      feedTitle,
      feedUrl,
      siteName,
    };
    return {
      source,
      entryId,
      readLaterId,
      html,
      identity: `${source.kind}:${source.id}`,
    };
  }

  async function getMany(
    userId: string,
    ids?: string[],
    sourceIdentity?: string,
  ): Promise<SavedImageDto[]> {
    if (ids?.length === 0) return [];
    const rows = await db
      .select({ association: schema.userMedia, object: schema.mediaObjects })
      .from(schema.userMedia)
      .innerJoin(
        schema.mediaObjects,
        eq(schema.mediaObjects.id, schema.userMedia.mediaObjectId),
      )
      .where(
        and(
          eq(schema.userMedia.userId, userId),
          eq(schema.userMedia.kind, "saved_article_image"),
          ids ? inArray(schema.userMedia.id, ids) : undefined,
          sourceIdentity
            ? eq(schema.userMedia.sourceIdentity, sourceIdentity)
            : undefined,
        ),
      );
    const entryIds = rows.flatMap((r) =>
      r.association.source?.kind === "entry"
        ? [Number(r.association.source.id)]
        : [],
    );
    const readLaterIds = rows.flatMap((r) =>
      r.association.source?.kind === "read-later"
        ? [r.association.source.id]
        : [],
    );
    const entries = entryIds.length
      ? await db
          .select({ id: schema.userEntries.id })
          .from(schema.userEntries)
          .where(
            and(
              eq(schema.userEntries.userId, userId),
              inArray(schema.userEntries.id, entryIds),
            ),
          )
      : [];
    const later = readLaterIds.length
      ? await db
          .select({ id: schema.readLaterItems.id })
          .from(schema.readLaterItems)
          .where(
            and(
              eq(schema.readLaterItems.userId, userId),
              inArray(schema.readLaterItems.id, readLaterIds),
            ),
          )
      : [];
    const available = new Set([
      ...entries.map((r) => `entry:${r.id}`),
      ...later.map((r) => `read-later:${r.id}`),
    ]);
    return rows.flatMap(({ association: a, object: o }) =>
      a.source && a.savedAt && a.imageSourceUrl
        ? [
            {
              id: a.id,
              savedAtMs: a.savedAt.getTime(),
              imageSourceUrl: a.imageSourceUrl,
              image: { id: o.id, width: o.width, height: o.height, alt: a.alt },
              source: {
                ...a.source,
                available: available.has(`${a.source.kind}:${a.source.id}`),
              },
            },
          ]
        : [],
    );
  }

  return {
    getMany,
    async get(userId: string, id: string) {
      const item = (await getMany(userId, [id])).at(0);
      if (!item) throw new AppError(404, "saved image not found");
      return item;
    },
    async listForSource(userId: string, source: ImageSource) {
      const resolved = await resolveSource(userId, source);
      return getMany(userId, undefined, resolved.identity);
    },
    async save(
      userId: string,
      source: ImageSource,
      rawUrl: string,
    ): Promise<SavedImageDto> {
      const resolved = await resolveSource(userId, source);
      const url = normalizeImageUrl(rawUrl, resolved.source.articleUrl);
      const images = articleImages(resolved.html, resolved.source.articleUrl);
      const splash =
        resolved.entryId !== null
          ? (
              await db
                .select({
                  object: schema.mediaObjects,
                  alt: schema.userMedia.alt,
                })
                .from(schema.userMedia)
                .innerJoin(
                  schema.mediaObjects,
                  eq(schema.mediaObjects.id, schema.userMedia.mediaObjectId),
                )
                .where(
                  and(
                    eq(schema.userMedia.userId, userId),
                    eq(schema.userMedia.entryId, resolved.entryId),
                    eq(schema.userMedia.kind, "article_splash"),
                    eq(schema.mediaObjects.sourceUrl, url),
                  ),
                )
            ).at(0)
          : undefined;
      if (!images.has(url) && !splash)
        throw new AppError(400, "image is not part of this article");
      const dedupeHash = createHash("sha256")
        .update(`${resolved.identity}\n${url}`)
        .digest("hex");
      const where = and(
        eq(schema.userMedia.userId, userId),
        eq(schema.userMedia.kind, "saved_article_image"),
        eq(schema.userMedia.dedupeHash, dedupeHash),
      );
      const existing = (
        await db
          .select({ id: schema.userMedia.id })
          .from(schema.userMedia)
          .where(where)
      ).at(0);
      if (existing) return this.get(userId, existing.id);
      const alt = images.get(url) ?? splash?.alt ?? "";
      let objectId = splash?.object.id;
      if (!objectId) {
        const image = await fetchImage(url, alt);
        objectId = (await media.persist(image)).id;
      }
      await db
        .insert(schema.userMedia)
        .values({
          id: randomUUID(),
          userId,
          mediaObjectId: objectId,
          entryId: resolved.entryId,
          readLaterItemId: resolved.readLaterId,
          kind: "saved_article_image",
          sourceIdentity: resolved.identity,
          dedupeHash,
          imageSourceUrl: url,
          alt,
          savedAt: new Date(),
          source: resolved.source,
        })
        .onConflictDoNothing();
      const row = (
        await db
          .select({ id: schema.userMedia.id })
          .from(schema.userMedia)
          .where(where)
      ).at(0);
      if (!row) throw new AppError(500, "saved image missing after insert");
      return this.get(userId, row.id);
    },
    async remove(userId: string, id: string) {
      // Query only the owner's association. Foreign IDs and missing IDs expose
      // the same not-found result; no global existence probe is performed.
      const rows = await db
        .delete(schema.userMedia)
        .where(
          and(
            eq(schema.userMedia.userId, userId),
            eq(schema.userMedia.id, id),
            eq(schema.userMedia.kind, "saved_article_image"),
          ),
        )
        .returning({ id: schema.userMedia.id });
      if (!rows.length) throw new AppError(404, "saved image not found");
    },
  };
}
