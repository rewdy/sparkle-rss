import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import { qk } from "./keys";
import type {
  ContentProjection,
  Entry,
  EntryPage,
  EntryStreamDescriptor,
  ImageSource,
  SavedPage,
  Subscription,
} from "./types";

/**
 * Read-state toggle, optimistically applied across entry caches. Saved
 * read-later items are addressed by their own uuid and go through the
 * read-later endpoint instead.
 */
function useReadStateMutation(readLater: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, read }: { ids: string[]; read: boolean }) =>
      readLater
        ? api.readLater.setRead(ids, read)
        : api.entries.setRead(ids, read),
    onMutate: async ({ ids, read }) => {
      await qc.cancelQueries({ queryKey: ["entries"] });
      const idSet = new Set(ids);
      // Snapshot the affected caches so we can restore on failure.
      const entriesSnapshot = qc.getQueriesData<{
        pages: Array<{ items: Entry[] }>;
      }>({
        queryKey: ["entries"],
      });
      const entrySnapshots = ids.map(
        (id) => [qk.entry(id), qc.getQueryData(qk.entry(id))] as const,
      );

      // optimistic: flip flags in every cached entries page
      qc.setQueriesData<{
        pages: Array<{ items: Array<{ id: string; isRead: boolean }> }>;
      }>(
        { queryKey: ["entries"] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((e) =>
                idSet.has(e.id) ? { ...e, isRead: read } : e,
              ),
            })),
          },
      );
      // and in any single-entry cache (deep links)
      for (const id of ids) {
        qc.setQueryData<{ entry: { id: string; isRead: boolean } }>(
          ["entry", id],
          (data) =>
            data ? { ...data, entry: { ...data.entry, isRead: read } } : data,
        );
      }
      return { entries: entriesSnapshot, entrySnapshots };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.entries) qc.setQueryData(key, data);
      for (const [key, data] of context.entrySnapshots)
        qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["saved"] });
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
      if (readLater) void qc.invalidateQueries({ queryKey: readLaterKey });
    },
  });
}

export function useMarkRead() {
  return useReadStateMutation(false);
}

export function useMarkReadLater() {
  return useReadStateMutation(true);
}

export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, starred }: { ids: string[]; starred: boolean }) =>
      api.entries.setStarred(ids, starred),
    onMutate: async ({ ids, starred }) => {
      await qc.cancelQueries({ queryKey: ["entries"] });
      const idSet = new Set(ids);
      const entriesSnapshot = qc.getQueriesData<{
        pages: Array<{ items: Entry[] }>;
      }>({
        queryKey: ["entries"],
      });
      const entrySnapshots = ids.map(
        (id) => [qk.entry(id), qc.getQueryData(qk.entry(id))] as const,
      );
      qc.setQueriesData<{
        pages: Array<{ items: Array<{ id: string; isStarred: boolean }> }>;
      }>(
        { queryKey: ["entries"] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((e) =>
                idSet.has(e.id) ? { ...e, isStarred: starred } : e,
              ),
            })),
          },
      );
      for (const id of ids) {
        qc.setQueryData<{ entry: { id: string; isStarred: boolean } }>(
          ["entry", id],
          (data) =>
            data
              ? { ...data, entry: { ...data.entry, isStarred: starred } }
              : data,
        );
      }
      return { entries: entriesSnapshot, entrySnapshots };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.entries) qc.setQueryData(key, data);
      for (const [key, data] of context.entrySnapshots)
        qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["saved"] });
      void qc.invalidateQueries({
        queryKey: qk.entries({ kind: "starred" }, "all", "desc"),
      });
    },
  });
}

export function useSaveImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { source: ImageSource; imageUrl: string }) =>
      api.savedImages.save(input),
    onSuccess: (data, input) => {
      qc.setQueryData(qk.savedImage(data.item.id), data);
      void qc.invalidateQueries({ queryKey: qk.sourceImages(input.source) });
      void qc.invalidateQueries({ queryKey: ["saved"] });
    },
  });
}

export function useRemoveImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.savedImages.remove(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: qk.savedImage(id) });
      void qc.invalidateQueries({ queryKey: ["source-images"] });
      void qc.invalidateQueries({ queryKey: ["saved"] });
    },
  });
}

export function useMarkAllRead(stream: EntryStreamDescriptor) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (olderThan?: Date) =>
      api.entries.markAllRead(stream, olderThan),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["entries"] });
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
    },
  });
}

export function useSubscriptionEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      feedId,
      changes,
    }: {
      feedId: string;
      changes: {
        title?: string | null;
        folderId?: number | null;
        fetchFullArticles?: boolean;
      };
    }) => api.subscriptions.edit(feedId, changes),
    onSuccess: ({ subscription }, { changes }) => {
      qc.setQueryData<{ subscriptions: Subscription[] }>(
        qk.subscriptions,
        (data) =>
          data && {
            ...data,
            subscriptions: data.subscriptions.map((sub) =>
              sub.feedId === subscription.feedId ? subscription : sub,
            ),
          },
      );
      if (changes.fetchFullArticles === undefined) return;
      const ids = new Set<string>();
      const patch = (item: Entry): Entry => {
        if (item.source === "url" || item.feedId !== subscription.feedId)
          return item;
        const id = item.source === "entry" ? item.entryId : item.id;
        if (id) ids.add(id);
        if (subscription.fetchFullArticles || !item.fullContent) return item;
        return {
          ...item,
          contentHtml: item.originalContentHtml ?? item.contentHtml,
          fullContent: {
            ...item.fullContent,
            fetchEnabled: false,
            automaticFetchEligible: false,
          },
        };
      };
      qc.setQueriesData<{ pages: EntryPage[] }>(
        { queryKey: ["entries"] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map(patch),
            })),
          },
      );
      qc.setQueriesData<{ entry: Entry }>(
        { queryKey: ["entry"] },
        (data) => data && { ...data, entry: patch(data.entry) },
      );
      qc.setQueriesData<{ pages: SavedPage[] }>(
        { queryKey: ["saved"] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.kind === "article"
                  ? { ...item, entry: patch(item.entry) }
                  : item,
              ),
            })),
          },
      );
      if (!subscription.fetchFullArticles)
        for (const id of ids) {
          qc.setQueryData<ContentProjection>(
            ["article-content", id],
            (content) =>
              content && {
                ...content,
                contentHtml: content.originalContentHtml,
                fullContent: {
                  ...content.fullContent,
                  fetchEnabled: false,
                  automaticFetchEligible: false,
                },
              },
          );
        }
      for (const prefix of ["entries", "entry", "saved", "article-content"]) {
        void qc.invalidateQueries({ queryKey: [prefix] });
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
      void qc.invalidateQueries({ queryKey: qk.folders });
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
    },
  });
}

export function useFolderCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.folders.create(name),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.folders });
    },
  });
}

export function useFolderRename() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.folders.rename(id, name),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.folders });
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
  });
}

export function useFolderRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.folders.remove(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.folders });
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
      void qc.invalidateQueries({ queryKey: qk.unreadCounts });
    },
  });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      url,
      folderId,
      title,
    }: {
      url: string;
      folderId?: number | null;
      title?: string;
    }) =>
      api.subscriptions.subscribe(url, { folderId: folderId ?? null, title }),
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
      void qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}

/** Every cached read-later page, whatever filter/sort key it was stored under. */
const readLaterKey = ["entries", "read-later"] as const;

function invalidateReadLater(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: readLaterKey });
  void qc.invalidateQueries({ queryKey: qk.readLaterCount });
}

/** Saves an off-feed article by URL; the server fetches a readable copy. */
export function useSaveReadLaterUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; title?: string; excerpt?: string }) =>
      api.readLater.saveUrl(input),
    onSettled: () => invalidateReadLater(qc),
  });
}

/** Adds or removes feed entries from the read-later queue, optimistically. */
export function useToggleReadLater() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, save }: { ids: string[]; save: boolean }) =>
      api.readLater.saveEntries(ids, save),
    onMutate: async ({ ids, save }) => {
      await qc.cancelQueries({ queryKey: ["entries"] });
      const idSet = new Set(ids);
      const entriesSnapshot = qc.getQueriesData<{
        pages: Array<{ items: Entry[] }>;
      }>({ queryKey: ["entries"] });
      const entrySnapshots = ids.map(
        (id) => [qk.entry(id), qc.getQueryData(qk.entry(id))] as const,
      );

      qc.setQueriesData<{
        pages: Array<{ items: Array<{ id: string; isReadLater: boolean }> }>;
      }>({ queryKey: ["entries"] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.map((e) =>
                  idSet.has(e.id) ? { ...e, isReadLater: save } : e,
                ),
              })),
            }
          : data,
      );
      for (const id of ids) {
        qc.setQueryData<{ entry: { id: string; isReadLater: boolean } }>(
          qk.entry(id),
          (data) =>
            data
              ? { ...data, entry: { ...data.entry, isReadLater: save } }
              : data,
        );
      }
      return { entries: entriesSnapshot, entrySnapshots };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.entries) qc.setQueryData(key, data);
      for (const [key, data] of context.entrySnapshots)
        qc.setQueryData(key, data);
    },
    onSettled: () => invalidateReadLater(qc),
  });
}

/** Drops saved items (their own uuid ids) out of the read-later queue. */
export function useRemoveReadLater() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) => api.readLater.remove(itemIds),
    onMutate: async (itemIds) => {
      await qc.cancelQueries({ queryKey: readLaterKey });
      const itemSet = new Set(itemIds);
      const snapshot = qc.getQueriesData<{
        pages: Array<{ items: Entry[] }>;
      }>({ queryKey: readLaterKey });

      // Infinite pages are immutable shapes: re-derive each page's items, and
      // drop pages that empty out so the virtual list does not show gaps.
      qc.setQueriesData<{ pages: Array<{ items: Entry[] }> }>(
        { queryKey: readLaterKey },
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages
                  .map((p) => ({
                    ...p,
                    items: p.items.filter((e) => !itemSet.has(e.id)),
                  }))
                  .filter(
                    (p, index) =>
                      p.items.length > 0 || index === data.pages.length - 1,
                  ),
              }
            : data,
      );
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.snapshot) qc.setQueryData(key, data);
    },
    onSettled: () => invalidateReadLater(qc),
  });
}
