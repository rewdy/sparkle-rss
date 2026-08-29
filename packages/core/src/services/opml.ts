import * as schema from "@sparkle/db";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { XMLParser } from "fast-xml-parser";
import { AppError } from "./errors";
import { createFoldersService } from "./folders";

export interface ServicesDeps {
  db: NodePgDatabase<typeof schema>;
}

interface OpmlOutline {
  "@text"?: string;
  "@title"?: string;
  "@xmlUrl"?: string;
  "@htmlUrl"?: string;
  "@type"?: string;
  outline?: OpmlOutline[] | OpmlOutline;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createOpmlService({ db }: ServicesDeps) {
  const _folders = createFoldersService({ db });

  return {
    async exportOpml(
      _userId: string,
      subscriptions: Array<{
        displayTitle: string;
        url: string;
        siteUrl: string;
        categoryId: string | null;
        categoryName: string | null;
      }>,
    ): Promise<string> {
      const byFolder = new Map<string, typeof subscriptions>();
      const loose: typeof subscriptions = [];
      for (const sub of subscriptions) {
        if (sub.categoryId && sub.categoryName) {
          const list = byFolder.get(sub.categoryId) ?? [];
          list.push(sub);
          byFolder.set(sub.categoryId, list);
        } else {
          loose.push(sub);
        }
      }

      const feedOutline = (sub: (typeof subscriptions)[number]): string => {
        return `    <outline type="rss" text="${xmlEscape(sub.displayTitle)}" title="${xmlEscape(
          sub.displayTitle,
        )}" xmlUrl="${xmlEscape(sub.url)}" htmlUrl="${xmlEscape(sub.siteUrl)}"/>`;
      };

      const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        "  <head>",
        "    <title>sparkle-rss subscriptions</title>",
        `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
        "  </head>",
        "  <body>",
      ];
      for (const [, subs] of byFolder) {
        const name = subs[0]?.categoryName ?? "";
        lines.push(
          `    <outline text="${xmlEscape(name)}" title="${xmlEscape(name)}">`,
        );
        for (const sub of subs) lines.push(feedOutline(sub));
        lines.push("    </outline>");
      }
      for (const sub of loose) lines.push(feedOutline(sub));
      lines.push("  </body>");
      lines.push("</opml>");
      return `${lines.join("\n")}\n`;
    },

    async parseImport(xml: string): Promise<
      Array<{
        folderName: string | null;
        feedUrl: string;
        title: string | null;
        siteUrl: string | null;
      }>
    > {
      let parsed: {
        opml?: { body?: { outline?: OpmlOutline[] | OpmlOutline } };
      };
      try {
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "@",
          isArray: (name) => name === "outline",
        });
        parsed = parser.parse(xml);
      } catch {
        throw new AppError(400, "invalid OPML: not parseable XML");
      }
      const root = parsed.opml?.body?.outline;
      if (!root) throw new AppError(400, "invalid OPML: no outlines found");
      const topLevel = Array.isArray(root) ? root : [root];

      const result: Array<{
        folderName: string | null;
        feedUrl: string;
        title: string | null;
        siteUrl: string | null;
      }> = [];

      const walk = (
        outlines: OpmlOutline[],
        folderName: string | null,
      ): void => {
        for (const node of outlines) {
          const xmlUrl = node["@xmlUrl"];
          if (typeof xmlUrl === "string" && xmlUrl.length > 0) {
            result.push({
              folderName,
              feedUrl: xmlUrl,
              title: node["@title"] ?? node["@text"] ?? null,
              siteUrl: node["@htmlUrl"] ?? null,
            });
            continue;
          }
          const children = node.outline
            ? Array.isArray(node.outline)
              ? node.outline
              : [node.outline]
            : [];
          const name = node["@text"] ?? node["@title"] ?? null;
          if (children.length > 0) walk(children, name);
        }
      };
      walk(topLevel, null);
      return result;
    },

    async ensureFolderByName(userId: string, name: string): Promise<number> {
      await db
        .insert(schema.categories)
        .values({ userId, name })
        .onConflictDoNothing();
      const rows = await db
        .select()
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.userId, userId),
            eq(schema.categories.name, name),
          ),
        );
      const row = rows[0];
      if (!row) throw new AppError(500, "folder missing after upsert");
      return row.id;
    },
  };
}
