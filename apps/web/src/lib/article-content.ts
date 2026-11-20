import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type {
  ContentProjection,
  Entry,
  EntryPage,
  SavedPage,
  Subscription,
} from "./types";

function guardContent(
  qc: QueryClient,
  feedId: string,
  content: ContentProjection,
): ContentProjection {
  const sub = qc
    .getQueryData<{ subscriptions: Subscription[] }>(["subscriptions"])
    ?.subscriptions.find((s) => s.feedId === feedId);
  return sub?.fetchFullArticles === false
    ? {
        ...content,
        contentHtml: content.originalContentHtml,
        fullContent: {
          ...content.fullContent,
          fetchEnabled: false,
          automaticFetchEligible: false,
        },
      }
    : content;
}

export function patchContentCaches(
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
      ? { ...item, ...guardContent(qc, item.feedId, content) }
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
export function useArticleContent(entry: Entry, subscriptionEnabled?: boolean) {
  const qc = useQueryClient();
  const id =
    entry.source === "url"
      ? null
      : entry.source === "entry"
        ? entry.entryId
        : entry.id;
  const urlEligible =
    !!id &&
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
    enabled: !!id && !!entry.fullContent,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const rawContent = query.data ?? (seed || undefined);
  const fetchEnabled =
    subscriptionEnabled !== false &&
    rawContent?.fullContent.fetchEnabled !== false;
  const content =
    rawContent && !fetchEnabled
      ? {
          ...rawContent,
          contentHtml: rawContent.originalContentHtml,
          fullContent: {
            ...rawContent.fullContent,
            fetchEnabled: false,
            automaticFetchEligible: false,
          },
        }
      : rawContent;
  const eligible =
    urlEligible &&
    fetchEnabled &&
    !!content?.fullContent.automaticFetchEligible;
  // A re-enabled subscription needs a fresh projection before considering a new attempt.
  const previousPreference = useRef(subscriptionEnabled);
  useEffect(() => {
    const previous = previousPreference.current;
    previousPreference.current = subscriptionEnabled;
    if (previous === false && subscriptionEnabled === true)
      void query.refetch();
  }, [subscriptionEnabled, query.refetch]);
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
    if (!fetchEnabled || content?.fullContent.status !== "pending" || !id)
      return;
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
  }, [
    fetchEnabled,
    content?.fullContent.status,
    id,
    pendingUntil,
    query.refetch,
  ]);
  useEffect(() => {
    if (!rawContent || !id) return;
    patchContentCaches(qc, id, rawContent);
  }, [rawContent, id, qc]);
  const mutation = useMutation({
    mutationKey: ["fetch-article-content", id],
    mutationFn: ({
      entryId,
      trigger,
    }: {
      entryId: string;
      feedId: string;
      trigger: "manual" | "automatic";
    }) => api.articleContent.fetch(entryId, trigger),
    onSuccess: (result, variables) => {
      const guarded = guardContent(qc, variables.feedId, result.content);
      qc.setQueryData(["article-content", variables.entryId], guarded);
      patchContentCaches(qc, variables.entryId, guarded);
    },
    retry: false,
  });
  const opened = useRef<string | null>(null);
  const startingAutomatically = !!(
    id &&
    eligible &&
    !query.isFetching &&
    opened.current !== id &&
    content?.fullContent.automaticFetchEligible &&
    content.fullContent.status !== "ready" &&
    content.fullContent.status !== "pending" &&
    (content.fullContent.automaticRetryAtMs ?? 0) <= Date.now()
  );
  useEffect(() => {
    if (!fetchEnabled) opened.current = null;
    if (!id || !eligible || query.isFetching || opened.current === id) return;
    opened.current = id;
    if (
      !content?.fullContent.automaticFetchEligible ||
      content.fullContent.status === "ready" ||
      content.fullContent.status === "pending" ||
      (content.fullContent.automaticRetryAtMs ?? 0) > Date.now()
    )
      return;
    void mutation
      .mutateAsync({ entryId: id, feedId: entry.feedId, trigger: "automatic" })
      .catch(() => undefined);
  }, [
    id,
    entry.feedId,
    eligible,
    fetchEnabled,
    query.isFetching,
    content,
    mutation.mutateAsync,
  ]);
  return {
    content,
    eligible,
    canRetry: retryAt <= Math.max(clock, Date.now()),
    pending:
      fetchEnabled &&
      (startingAutomatically ||
        (mutation.isPending && mutation.variables?.entryId === id) ||
        content?.fullContent.status === "pending"),
    error:
      mutation.error?.message ??
      (mutation.data && mutation.data.status >= 400
        ? mutation.data.message
        : null) ??
      content?.fullContent.error,
    fetch: () =>
      eligible &&
      id &&
      mutation.mutate({ entryId: id, feedId: entry.feedId, trigger: "manual" }),
  };
}
