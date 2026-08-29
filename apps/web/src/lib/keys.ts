import type { StreamDescriptor } from "./types";

export const qk = {
  me: ["me"] as const,
  folders: ["folders"] as const,
  subscriptions: ["subscriptions"] as const,
  unreadCounts: ["unread-counts"] as const,
  settings: ["settings"] as const,
  tokens: ["api-tokens"] as const,
  entries: (
    stream: StreamDescriptor,
    filter: "all" | "unread",
    sort: "asc" | "desc",
  ) => ["entries", streamKey(stream), { filter, sort }] as const,
  entry: (id: string) => ["entry", id] as const,
};

/** Local calendar date as YYYY-MM-DD; rolls over at midnight. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO timestamp for local midnight (start of "today" for the pubFrom filter). */
export function localMidnightIso(now: Date = new Date()): string {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();
}

/** Distinct per kind so 'today'/'unread' never share cache with 'all'. */
export function streamKey(d: StreamDescriptor): string {
  switch (d.kind) {
    case "feed":
      return `feed:${d.id}`;
    case "folder":
      return `folder:${d.id}`;
    case "today":
      return `today:${localDateKey()}`;
    case "all":
      return "all";
    case "starred":
      return "starred";
    case "unread":
      return "unread";
  }
}

export function streamPath(d: StreamDescriptor): string {
  switch (d.kind) {
    case "all":
      return "/all";
    case "starred":
      return "/starred";
    case "today":
      return "/today";
    case "unread":
      return "/unread";
    case "feed":
      return `/feed/${d.id}`;
    case "folder":
      return `/folder/${d.id}`;
  }
}

/** Read the `filter`/`sort` view prefs from the URL search string. */
export function filterFromSearch(search: string): "all" | "unread" {
  return new URLSearchParams(search).get("filter") === "unread"
    ? "unread"
    : "all";
}
export function sortFromSearch(search: string): "asc" | "desc" {
  return new URLSearchParams(search).get("sort") === "asc" ? "asc" : "desc";
}

/** Serialize view params into a query string for a stream (or reader) URL. */
export function viewSearch(
  filter: "all" | "unread",
  sort: "asc" | "desc",
): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (sort !== "desc") params.set("sort", sort);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export interface RouteInfo {
  stream: StreamDescriptor;
  entryId: string | null;
}

const ENTRY_SUFFIX = /\/e\/([^/]+)$/;

/**
 * Parse a location into stream + optional open entry.
 * Handles entry routes like /all/e/123, /feed/5/e/123.
 * Returns null for /settings and unknown paths.
 */
export function parseRoute(pathname: string): RouteInfo | null {
  const suffix = ENTRY_SUFFIX.exec(pathname);
  const base = suffix
    ? pathname.slice(0, pathname.length - suffix[0].length)
    : pathname;
  const entryId = suffix?.[1] ?? null;
  if (base === "/" || base === "/all")
    return { stream: { kind: "all" }, entryId };
  if (base === "/starred") return { stream: { kind: "starred" }, entryId };
  if (base === "/today") return { stream: { kind: "today" }, entryId };
  if (base === "/unread") return { stream: { kind: "unread" }, entryId };
  const feed = /^\/feed\/(\d+)$/.exec(base);
  const feedId = feed?.[1];
  if (feedId !== undefined)
    return { stream: { kind: "feed", id: feedId }, entryId };
  const folder = /^\/folder\/(\d+)$/.exec(base);
  const folderId = folder?.[1];
  if (folderId !== undefined)
    return { stream: { kind: "folder", id: folderId }, entryId };
  return null;
}
