import { Box, Text } from '@mantine/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { api } from '../lib/api';
import { qk } from '../lib/keys';
import type { Entry, StreamDescriptor } from '../lib/types';
import { EntryList } from './EntryList';

export function StreamInner({
  stream,
  filter,
  sort,
  activeEntryId,
  markReadOnOpen,
  onSelect,
  onEntriesChange,
}: {
  stream: StreamDescriptor;
  filter: 'all' | 'unread';
  sort: 'asc' | 'desc';
  activeEntryId: string | null;
  markReadOnOpen: boolean;
  onSelect: (entry: Entry) => void;
  onEntriesChange: (entries: Entry[]) => void;
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
  });

  const entries = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const entriesRef = useRef<Entry[]>(entries);
  entriesRef.current = entries;

  useEffect(() => {
    onEntriesChange(entries);
  }, [entries, onEntriesChange]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (observed) => {
        if (observed[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query]);

  function select(entry: Entry): void {
    if (markReadOnOpen && !entry.isRead) {
      entry.isRead = true;
      void api.entries.setRead([entry.id], true);
    }
    onSelect(entry);
  }

  return (
    <Box h="calc(100vh - 44px)" style={{ overflowY: 'auto' }} data-stream-scroll>
      <EntryList
        entries={entries}
        loading={query.isPending}
        activeId={activeEntryId}
        onSelect={select}
      />
      <div ref={sentinelRef} style={{ height: 1 }} />
      {!query.hasNextPage && entries.length > 0 && (
        <Text ta="center" c="dimmed" size="xs" py="md" ff="monospace">
          ∎ end of stream
        </Text>
      )}
    </Box>
  );
}
