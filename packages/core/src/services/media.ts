import { createHash, randomUUID } from "node:crypto";
import * as schema from "@sparkle/db";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SelectedArticleImage } from "../feed/article-image";

export interface MediaStore {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
}

export function createMediaService({
  db,
  store,
}: {
  db: NodePgDatabase<typeof schema>;
  store: MediaStore;
}) {
  async function findForUser(userId: string, mediaIds: string[]) {
    if (mediaIds.length === 0) return [];
    return db
      .select({
        id: schema.mediaObjects.id,
        objectKey: schema.mediaObjects.objectKey,
        mimeType: schema.mediaObjects.mimeType,
        width: schema.mediaObjects.width,
        height: schema.mediaObjects.height,
      })
      .from(schema.userMedia)
      .innerJoin(
        schema.mediaObjects,
        eq(schema.mediaObjects.id, schema.userMedia.mediaObjectId),
      )
      .where(
        and(
          eq(schema.userMedia.userId, userId),
          inArray(schema.userMedia.mediaObjectId, mediaIds),
        ),
      );
  }

  return {
    async getForUser(userId: string, mediaId: string) {
      const rows = await findForUser(userId, [mediaId]);
      return rows.at(0) ?? null;
    },
    async getManyForUser(userId: string, mediaIds: string[]) {
      return findForUser(userId, mediaIds);
    },
    async attachSplash(
      userId: string,
      entryId: number,
      image: SelectedArticleImage,
    ): Promise<string> {
      const sha256 = createHash("sha256").update(image.bytes).digest("hex");
      let object = (
        await db
          .select()
          .from(schema.mediaObjects)
          .where(eq(schema.mediaObjects.sha256, sha256))
      ).at(0);
      if (!object) {
        const id = randomUUID();
        const objectKey = `media/${sha256}`;
        await store.put(objectKey, image.bytes, image.mimeType);
        await db
          .insert(schema.mediaObjects)
          .values({
            id,
            objectKey,
            sha256,
            mimeType: image.mimeType,
            byteSize: image.bytes.byteLength,
            width: image.width,
            height: image.height,
            sourceUrl: image.candidate.url,
          })
          .onConflictDoNothing();
        object = (
          await db
            .select()
            .from(schema.mediaObjects)
            .where(eq(schema.mediaObjects.sha256, sha256))
        ).at(0);
      }
      if (!object) throw new Error("media object missing after insert");
      await db
        .delete(schema.userMedia)
        .where(
          and(
            eq(schema.userMedia.userId, userId),
            eq(schema.userMedia.entryId, entryId),
            eq(schema.userMedia.kind, "article_splash"),
          ),
        );
      await db.insert(schema.userMedia).values({
        id: randomUUID(),
        userId,
        mediaObjectId: object.id,
        entryId,
        kind: "article_splash",
        alt: image.candidate.alt,
      });
      return object.id;
    },
  };
}
