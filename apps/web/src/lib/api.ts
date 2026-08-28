import { accessToken, devAuthBypassed, renewToken } from './auth';
import { localMidnightIso } from './keys';
import type {
  Entry,
  EntryPage,
  Folder,
  Me,
  StreamDescriptor,
  Subscription,
  UnreadCounts,
} from './types';
import { streamParam } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Shared fetch core: attaches auth, retries once on 401 after a silent renew. */
async function authedFetch(path: string, init?: RequestInit, json?: boolean): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(path, {
      ...init,
      headers: {
        ...(json ? { Accept: 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(devAuthBypassed ? { 'X-Dev-User': 'dev-user' } : {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });

  let res = await doFetch(await accessToken());
  if (res.status === 401) {
    // Credentials were rejected server-side: renew once and retry.
    res = await doFetch(await renewToken());
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(path, init, true);
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function raw(path: string, init?: RequestInit): Promise<Response> {
  return authedFetch(path, init, false);
}

export const api = {
  me: (): Promise<Me> => request('/api/v1/me'),
  folders: {
    list: (): Promise<{ folders: Folder[] }> => request('/api/v1/folders'),
    create: (name: string): Promise<{ folder: Folder }> =>
      request('/api/v1/folders', { method: 'POST', body: JSON.stringify({ name }) }),
    rename: (id: string, name: string): Promise<void> =>
      raw(`/api/v1/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }).then(
        assertNoContent,
      ),
    remove: (id: string): Promise<void> =>
      raw(`/api/v1/folders/${id}`, { method: 'DELETE' }).then(assertNoContent),
  },
  subscriptions: {
    list: (): Promise<{ subscriptions: Subscription[] }> => request('/api/v1/subscriptions'),
    subscribe: (
      url: string,
      opts: { title?: string; folderId?: number | null } = {},
    ): Promise<{ subscription: Subscription }> =>
      request('/api/v1/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ url, ...opts }),
      }),
    edit: (
      feedId: string,
      changes: { title?: string | null; folderId?: number | null },
    ): Promise<{ subscription: Subscription }> =>
      request(`/api/v1/subscriptions/${feedId}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      }),
    unsubscribe: (feedId: string): Promise<void> =>
      raw(`/api/v1/subscriptions/${feedId}`, { method: 'DELETE' }).then(assertNoContent),
  },
  entries: {
    list: (
      stream: StreamDescriptor,
      opts: {
        filter?: 'all' | 'unread';
        sort?: 'asc' | 'desc';
        limit?: number;
        cursor?: string;
      } = {},
    ): Promise<EntryPage> => {
      const q = new URLSearchParams({
        stream: streamParam(stream),
        // 'unread' stream implies the unread filter; 'today' adds the pubFrom bound
        filter: stream.kind === 'unread' ? 'unread' : (opts.filter ?? 'all'),
        sort: opts.sort ?? 'desc',
        limit: String(opts.limit ?? 50),
      });
      if (stream.kind === 'today') q.set('pubFrom', localMidnightIso());
      if (opts.cursor) q.set('cursor', opts.cursor);
      return request(`/api/v1/entries?${q.toString()}`);
    },
    get: (id: string): Promise<{ entry: Entry }> => request(`/api/v1/entries/${id}`),
    setRead: (ids: string[], read: boolean): Promise<{ updated: number }> =>
      request('/api/v1/entries/read', {
        method: 'PATCH',
        body: JSON.stringify({ ids: ids.map(Number), read }),
      }),
    setStarred: (ids: string[], starred: boolean): Promise<{ updated: number }> =>
      request('/api/v1/entries/starred', {
        method: 'PATCH',
        body: JSON.stringify({ ids: ids.map(Number), starred }),
      }),
    markAllRead: (stream: StreamDescriptor, olderThan?: Date): Promise<{ updated: number }> =>
      request('/api/v1/entries/mark-all-read', {
        method: 'POST',
        body: JSON.stringify({
          stream: streamParam(stream),
          olderThan: (olderThan ?? new Date()).toISOString(),
        }),
      }),
  },
  unreadCounts: (): Promise<UnreadCounts> => request('/api/v1/unread-counts'),
  settings: {
    get: (): Promise<{ data: Record<string, unknown> }> => request('/api/v1/settings'),
    put: (data: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> =>
      request('/api/v1/settings', { method: 'PUT', body: JSON.stringify({ data }) }),
  },
  tokens: {
    list: () =>
      request('/api/v1/me/api-tokens') as Promise<{
        tokens: Array<{ id: string; label: string; createdAtMs: number }>;
      }>,
    mint: (label: string): Promise<{ record: { id: string }; token: string }> =>
      request('/api/v1/me/api-tokens', { method: 'POST', body: JSON.stringify({ label }) }),
    revoke: (id: string): Promise<void> =>
      raw(`/api/v1/me/api-tokens/${id}`, { method: 'DELETE' }).then(assertNoContent),
  },
  opml: {
    exportBlob: async (): Promise<Blob> => {
      const res = await raw('/api/v1/opml/export');
      return res.blob();
    },
    importText: async (
      xml: string,
    ): Promise<{
      found: number;
      imported: number;
      errors: Array<{ url: string; error: string }>;
    }> => {
      const res = await raw('/api/v1/opml/import', { method: 'POST', body: xml });
      if (!res.ok) throw new ApiError(res.status, 'import failed');
      return (await res.json()) as never;
    },
  },
};

function assertNoContent(res: Response): void {
  if (!res.ok && res.status !== 204) throw new ApiError(res.status, res.statusText);
}
