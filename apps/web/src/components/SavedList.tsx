import { Box, Button, Group, Loader, Text } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { dayGroup, timeLabel } from "../lib/date-grouping";
import { useMediaRefresh, useSavedLibrary } from "../lib/saved-queries";
import type { Entry, SavedItem } from "../lib/types";
import { EntryRow } from "./EntryList";

export function SavedRows({
  items,
  scrollRef,
  onSelectArticle,
  onSelectImage,
}: {
  items: SavedItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onSelectArticle: (entry: Entry) => void;
  onSelectImage: (id: string) => void;
}) {
  const rows = useMemo(() => {
    const out: Array<
      | { kind: "header"; label: string; key: string }
      | { kind: "item"; item: SavedItem; key: string }
    > = [];
    let previous = "";
    for (const item of items) {
      const label = dayGroup(item.savedAtMs);
      if (label !== previous) {
        out.push({ kind: "header", label, key: `h:${label}` });
        previous = label;
      }
      out.push({ kind: "item", item, key: `${item.kind}:${item.id}` });
    }
    return out;
  }, [items]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) =>
      rows[index]?.kind === "header"
        ? 30
        : rows[index]?.kind === "item" && rows[index]?.item.kind === "image"
          ? 170
          : 80,
    overscan: 15,
    directDomUpdates: true,
  });
  return (
    <div
      ref={virtualizer.containerRef}
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((virtual) => {
        const row = rows[virtual.index];
        if (!row) return null;
        return (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={virtual.index}
            style={{
              position: "absolute",
              width: "100%",
              top: 0,
              transform: `translateY(${virtual.start}px)`,
            }}
          >
            {row.kind === "header" ? (
              <Text px="md" py="xxs" size="xs" tt="uppercase" c="dimmed">
                {row.label}
              </Text>
            ) : row.item.kind === "article" ? (
              <EntryRow
                entry={{ ...row.item.entry, publishedAtMs: row.item.savedAtMs }}
                active={false}
                onSelect={() => {
                  if (row.item.kind === "article")
                    onSelectArticle(row.item.entry);
                }}
              />
            ) : (
              <button
                type="button"
                className="saved-image-row entry-row"
                onClick={() => onSelectImage(row.item.id)}
                aria-label={`view saved image: ${row.item.item.source.articleTitle}`}
              >
                <img
                  src={row.item.item.image.url}
                  alt={
                    row.item.item.image.alt ||
                    `Image from ${row.item.item.source.articleTitle}`
                  }
                  loading="lazy"
                  decoding="async"
                  width={row.item.item.image.width}
                  height={row.item.item.image.height}
                  style={{
                    width: 150,
                    height: 130,
                    objectFit: "contain",
                    flexShrink: 0,
                  }}
                />
                <span>
                  <Text component="span" size="xs" c="dimmed">
                    {row.item.item.source.feedTitle ||
                      row.item.item.source.siteName ||
                      new URL(row.item.item.imageSourceUrl).hostname}
                  </Text>
                  <Text fw={600}>{row.item.item.source.articleTitle}</Text>
                  <Text component="span" size="xs" c="dimmed">
                    {timeLabel(row.item.savedAtMs)}
                  </Text>
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SavedList({
  sort,
  hidden,
  onSelectArticle,
  onSelectImage,
}: {
  sort: "asc" | "desc";
  hidden: boolean;
  onSelectArticle: (entry: Entry) => void;
  onSelectImage: (id: string) => void;
}) {
  const query = useSavedLibrary(sort);
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const expiries = items.flatMap((item) =>
    item.kind === "image"
      ? [item.item.image.urlExpiresAtMs]
      : item.entry.articleImage
        ? [item.entry.articleImage.urlExpiresAtMs]
        : [],
  );
  useMediaRefresh(
    expiries.length ? Math.min(...expiries) : undefined,
    query.refetch,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || hidden) return;
    const observer = new IntersectionObserver(
      (rows) => {
        if (
          rows[0]?.isIntersecting &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        )
          void query.fetchNextPage();
      },
      { root: scrollRef.current, rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    hidden,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.fetchNextPage,
  ]);
  return (
    <Box
      ref={scrollRef}
      data-stream-scroll
      h="calc(100dvh - var(--app-shell-header-offset, 0rem))"
      style={{ overflowY: "auto", display: hidden ? "none" : undefined }}
    >
      {query.isPending ? (
        <Loader m="md" aria-label="loading saved items" />
      ) : query.isError ? (
        <Text p="md" role="alert">
          Could not load saved items.{" "}
          <Button onClick={() => void query.refetch()}>retry</Button>
        </Text>
      ) : items.length === 0 ? (
        <Text p="xl" ta="center" c="dimmed">
          nothing saved yet.
        </Text>
      ) : (
        <SavedRows
          items={items}
          scrollRef={scrollRef}
          onSelectArticle={onSelectArticle}
          onSelectImage={onSelectImage}
        />
      )}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {query.hasNextPage && (
        <Group justify="center" p="sm">
          <Button
            variant="subtle"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            load more
          </Button>
        </Group>
      )}
    </Box>
  );
}
