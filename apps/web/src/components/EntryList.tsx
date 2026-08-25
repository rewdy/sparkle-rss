import { Box, Group, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactElement, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import type { Entry } from '../lib/types';
import { fonts } from '../theme';

type Row =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'entry'; key: string; entry: Entry };

const HEADER_HEIGHT = 30;
const ENTRY_HEIGHT = 68;
const OVERSCAN = 15;
const SKELETON_COUNT = 12;

function dayGroup(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= startOfToday) return 'today';
  if (ms >= startOfToday - 86_400_000) return 'yesterday';
  if (ms >= startOfToday - 7 * 86_400_000) return 'this week';
  if (ms >= startOfToday - 30 * 86_400_000) return 'this month';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function timeLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function groupByDay(entries: Entry[]): Array<{ label: string; items: Entry[] }> {
  const groups: Array<{ label: string; items: Entry[] }> = [];
  for (const entry of entries) {
    const label = dayGroup(entry.publishedAtMs);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}

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
        kind: 'header',
        key: `h-${group.label}`,
        label: group.label,
        count: group.items.length,
      });
      for (const entry of group.items) out.push({ kind: 'entry', key: entry.id, entry });
    }
    return out;
  }, [entries]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? HEADER_HEIGHT : ENTRY_HEIGHT),
    overscan: OVERSCAN,
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
      if (row?.kind === 'entry' && row.key === activeId) {
        virtualizer.scrollToIndex(i, { align: 'auto' });
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
        style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}
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
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {row.kind === 'header' ? (
                <Group gap="xs" px="sm" pt={vi.index === 0 ? 'sm' : 'xs'} pb="xxs">
                  <Text size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: 1.5 }}>
                    {row.label}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {row.count}
                  </Text>
                </Group>
              ) : (
                <EntryRow
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
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </Box>
  );
}

const EntryRow = memo(function EntryRow({
  entry,
  active,
  onSelect,
}: {
  entry: Entry;
  active: boolean;
  onSelect: (entry: Entry) => void;
}): ReactElement {
  return (
    <Box
      className="entry-row"
      data-active={active || undefined}
      data-entry-id={entry.id}
      onClick={() => onSelect(entry)}
      px="md"
      py="sm"
      style={{ cursor: 'pointer' }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" mb="xxs">
        <Text size="xs" c="dimmed" truncate={true}>
          {entry.author || '\u00a0'}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          {timeLabel(entry.publishedAtMs)}
        </Text>
      </Group>
      <Text size="md" fw={entry.isRead ? 400 : 700} lh={1.4} style={{ fontFamily: fonts.sans }}>
        {entry.title}
      </Text>
    </Box>
  );
});
