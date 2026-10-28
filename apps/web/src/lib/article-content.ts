import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ContentProjection, Entry, EntryPage, SavedPage } from "./types";

function patchContentCaches(
  qc: QueryClient,
  id: string,
  content: ContentProjection,
) {
  const patch = (item: Entry): Entry =>
    (
      item.source === "entry"
        ? item.entryId === id
        : item.source !== "url" && item.id === id
    )
      ? { ...item, ...content }
      : item;
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
    { queryKey: ["entry", id] },
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
}

/** Patch only body fields: concurrent optimistic article flags remain authoritative. */
export function useArticleContent(entry: Entry) {
  const qc = useQueryClient();
  const id =
    entry.source === "url"
      ? null
      : entry.source === "entry"
        ? entry.entryId
        : entry.id;
  const eligible =
    !!id &&
    !!entry.fullContent?.automaticFetchEligible &&
    /^https?:\/\//i.test(entry.url) &&
    !(() => {
      try {
        const url = new URL(entry.url);
        return !!(url.username || url.password);
      } catch {
        return true;
      }
    })();
  const key = ["article-content", id] as const;
  const seed = entry.fullContent && {
    contentHtml: entry.contentHtml,
    originalContentHtml: entry.originalContentHtml ?? entry.contentHtml,
    fullContent: entry.fullContent,
  };
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<ContentProjection> => {
      const { entry: fresh } = await api.entries.get(String(id));
      if (!fresh.fullContent) throw new Error("Content status unavailable");
      return {
        contentHtml: fresh.contentHtml,
        originalContentHtml: fresh.originalContentHtml ?? fresh.contentHtml,
        fullContent: fresh.fullContent,
      };
    },
    initialData: seed || undefined,
    enabled: false,
    retry: false,
  });
  const content = query.data ?? (seed || undefined);
  const [clock, setClock] = useState(Date.now);
  const retryAt = content?.fullContent.retryAtMs ?? 0;
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      retryAt - Date.now() + 10,
    );
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  const pendingUntil = content?.fullContent.pendingUntilMs ?? 0;
  useEffect(() => {
    if (content?.fullContent.status !== "pending" || !id) return;
    const until = pendingUntil;
    let stopped = false;
    const timer = window.setInterval(() => {
      if (stopped) return;
      if (Date.now() >= until) {
        stopped = true;
        void query.refetch();
        return;
      }
      void query.refetch();
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [content?.fullContent.status, id, pendingUntil, query.refetch]);
  useEffect(() => {
    if (!content || !id) return;
    patchContentCaches(qc, id, content);
  }, [content, id, qc]);
  const mutation = useMutation({
    mutationKey: ["fetch-article-content", id],
    mutationFn: ({
      entryId,
      trigger,
    }: {
      entryId: string;
      trigger: "manual" | "automatic";
    }) => api.articleContent.fetch(entryId, trigger),
    onSuccess: (result, variables) => {
      qc.setQueryData(["article-content", variables.entryId], result.content);
      patchContentCaches(qc, variables.entryId, result.content);
    },
    retry: false,
  });
  const opened = useRef<string | null>(null);
  const startingAutomatically = !!(
    id &&
    eligible &&
    opened.current !== id &&
    content?.fullContent.automaticFetchEligible &&
    content.fullContent.status !== "ready" &&
    content.fullContent.status !== "pending" &&
    (content.fullContent.automaticRetryAtMs ?? 0) <= Date.now()
  );
  useEffect(() => {
    if (!id || !eligible || opened.current === id) return;
    opened.current = id;
    if (
      !content?.fullContent.automaticFetchEligible ||
      content.fullContent.status === "ready" ||
      content.fullContent.status === "pending" ||
      (content.fullContent.automaticRetryAtMs ?? 0) > Date.now()
    )
      return;
    void mutation
      .mutateAsync({ entryId: id, trigger: "automatic" })
      .catch(() => undefined);
  }, [id, eligible, content, mutation.mutateAsync]);
  return {
    content,
    eligible,
    canRetry: retryAt <= Math.max(clock, Date.now()),
    pending:
      startingAutomatically ||
      (mutation.isPending && mutation.variables?.entryId === id) ||
      content?.fullContent.status === "pending",
    error:
      mutation.error?.message ??
      (mutation.data && mutation.data.status >= 400
        ? mutation.data.message
        : null) ??
      content?.fullContent.error,
    fetch: () =>
      eligible && id && mutation.mutate({ entryId: id, trigger: "manual" }),
  };
}
