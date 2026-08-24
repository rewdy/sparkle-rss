import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { qk } from './keys';
import type { StreamDescriptor } from './types';

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, read }: { ids: string[]; read: boolean }) => api.entries.setRead(ids, read),
    onMutate: async ({ ids, read }) => {
      // optimistic: flip flags in every cached entries page
      const idSet = new Set(ids);
      qc.setQueriesData<{ pages: Array<{ items: Array<{ id: string; isRead: boolean }> }> }>(
        { queryKey: ['entries'] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((e) => (idSet.has(e.id) ? { ...e, isRead: read } : e)),
            })),
          },
      );
      // and in any single-entry cache (deep links)
      for (const id of ids) {
        qc.setQueryData<{ entry: { id: string; isRead: boolean } }>(['entry', id], (data) =>
          data ? { ...data, entry: { ...data.entry, isRead: read } } : data,
        );
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
    },
  });
}

export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, starred }: { ids: string[]; starred: boolean }) =>
      api.entries.setStarred(ids, starred),
    onMutate: async ({ ids, starred }) => {
      const idSet = new Set(ids);
      qc.setQueriesData<{ pages: Array<{ items: Array<{ id: string; isStarred: boolean }> }> }>(
        { queryKey: ['entries'] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((e) => (idSet.has(e.id) ? { ...e, isStarred: starred } : e)),
            })),
          },
      );
      for (const id of ids) {
        qc.setQueryData<{ entry: { id: string; isStarred: boolean } }>(['entry', id], (data) =>
          data ? { ...data, entry: { ...data.entry, isStarred: starred } } : data,
        );
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.entries({ kind: 'starred' }, 'all', 'desc') });
    },
  });
}

export function useMarkAllRead(stream: StreamDescriptor) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (olderThan?: Date) => api.entries.markAllRead(stream, olderThan),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['entries'] });
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
    },
  });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ url, folderId }: { url: string; folderId?: number | null }) =>
      api.subscriptions.subscribe(url, { folderId: folderId ?? null }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
      void qc.invalidateQueries({ queryKey: qk.folders });
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
    },
  });
}

export function useUnsubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedId: string) => api.subscriptions.unsubscribe(feedId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
      void qc.invalidateQueries({ queryKey: qk.folders });
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
      void qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}
