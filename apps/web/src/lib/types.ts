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
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'folder'; id: string }
  | { kind: 'feed'; id: string };

export function streamParam(d: StreamDescriptor): string {
  switch (d.kind) {
    case 'all':
      return 'all';
    case 'starred':
      return 'starred';
    case 'feed':
      return `feed:${d.id}`;
    case 'folder':
      return `folder:${d.id}`;
  }
}
