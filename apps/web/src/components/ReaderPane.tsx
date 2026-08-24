import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { useMarkRead, useToggleStar } from '../lib/mutations';
import type { Entry } from '../lib/types';

export function ReaderPane({
  entry,
  onClose,
  onNext,
  onPrev,
}: {
  entry: Entry;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}): ReactElement {
  const markRead = useMarkRead();
  const toggleStar = useToggleStar();
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    topRef.current?.scrollIntoView();
  }, [entry.id]);

  return (
    <Box
      pos="absolute"
      inset={0}
      bg="var(--mantine-color-body)"
      style={{ zIndex: 5 }}
      data-reading-pane="true"
    >
      <Group
        justify="space-between"
        px="sm"
        py={6}
        style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}
      >
        <Button variant="subtle" size="compact-sm" onClick={onClose}>
          ← back
        </Button>
        <Group gap="xs">
          <ActionIcon
            variant={entry.isStarred ? 'light' : 'subtle'}
            color="accent"
            title="star (s)"
            onClick={() =>
              void toggleStar.mutateAsync({ ids: [entry.id], starred: !entry.isStarred })
            }
          >
            {entry.isStarred ? '★' : '☆'}
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            title="toggle read (m)"
            onClick={() => void markRead.mutateAsync({ ids: [entry.id], read: !entry.isRead })}
          >
            {entry.isRead ? '●' : '○'}
          </ActionIcon>
          {entry.url && (
            <Button
              component="a"
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              variant="default"
              size="compact-sm"
            >
              open original ↗
            </Button>
          )}
        </Group>
      </Group>

      <ScrollArea h="calc(100% - 41px)" offsetScrollbars>
        <Stack gap="md" maw={720} mx="auto" p="lg" ref={topRef}>
          <Text size="xs" c="dimmed" ff="monospace">
            {new Date(entry.publishedAtMs).toLocaleString()}
            {entry.author ? ` · ${entry.author}` : ''}
          </Text>
          <Title order={1} lh={1.25}>
            {entry.title}
          </Title>

          {entry.enclosures.filter((e) => e.href && e.type?.startsWith('audio/')).length > 0 && (
            <Stack gap="xs">
              <Divider label="attachments" c="dimmed" />
              {entry.enclosures
                .filter((e) => e.href && e.type?.startsWith('audio/'))
                .map((enc, i) => (
                  <audio key={i} controls src={enc.href} style={{ width: '100%' }}>
                    <track kind="captions" />
                  </audio>
                ))}
            </Stack>
          )}

          {/* content is sanitized server-side at ingest */}
          <div
            className="reading-content"
            dangerouslySetInnerHTML={{ __html: entry.contentHtml }}
          />

          <Group justify="space-between" py="md">
            <Button variant="default" size="compact-sm" onClick={onPrev}>
              ↑ previous (k)
            </Button>
            <Button variant="default" size="compact-sm" onClick={onNext}>
              ↓ next (j)
            </Button>
          </Group>
        </Stack>
      </ScrollArea>
    </Box>
  );
}
