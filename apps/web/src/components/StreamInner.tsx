import { Box, Text } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { qk, streamPath, viewSearch } from "../lib/keys";
import type { Entry, StreamDescriptor, Subscription } from "../lib/types";
import { EntryList } from "./EntryList";
import { StoryView } from "./StoryView";

export function StreamInner({
  stream,
  filter,
  sort,
  activeEntryId,
  storyIndex,
  onStoryIndexChange,
  onSelect,
  presentation,
  subscriptions,
}: {
  stream: StreamDescriptor;
  filter: "all" | "unread";
  sort: "asc" | "desc";
  activeEntryId: string | null;
  storyIndex: number;
  onStoryIndexChange: (index: number) => void;
  onSelect: (entry: Entry) => void;
  presentation: "list" | "swipe";
  subscriptions: Subscription[];
}): ReactElement {
  const query = useInfiniteQuery({
    queryKey: qk.entries(stream, filter, sort),
    queryFn: ({ pageParam }) =>
      api.entries.list(stream, {
        filter,
        sort,
        limit: 50,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    // Media URLs expire after five minutes. Remove inactive entry pages before
    // that point, and the expiry-aware timer below refreshes active pages.
    gcTime: 240_000,
  });

  const entries = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const earliestMediaExpiryMs = useMemo(() => {
    let earliest: number | null = null;
    for (const entry of entries) {
      const expiresAt = entry.articleImage?.urlExpiresAtMs;
      if (
        expiresAt !== undefined &&
        (earliest === null || expiresAt < earliest)
      )
        earliest = expiresAt;
    }
    return earliest;
  }, [entries]);

  useEffect(() => {
    if (earliestMediaExpiryMs === null) return;
    const refreshLeadMs = 30_000;
    const delay = Math.max(
      1_000,
      earliestMediaExpiryMs - Date.now() - refreshLeadMs,
    );
    const timer = window.setTimeout(() => {
      void query.refetch();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [earliestMediaExpiryMs, query.refetch]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (observed) => {
        if (
          observed[0]?.isIntersecting &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        ) {
          void query.fetchNextPage();
        }
      },
      // Root is the scroll container (not the viewport): the list is a nested
      // scroller, and with virtualized content the sentinel sits at the end of
      // a tall virtual box.
      { root: scrollRef.current, rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query]);

  useEffect(() => {
    if (
      presentation === "swipe" &&
      storyIndex >= entries.length &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      void fetchNextPage();
    }
  }, [
    entries.length,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    presentation,
    storyIndex,
  ]);

  const handleStoryIndexChange = useCallback(
    (index: number) => {
      onStoryIndexChange(index);
      if (index >= entries.length - 5 && hasNextPage && !isFetchingNextPage)
        void fetchNextPage();
    },
    [
      entries.length,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      onStoryIndexChange,
    ],
  );

  return (
    <Box
      ref={scrollRef}
      h="calc(100dvh - var(--app-shell-header-offset, 0rem))"
      style={{
        overflowY: presentation === "swipe" ? "hidden" : "auto",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      data-stream-scroll
    >
      {presentation === "swipe" ? (
        <StoryView
          entries={entries}
          subscriptions={subscriptions}
          loading={query.isPending}
          onRead={onSelect}
          readHref={(entry) =>
            `${streamPath(stream)}/e/${entry.id}${viewSearch(filter, sort)}`
          }
          activeIndex={storyIndex}
          onActiveIndexChange={handleStoryIndexChange}
        />
      ) : (
        <EntryList
          entries={entries}
          loading={query.isPending}
          activeId={activeEntryId}
          onSelect={onSelect}
          scrollRef={scrollRef}
        />
      )}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {presentation === "list" && !query.hasNextPage && entries.length > 0 && (
        <Text ta="center" c="dimmed" size="xs" py="md" ff="monospace">
          ∎ end of stream
        </Text>
      )}
    </Box>
  );
}
