export type ReadLaterSource = "entry" | "url";
export type ReadLaterStatus = "pending" | "ready" | "error";

export interface Entry {
  id: string;
  feedId: string;
  title: string;
  url: string;
  author: string;
  contentHtml: string;
  publishedAtMs: number;
  crawledAtMs: number;
  enclosures: Array<{ href?: string; type?: string; length?: number }>;
  isRead: boolean;
  isStarred: boolean;
  isReadLater: boolean;
  articleImage: {
    id: string;
    width: number;
    height: number;
    alt: string;
    url: string;
    urlExpiresAtMs: number;
  } | null;
  /**
   * Read-later list payloads carry where the item came from: the source entry
   * when it was saved from a feed, or nothing for a one-off saved URL.
   */
  entryId?: string | null;
  source?: ReadLaterSource;
  siteName?: string;
  /**
   * The note (or the page's own excerpt) on a read-later item. Only present in
   * read-later list payloads, so it is undefined for ordinary feed entries.
   */
  excerpt?: string;
  status?: ReadLaterStatus;
  savedAtMs?: number;
}

export interface EntryPage {
  items: Entry[];
  nextCursor: string | null;
}

export interface Folder {
  id: string;
  name: string;
  feedCount: number;
  unreadCount: number;
}

export interface Subscription {
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

export interface UnreadCounts {
  total: number;
  feeds: Array<{ feedId: string; count: number; newestMs: number | null }>;
  folders: Array<{ folderId: string; count: number }>;
}

export interface Me {
  userId: string;
  username: string;
  email: string;
}

export type StreamDescriptor =
  | { kind: "all" }
  | { kind: "starred" }
  | { kind: "readLater" }
  | { kind: "today" }
  | { kind: "unread" }
  | { kind: "folder"; id: string }
  | { kind: "feed"; id: string };

/** Streams that are backed by the entry listing API. */
export type EntryStreamDescriptor = Exclude<
  StreamDescriptor,
  { kind: "readLater" }
>;

export function isEntryStream(d: StreamDescriptor): d is EntryStreamDescriptor {
  return d.kind !== "readLater";
}

/** 'today' and 'unread' are the API stream 'all' plus extra query params. */
export function streamParam(d: EntryStreamDescriptor): string {
  switch (d.kind) {
    case "all":
      return "all";
    case "today":
      return "all";
    case "unread":
      return "all";
    case "starred":
      return "starred";
    case "feed":
      return `feed:${d.id}`;
    case "folder":
      return `folder:${d.id}`;
  }
}
