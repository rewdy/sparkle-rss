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
  Tooltip,
} from '@mantine/core';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { LuArrowLeft, LuExternalLink, LuStar } from 'react-icons/lu';
import { useFeedTitles } from '../lib/feed-titles';
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
  const feedTitles = useFeedTitles();
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [entry.id]);

  return (
    <Box
      data-reading-pane="true"
      h="calc(100dvh - var(--app-shell-header-offset, 0rem))"
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <Group justify="space-between" px="sm" pt="xs" pb="xxs" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<LuArrowLeft size={14} />}
            onClick={onClose}
          >
            back
          </Button>
          <Text size="xs" c="dimmed" ff="monospace" truncate={true}>
            {[
              new Date(entry.publishedAtMs).toLocaleString(),
              entry.author,
              feedTitles.get(entry.feedId),
            ]
              .filter(Boolean)
              .join(' • ')}
          </Text>
        </Group>
        <Group gap="xs">
          <ActionIcon
            variant="subtle"
            title="toggle read (m)"
            aria-label="toggle read"
            onClick={() => void markRead.mutateAsync({ ids: [entry.id], read: !entry.isRead })}
          >
            {entry.isRead ? '●' : '○'}
          </ActionIcon>
          {entry.url && (
            <Tooltip label="open original">
              <ActionIcon
                component="a"
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="default"
                aria-label="open original"
              >
                <LuExternalLink size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>

      <ScrollArea offsetScrollbars viewportRef={viewportRef} style={{ flex: 1 }}>
        <Stack
          gap="md"
          maw={720}
          mx="auto"
          style={{
            padding:
              'var(--mantine-spacing-sm) var(--mantine-spacing-lg) var(--mantine-spacing-lg)',
          }}
        >
          <Title order={1} lh={1.25} mt="xl">
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

          <Group justify="flex-start" py="md" gap="sm">
            <Button variant="default" size="compact-sm" onClick={onPrev}>
              ↑ previous (k)
            </Button>
            <Button variant="default" size="compact-sm" onClick={onNext}>
              ↓ next (j)
            </Button>
            <Divider orientation="vertical" c="dimmed" />
            <ActionIcon
              variant={entry.isStarred ? 'light' : 'subtle'}
              color="yellow"
              size="lg"
              title="star (s)"
              aria-label={entry.isStarred ? 'unstar' : 'star'}
              onClick={() =>
                void toggleStar.mutateAsync({ ids: [entry.id], starred: !entry.isStarred })
              }
            >
              <LuStar size={18} style={entry.isStarred ? { fill: 'currentColor' } : undefined} />
            </ActionIcon>
          </Group>
        </Stack>
      </ScrollArea>
    </Box>
  );
}
