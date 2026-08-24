import { ActionIcon, Button, Group, Menu, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
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
    <Group justify="space-between" h="100%" px="md" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Text size="sm" fw={700} truncate={true} maw={320}>
          {title}
        </Text>
      </Group>

      <Group gap="xs" wrap="nowrap">
        {stream.kind !== 'starred' && (
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
        {stream.kind !== 'starred' && (
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
            onClick={() => {
              void qc.invalidateQueries();
            }}
            title="refresh"
          >
            ⟳
          </ActionIcon>
        </Tooltip>

        <Menu shadow="sm" width={160}>
          <Menu.Target>
            <ActionIcon variant="subtle" title={`theme: ${scheme}`}>
              {scheme === 'dark' ? '◐' : '◑'}
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>color scheme</Menu.Label>
            <Menu.Item onClick={() => setScheme('light')}>light</Menu.Item>
            <Menu.Item onClick={() => setScheme('dark')}>dark</Menu.Item>
          </Menu.Dropdown>
        </Menu>

        <Text component="span" size="xs" c="var(--mantine-color-accent-6)" ff="monospace">
          ✦ sparkle
        </Text>
      </Group>
    </Group>
  );
}
