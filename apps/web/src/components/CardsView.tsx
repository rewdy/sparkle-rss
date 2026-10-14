import { Blockquote, Box, Group, Text, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent, ReactElement, RefObject } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LuNewspaper } from "react-icons/lu";
import { groupByDay, timeLabel } from "../lib/date-grouping";
import { useSubscriptionMap } from "../lib/feed-titles";
import type { Entry } from "../lib/types";
import { fonts } from "../themes";
import { EntryMeta } from "./EntryMeta";

export type CardRow =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "cards"; key: string; entries: Entry[] };

export function buildCardRows(entries: Entry[], columns: number): CardRow[] {
  const rows: CardRow[] = [];
  for (const group of groupByDay(entries)) {
    const first = group.items[0];
    if (!first) continue;
    rows.push({
      kind: "header",
      key: `header-${first.id}`,
      label: group.label,
      count: group.items.length,
    });
    for (let i = 0; i < group.items.length; i += columns) {
      const items = group.items.slice(i, i + columns);
      rows.push({
        kind: "cards",
        key: `cards-${items[0]?.id}`,
        entries: items,
      });
    }
  }
  return rows;
}

export const ArticleCard = memo(function ArticleCard({
  entry,
  active,
  onSelect,
}: {
  entry: Entry;
  active: boolean;
  onSelect: (entry: Entry) => void;
}): ReactElement {
  const sub = useSubscriptionMap().get(entry.feedId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image = entry.articleImage;
  return (
    <button
      type="button"
      className="article-card"
      data-entry-id={entry.id}
      data-active={active || undefined}
      onClick={() => onSelect(entry)}
    >
      <div className="card-media" aria-hidden="true">
        {image?.url && image.url !== failedUrl ? (
          <img
            src={image.url}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailedUrl(image.url)}
          />
        ) : (
          <div className="card-placeholder">
            <LuNewspaper size={28} />
          </div>
        )}
      </div>
      <div className="card-text">
        <EntryMeta
          iconUrl={sub?.iconUrl}
          site={sub?.displayTitle ?? entry.siteName}
          author={entry.author}
          truncate
          size="xs"
        />
        <Text
          size="md"
          fw={entry.isRead ? 400 : 700}
          lh={1.4}
          mt="xs"
          style={{ fontFamily: fonts.sans }}
        >
          {entry.title}
        </Text>
        {entry.excerpt && (
          <Blockquote
            icon={null}
            color="gray"
            fz="xs"
            c="dimmed"
            px="xs"
            py={6}
            my="xs"
            lh={1.35}
          >
            {entry.excerpt}
          </Blockquote>
        )}
        <Text size="xs" c="dimmed" ff="monospace" mt="sm">
          {timeLabel(entry.publishedAtMs)}
        </Text>
      </div>
    </button>
  );
});

export function CardsView({
  entries,
  loading,
  activeId,
  onSelect,
  scrollRef,
  visible = true,
}: {
  entries: Entry[];
  loading: boolean;
  activeId: string | null;
  onSelect: (entry: Entry) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  visible?: boolean;
}): ReactElement {
  const theme = useMantineTheme();
  const sm = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
  const md = useMediaQuery(`(min-width: ${theme.breakpoints.md})`);
  const columns = md ? 3 : sm ? 2 : 1;
  const rows = useMemo(
    () => buildCardRows(entries, columns),
    [entries, columns],
  );
  const entryRows = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.kind === "cards")
        for (const entry of row.entries) map.set(entry.id, index);
    });
    return map;
  }, [rows]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const focusedRow = entryRows.get(pendingFocus ?? focusedId ?? "");
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const previousColumns = useRef(columns);
  const previousWidth = useRef(0);
  const restoredId = useRef<string | null>(null);
  const [width, setWidth] = useState(0);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) =>
      rows[index]?.kind === "header"
        ? 42
        : Math.max(
            160,
            (((width - 32 - (columns - 1) * 16) / columns) * 9) / 16 + 140,
          ),
    overscan: 5,
    measureElement: (element) =>
      Math.ceil(element.getBoundingClientRect().height),
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      if (focusedRow !== undefined && !indices.includes(focusedRow))
        indices.push(focusedRow);
      return indices.sort((a, b) => a - b);
    },
    directDomUpdates: true,
    useFlushSync: false,
  });

  // Remember the first visible article before resize regroups the rows.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const remember = () => {
      const top = scroller.getBoundingClientRect().top;
      for (const node of scroller.querySelectorAll<HTMLElement>(
        ".article-card",
      )) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom > top) {
          anchor.current = {
            id: node.dataset.entryId ?? "",
            offset: rect.top - top,
          };
          break;
        }
      }
    };
    const observer = new ResizeObserver(() => setWidth(scroller.clientWidth));
    observer.observe(scroller);
    scroller.addEventListener("scroll", remember, { passive: true });
    remember();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", remember);
    };
  }, [scrollRef]);

  // Reset measurements only for layout changes, not page appends or refetches.
  useLayoutEffect(() => {
    if (!visible || width === 0) return;
    if (previousColumns.current === columns && previousWidth.current === width)
      return;
    const hadLayout = previousWidth.current > 0;
    virtualizer.measure();
    for (const node of scrollRef.current?.querySelectorAll<HTMLElement>(
      "[data-index]",
    ) ?? [])
      virtualizer.measureElement(node);
    if (hadLayout && anchor.current) {
      const index = entryRows.get(anchor.current.id);
      if (index !== undefined) {
        virtualizer.scrollToIndex(index, { align: "start" });
        const scroller = scrollRef.current;
        if (scroller) scroller.scrollTop -= anchor.current.offset;
      }
    }
    previousColumns.current = columns;
    previousWidth.current = width;
  }, [columns, width, visible, virtualizer, scrollRef, entryRows]);

  useEffect(() => {
    if (!visible) {
      restoredId.current = null;
      return;
    }
    if (activeId === null || restoredId.current === activeId) return;
    const index = entryRows.get(activeId);
    if (index !== undefined) {
      virtualizer.scrollToIndex(index, { align: "auto" });
      restoredId.current = activeId;
    }
  }, [activeId, visible, entryRows, virtualizer]);

  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const node = Array.from(
      scrollRef.current?.querySelectorAll<HTMLButtonElement>(".article-card") ??
        [],
    ).find((node) => node.dataset.entryId === pendingFocus);
    if (node) {
      node.focus({ preventScroll: true });
      setPendingFocus(null);
    }
  });

  const rowRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) virtualizer.measureElement(node);
    },
    [virtualizer],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".article-card",
    );
    if (!card) return;
    const index = entries.findIndex(
      (entry) => entry.id === card.dataset.entryId,
    );
    const next = entries[index + (event.shiftKey ? -1 : 1)];
    if (!next) return;
    event.preventDefault();
    setPendingFocus(next.id);
    const row = entryRows.get(next.id);
    if (row !== undefined) virtualizer.scrollToIndex(row, { align: "auto" });
  };

  if (loading)
    return (
      <Box p="md">
        <span role="status" className="sr-only">
          Loading articles…
        </span>
        <div
          className="cards-grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {Array.from({ length: 9 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed loading scaffold
            <div key={index} className="article-card">
              <div className="card-media skeleton-line" />
              <div className="card-text">
                <div className="skeleton-line skeleton-line-meta" />
                <div
                  className="skeleton-line skeleton-line-title"
                  style={{ marginTop: 16 }}
                />
              </div>
            </div>
          ))}
        </div>
      </Box>
    );
  if (!entries.length)
    return (
      <Text ta="center" c="dimmed" py="xl" size="sm">
        nothing here yet.
      </Text>
    );
  return (
    <Box
      px="md"
      pb="xl"
      onKeyDown={onKeyDown}
      onFocusCapture={(event) =>
        setFocusedId(
          (event.target as HTMLElement).closest<HTMLElement>(".article-card")
            ?.dataset.entryId ?? null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocusedId(null);
      }}
    >
      <div
        ref={virtualizer.containerRef}
        data-cards-columns={columns}
        style={{
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              ref={rowRef}
              data-index={item.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
              }}
            >
              {row.kind === "header" ? (
                <Group gap="xs" pt="sm" pb="xs">
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
                <div
                  className="cards-grid"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    paddingBottom: 16,
                  }}
                >
                  {row.entries.map((entry) => (
                    <ArticleCard
                      key={entry.id}
                      entry={entry}
                      active={entry.id === activeId}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Box>
  );
}
