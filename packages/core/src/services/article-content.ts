import { randomUUID } from "node:crypto";
import * as schema from "@sparkle/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { shouldAutomaticallyFetchContent } from "../article/content-policy";
import {
  type ExtractedArticle,
  fetchAndExtractArticle,
} from "../article/fetch-article";
import type { ServicesDeps } from "./entries";
import { AppError } from "./errors";

type Row = typeof schema.userEntries.$inferSelect;
export interface FullContent {
  automaticFetchEligible: boolean;
  status: "idle" | "pending" | "ready" | "error";
  fetchedAtMs: number | null;
  finalUrl: string | null;
  retryAtMs: number | null;
  automaticRetryAtMs: number | null;
  pendingUntilMs: number | null;
  error: string | null;
}
export interface ContentProjection {
  contentHtml: string;
  originalContentHtml: string;
  fullContent: FullContent;
}
function project(row: Row, now: number): ContentProjection {
  const until =
    row.contentAttemptToken && row.contentAttemptAt
      ? row.contentAttemptAt.getTime() + 60_000
      : null;
  return {
    contentHtml: row.fullContentHtml ?? row.contentHtml,
    originalContentHtml: row.contentHtml,
    fullContent: {
      automaticFetchEligible: shouldAutomaticallyFetchContent(row.contentHtml),
      status:
        row.fullContentHtml !== null
          ? "ready"
          : until && until > now
            ? "pending"
            : row.contentFailure || until
              ? "error"
              : "idle",
      fetchedAtMs: row.fullContentFetchedAt?.getTime() ?? null,
      finalUrl: row.fullContentUrl,
      retryAtMs: row.contentRetryAt?.getTime() ?? null,
      automaticRetryAtMs: row.contentAutomaticRetryAt?.getTime() ?? null,
      pendingUntilMs: until,
      error:
        row.contentFailure ??
        (until && until <= now
          ? "The previous request ended. Please retry."
          : null),
    },
  };
}
function conflict(error: unknown): boolean {
  const e = error as { code?: string; cause?: unknown };
  return (
    e?.code === "40001" ||
    e?.code === "40P01" ||
    e?.code === "OC000" ||
    (!!e?.cause && conflict(e.cause))
  );
}
export function createArticleContentService({
  db,
  extract = fetchAndExtractArticle,
  now = Date.now,
}: ServicesDeps & {
  extract?: (url: string) => Promise<ExtractedArticle>;
  now?: () => number;
}) {
  async function transaction<T>(
    work: Parameters<typeof db.transaction<T>>[0],
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.transaction(work);
      } catch (error) {
        if (attempt >= 3 || !conflict(error)) throw error;
      }
    }
  }
  const scope = (userId: string, id: number) =>
    and(eq(schema.userEntries.userId, userId), eq(schema.userEntries.id, id));
  async function get(userId: string, id: number) {
    const [row] = await db
      .select()
      .from(schema.userEntries)
      .where(scope(userId, id));
    if (!row) throw new AppError(404, "entry not found");
    return project(row, now());
  }
  return {
    get,
    async decorate<
      T extends {
        id: string;
        contentHtml: string;
        entryId?: string | null;
        source?: string;
      },
    >(userId: string, items: T[]): Promise<(T & Partial<ContentProjection>)[]> {
      const idOf = (item: T) =>
        item.source === "url"
          ? null
          : Number(item.source === "entry" ? item.entryId : item.id);
      const ids = items
        .map(idOf)
        .filter(
          (id): id is number =>
            id !== null && Number.isSafeInteger(id) && id > 0,
        );
      if (!ids.length) return items;
      const rows = await db
        .select()
        .from(schema.userEntries)
        .where(
          and(
            eq(schema.userEntries.userId, userId),
            inArray(schema.userEntries.id, ids),
          ),
        );
      const byId = new Map(rows.map((row) => [row.id, row]));
      return items.map((item) => {
        const row = byId.get(idOf(item) ?? 0);
        return row ? { ...item, ...project(row, now()) } : item;
      });
    },
    async ensure(
      userId: string,
      id: number,
      trigger: "manual" | "automatic",
    ): Promise<{
      status: 200 | 202 | 429 | 502;
      retryAfter: number | null;
      content: ContentProjection;
      message?: string;
    }> {
      const token = randomUUID();
      const admission = await transaction(async (tx) => {
        // Authorize before allocating admission state, and never accept a URL from the caller.
        const [owned] = await tx
          .select()
          .from(schema.userEntries)
          .where(scope(userId, id));
        if (!owned) throw new AppError(404, "entry not found");
        if (
          trigger === "automatic" &&
          !shouldAutomaticallyFetchContent(owned.contentHtml)
        ) {
          return {
            status: 200 as const,
            content: project(owned, now()),
            retryAfter: null,
          };
        }
        await tx
          .insert(schema.userSettings)
          .values({ userId })
          .onConflictDoNothing();
        const [settings] = await tx
          .select()
          .from(schema.userSettings)
          .where(eq(schema.userSettings.userId, userId));
        if (!settings) throw new Error("missing admission state");
        const [locked] = await tx
          .update(schema.userSettings)
          .set({
            contentFetchVersion: sql`${schema.userSettings.contentFetchVersion} + 1`,
          })
          .where(
            and(
              eq(schema.userSettings.userId, userId),
              eq(
                schema.userSettings.contentFetchVersion,
                settings.contentFetchVersion,
              ),
            ),
          )
          .returning();
        if (!locked)
          throw Object.assign(new Error("admission conflict"), {
            code: "40001",
          });
        // Re-read after admission serialization so another request's committed claim is visible.
        const [row] = await tx
          .select()
          .from(schema.userEntries)
          .where(scope(userId, id));
        if (!row) throw new AppError(404, "entry not found");
        const at = now();
        const content = project(row, at);
        if (content.fullContent.status === "ready")
          return { status: 200 as const, content, retryAfter: null };
        if (content.fullContent.status === "pending")
          return { status: 202 as const, content, retryAfter: 2 };
        let url: URL;
        try {
          url = new URL(row.url);
        } catch {
          throw new AppError(400, "entry has no supported article URL");
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new AppError(400, "entry has no supported article URL");
        const retryAt =
          (trigger === "automatic"
            ? row.contentAutomaticRetryAt
            : row.contentRetryAt
          )?.getTime() ?? 0;
        const admissions = locked.contentFetchAdmissions.filter(
          (time) => time > at - 3_600_000,
        );
        const budgetAt =
          admissions.length >= 30 ? (admissions[0] ?? at) + 3_600_000 : 0;
        const blockedUntil = Math.max(retryAt, budgetAt);
        if (blockedUntil > at)
          return {
            status: 429 as const,
            content,
            retryAfter: Math.max(1, Math.ceil((blockedUntil - at) / 1000)),
            message: "Please wait before fetching full content again.",
          };
        await tx
          .update(schema.userSettings)
          .set({ contentFetchAdmissions: [...admissions, at] })
          .where(eq(schema.userSettings.userId, userId));
        await tx
          .update(schema.userEntries)
          .set({
            contentAttemptToken: token,
            contentAttemptAt: new Date(at),
            contentFailure: null,
          })
          .where(scope(userId, id));
        return { url: url.toString() };
      });
      if (!("url" in admission) || admission.url === undefined)
        return admission as Exclude<typeof admission, { url: string }>;
      let article: ExtractedArticle | undefined;
      let failure: string | null = null;
      try {
        article = await extract(admission.url);
        if (!article.extracted || !article.contentHtml.trim())
          throw new Error("unreadable");
      } catch {
        failure =
          "Full content could not be loaded. Try again or open the original site.";
      }
      const at = now();
      await transaction(async (tx) => {
        await tx
          .update(schema.userEntries)
          .set(
            failure
              ? {
                  contentAttemptToken: null,
                  contentFailure: failure,
                  contentRetryAt: new Date(at + 30_000),
                  contentAutomaticRetryAt: new Date(at + 900_000),
                }
              : {
                  fullContentHtml: article?.contentHtml,
                  fullContentUrl: article?.url,
                  fullContentFetchedAt: new Date(at),
                  contentAttemptToken: null,
                  contentFailure: null,
                  contentRetryAt: null,
                  contentAutomaticRetryAt: null,
                },
          )
          .where(
            and(
              scope(userId, id),
              eq(schema.userEntries.contentAttemptToken, token),
              sql`${schema.userEntries.contentAttemptAt} > ${new Date(at - 60_000).toISOString()}`,
            ),
          );
      });
      const content = await get(userId, id);
      return {
        status:
          content.fullContent.status === "ready" ? 200 : failure ? 502 : 202,
        retryAfter: failure
          ? 30
          : content.fullContent.status === "pending"
            ? 2
            : null,
        content,
        ...(failure ? { message: failure } : {}),
      };
    },
  };
}
