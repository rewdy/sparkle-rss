import { Blockquote, Box, Group, Text } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactElement, RefObject } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { groupByDay, timeLabel } from "../lib/date-grouping";
import { useSubscriptionMap } from "../lib/feed-titles";
import type { Entry } from "../lib/types";
import { fonts } from "../themes";
import { EntryMeta } from "./EntryMeta";

type Row =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "entry"; key: string; entry: Entry };

const HEADER_HEIGHT = 30;
const ENTRY_HEIGHT = 68;
const OVERSCAN = 15;
const SKELETON_COUNT = 12;

export function EntryList({
  entries,
  loading,
  activeId,
  onSelect,
  scrollRef,
}: {
  entries: Entry[];
  loading: boolean;
  activeId: string | null;
  onSelect: (entry: Entry) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  // Date groups are flattened into a single virtualized row list:
  // [header, entry, entry, header, entry, ...]
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of groupByDay(entries)) {
      out.push({
        kind: "header",
        key: `h-${group.label}`,
        label: group.label,
        count: group.items.length,
      });
      for (const entry of group.items)
        out.push({ kind: "entry", key: entry.id, entry });
    }
    return out;
  }, [entries]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "header"
        ? HEADER_HEIGHT
        : rows[index]?.kind === "entry" && rows[index].entry.articleImage
          ? 96
          : ENTRY_HEIGHT,
    overscan: OVERSCAN,
    // Round up fractional text heights so adjacent rows never overlap.
    measureElement: (element) =>
      Math.ceil(element.getBoundingClientRect().height),
    // Positions of already-mounted rows are written to the DOM directly while
    // scrolling; React only re-renders when the visible range changes.
    directDomUpdates: true,
  });

  const rowRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) virtualizer.measureElement(node);
    },
    [virtualizer],
  );

  // j/k steps and deep links: keep the open entry visible in the list.
  useEffect(() => {
    if (activeId === null) return;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row?.kind === "entry" && row.key === activeId) {
        virtualizer.scrollToIndex(i, { align: "auto" });
        return;
      }
    }
  }, [activeId, rows, virtualizer]);

  if (loading) return <SkeletonList />;

  if (entries.length === 0) {
    return (
      <Text ta="center" c="dimmed" py="xl" size="sm">
        nothing here yet.
      </Text>
    );
  }

  return (
    <Box pb="xl">
      <div
        ref={virtualizer.containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          if (!row) return null;
          return (
            <div
              key={vi.key}
              ref={rowRef}
              data-index={vi.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {row.kind === "header" ? (
                <Group
                  gap="xs"
                  px="sm"
                  pt={vi.index === 0 ? "sm" : "xs"}
                  pb="xxs"
                >
                  <Text
                    size="xs"
                    tt="uppercase"
                    c="dimmed"
                    style={{ letterSpacing: 1.5 }}
                  >
                    {row.label}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {row.count}
                  </Text>
                </Group>
              ) : (
                <EntryRow
                  key={row.entry.id}
                  entry={row.entry}
                  active={row.entry.id === activeId}
                  onSelect={onSelect}
                />
              )}
            </div>
          );
        })}
      </div>
    </Box>
  );
}

function SkeletonList(): ReactElement {
  return (
    <Box>
      <span role="status" className="sr-only">
        Loading articles…
      </span>
      <Group gap="xs" px="sm" pt="sm" pb="xxs" aria-hidden="true">
        <Text component="span" size="xs" w={72} className="skeleton-line">
          &nbsp;
        </Text>
        <Text component="span" size="xs" w={20} className="skeleton-line">
          &nbsp;
        </Text>
      </Group>
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        // Static placeholder rows; index key is stable across renders.
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed skeleton scaffold
          key={i}
          className="skeleton-row feed-row"
          aria-hidden="true"
        >
          <div className="feed-row-text">
            <Group mb="xxs" className="skeleton-meta-slot">
              <div className="skeleton-line skeleton-line-meta" />
            </Group>
            <div className="skeleton-title-slot">
              <div className="skeleton-line skeleton-line-title" />
            </div>
          </div>
          <div className="feed-thumbnail skeleton-line" />
        </div>
      ))}
    </Box>
  );
}

export const EntryRow = memo(function EntryRow({
  entry,
  active,
  onSelect,
}: {
  entry: Entry;
  active: boolean;
  onSelect: (entry: Entry) => void;
}): ReactElement {
  const feedMeta = useSubscriptionMap();
  const sub = feedMeta.get(entry.feedId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image = entry.articleImage;
  const content = (
    <>
      <Group justify="space-between" wrap="nowrap" gap="xs" mb="xxs">
        <EntryMeta
          iconUrl={sub?.iconUrl}
          site={sub?.displayTitle ?? entry.siteName}
          author={entry.author}
          truncate={true}
          size="xs"
        />
        <Text size="xs" c="dimmed" ff="monospace">
          {timeLabel(entry.publishedAtMs)}
        </Text>
      </Group>
      <Text
        size="md"
        fw={entry.isRead ? 400 : 700}
        lh={1.4}
        style={{ fontFamily: fonts.sans }}
      >
        {entry.title}
      </Text>
      {/* Read-later items can carry a note; only shown when there is one, so
          ordinary feed rows keep their single-line shape. */}
      {entry.excerpt && (
        <Blockquote
          icon={null}
          color="gray"
          fz="xs"
          c="dimmed"
          px="xs"
          py={6}
          my="xxs"
          lh={1.35}
        >
          {entry.excerpt}
        </Blockquote>
      )}
    </>
  );
  return (
    <Box
      component="button"
      type="button"
      className="entry-row feed-row"
      data-active={active || undefined}
      data-entry-id={entry.id}
      onClick={() => onSelect(entry)}
      px="md"
      py="sm"
      style={{ cursor: "pointer" }}
    >
      <div className="feed-row-text">{content}</div>
      {image?.url && image.url !== failedUrl && (
        <img
          className="feed-thumbnail"
          src={image.url}
          alt=""
          width={96}
          height={72}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(image.url)}
        />
      )}
    </Box>
  );
});
