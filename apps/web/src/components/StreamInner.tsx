import { Box, Text } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { qk } from "../lib/keys";
import type { Entry, StreamDescriptor } from "../lib/types";
import type { StreamPresentation } from "../lib/ui-state";
import { CardsView } from "./CardsView";
import { EntryList } from "./EntryList";

export function StreamInner({
  stream,
  filter,
  sort,
  activeEntryId,
  onSelect,
  presentation,
  hidden = false,
}: {
  stream: StreamDescriptor;
  filter: "all" | "unread";
  sort: "asc" | "desc";
  activeEntryId: string | null;
  onSelect: (entry: Entry) => void;
  presentation: StreamPresentation;
  hidden?: boolean;
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastActiveId = useRef<string | null>(null);
  if (activeEntryId !== null) lastActiveId.current = activeEntryId;
  const selectEntry = useCallback(
    (entry: Entry) => {
      lastActiveId.current = entry.id;
      onSelect(entry);
    },
    [onSelect],
  );
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || hidden) return;
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
  }, [query.hasNextPage, query.isFetchingNextPage, query, hidden]);

  return (
    <Box
      ref={scrollRef}
      h="calc(100dvh - var(--app-shell-header-offset, 0rem))"
      pos={hidden ? "absolute" : undefined}
      top={hidden ? 0 : undefined}
      left={hidden ? 0 : undefined}
      right={hidden ? 0 : undefined}
      pb="env(safe-area-inset-bottom)"
      style={{
        visibility: hidden ? "hidden" : undefined,
        overflowY: "auto",
      }}
      data-stream-scroll
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      {presentation === "cards" ? (
        <CardsView
          entries={entries}
          loading={query.isPending}
          activeId={activeEntryId ?? lastActiveId.current}
          onSelect={selectEntry}
          scrollRef={scrollRef}
          visible={!hidden}
        />
      ) : (
        <EntryList
          entries={entries}
          loading={query.isPending}
          activeId={activeEntryId}
          onSelect={selectEntry}
          scrollRef={scrollRef}
        />
      )}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {!query.hasNextPage && entries.length > 0 && (
        <Text ta="center" c="dimmed" size="xs" py="md" ff="monospace">
          ∎ end of stream
        </Text>
      )}
    </Box>
  );
}
