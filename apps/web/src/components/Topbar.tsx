import { ActionIcon, Button, Divider, Group, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { LuMoon, LuRefreshCw, LuSun } from 'react-icons/lu';
import { useMarkAllRead } from '../lib/mutations';
import type { StreamDescriptor } from '../lib/types';
import { useColorSchemeValue } from '../lib/ui-state';

export function Topbar({
  stream,
  title,
  filter,
  onFilterChange,
}: {
  stream: StreamDescriptor;
  title: string;
  filter: 'all' | 'unread';
  onFilterChange: (f: 'all' | 'unread') => void;
}): ReactElement {
  const qc = useQueryClient();
  const markAll = useMarkAllRead(stream);
  const [scheme, setScheme] = useColorSchemeValue();

  return (
    <Group justify="space-between" h="100%" px="md" wrap="nowrap" miw={0}>
      <Group gap="sm" wrap="nowrap" miw={0}>
        <Text size="sm" fw={700} style={{ whiteSpace: 'nowrap' }}>
          ✦ Sparkle RSS
        </Text>
        <Divider orientation="vertical" c="dimmed" style={{ alignSelf: 'center', height: 14 }} />
        <Text size="sm" truncate={true} maw={320}>
          {title}
        </Text>
      </Group>

      <Group gap="xs" wrap="nowrap">
        {stream.kind !== 'starred' && stream.kind !== 'unread' && (
          <SegmentedControl
            size="compact-xs"
            value={filter}
            onChange={(v) => onFilterChange(v as 'all' | 'unread')}
            data={[
              { value: 'all', label: 'all' },
              { value: 'unread', label: 'unread' },
            ]}
          />
        )}
        {stream.kind !== 'starred' && stream.kind !== 'today' && (
          <Tooltip label="mark everything read (Shift+A)">
            <Button
              size="compact-xs"
              variant="default"
              loading={markAll.isPending}
              onClick={() => markAll.mutate(undefined)}
            >
              mark all read
            </Button>
          </Tooltip>
        )}

        <Tooltip label="refresh">
          <ActionIcon
            variant="subtle"
            aria-label="refresh"
            onClick={() => {
              void qc.invalidateQueries();
            }}
          >
            <LuRefreshCw size={15} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="toggle theme">
          <ActionIcon
            variant="subtle"
            aria-label="toggle theme"
            onClick={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}
          >
            {scheme === 'dark' ? <LuMoon size={15} /> : <LuSun size={15} />}
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
