import { type StreamDescriptor, streamParam } from './types';

export const qk = {
  me: ['me'] as const,
  folders: ['folders'] as const,
  subscriptions: ['subscriptions'] as const,
  unreadCounts: ['unread-counts'] as const,
  settings: ['settings'] as const,
  tokens: ['api-tokens'] as const,
  entries: (stream: StreamDescriptor, filter: 'all' | 'unread', sort: 'asc' | 'desc') =>
    ['entries', streamKey(stream), { filter, sort }] as const,
};

export function streamKey(d: StreamDescriptor): string {
  return streamParam(d);
}

export function streamPath(d: StreamDescriptor): string {
  switch (d.kind) {
    case 'all':
      return '/all';
    case 'starred':
      return '/starred';
    case 'feed':
      return `/feed/${d.id}`;
    case 'folder':
      return `/folder/${d.id}`;
  }
}

export function parseStreamPath(pathname: string): StreamDescriptor | null {
  if (pathname === '/' || pathname === '/all') return { kind: 'all' };
  if (pathname === '/starred') return { kind: 'starred' };
  const feed = /^\/feed\/(\d+)$/.exec(pathname);
  const feedId = feed?.[1];
  if (feedId !== undefined) return { kind: 'feed', id: feedId };
  const folder = /^\/folder\/(\d+)$/.exec(pathname);
  const folderId = folder?.[1];
  if (folderId !== undefined) return { kind: 'folder', id: folderId };
  return null;
}
