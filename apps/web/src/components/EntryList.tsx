import { Box, Group, Text } from '@mantine/core';
import type { ReactElement } from 'react';
import type { Entry } from '../lib/types';

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
}: {
  entries: Entry[];
  loading: boolean;
  activeId: string | null;
  onSelect: (entry: Entry) => void;
}): ReactElement {
  const groups = groupByDay(entries);

  return (
    <Box pb="xl">
      {loading && (
        <Text c="dimmed" ta="center" py="lg" size="sm">
          loading…
        </Text>
      )}

      {groups.map((group) => (
        <div key={group.label}>
          <Group gap={8} px="sm" py={6}>
            <Text size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: 1.5 }}>
              {group.label}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace">
              {group.items.length}
            </Text>
          </Group>
          {group.items.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              active={entry.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}

      {!loading && entries.length === 0 && (
        <Text ta="center" c="dimmed" py="xl" size="sm">
          nothing here yet.
        </Text>
      )}
    </Box>
  );
}

function EntryRow({
  entry,
  active,
  onSelect,
}: {
  entry: Entry;
  active: boolean;
  onSelect: (entry: Entry) => void;
}) {
  return (
    <Box
      className="entry-row"
      data-active={active || undefined}
      data-entry-id={entry.id}
      onClick={() => onSelect(entry)}
      px="md"
      py={10}
      style={{ cursor: 'pointer' }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" mb={2}>
        <Text size="xs" c="dimmed" truncate={true}>
          {entry.author || '\u00a0'}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          {timeLabel(entry.publishedAtMs)}
        </Text>
      </Group>
      <Text size="sm" fw={entry.isRead ? 400 : 700} lh={1.4}>
        {entry.title}
      </Text>
    </Box>
  );
}
