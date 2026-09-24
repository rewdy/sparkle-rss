import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Title,
  Tooltip,
} from "@mantine/core";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import {
  LuArrowLeft,
  LuBookmark,
  LuClock,
  LuExternalLink,
  LuTrash2,
} from "react-icons/lu";
import { useSubscriptionMap } from "../lib/feed-titles";
import {
  useMarkRead,
  useMarkReadLater,
  useRemoveReadLater,
  useToggleReadLater,
  useToggleStar,
} from "../lib/mutations";
import type { Entry } from "../lib/types";
import { EntryMeta } from "./EntryMeta";

export function ReaderPane({
  entry,
  readLater = false,
  onClose,
  onNext,
  onPrev,
}: {
  entry: Entry;
  readLater?: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}): ReactElement {
  const markReadEntry = useMarkRead();
  const markReadSaved = useMarkReadLater();
  const markRead = readLater ? markReadSaved : markReadEntry;
  const toggleStar = useToggleStar();
  const toggleReadLater = useToggleReadLater();
  const removeReadLater = useRemoveReadLater();
  // Saved URLs have no entry behind them: read state is per-item and
  // star/read-later toggles do not apply.
  const isSavedUrl = readLater && entry.source === "url";
  const feedMeta = useSubscriptionMap();
  const sub = feedMeta.get(entry.feedId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref-based scroll reset, entry id is the only trigger
  useEffect(() => {
    // Reset scroll to the top only when the entry changes; the ref is stable.
    viewportRef.current?.scrollTo({ top: 0 });
  }, [entry.id]);

  // Defer off-screen article images; ingested HTML won't always set lazy.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref-based DOM post-processing keyed on entry change
  useEffect(() => {
    contentRef.current?.querySelectorAll("img").forEach((img) => {
      img.loading = "lazy";
      img.decoding = "async";
    });
  }, [entry.id]);

  return (
    <Box
      data-reading-pane="true"
      h="calc(100dvh - var(--app-shell-header-offset, 0rem))"
      style={{ display: "flex", flexDirection: "column" }}
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
        </Group>
        <Group gap="xs">
          <ActionIcon
            variant="subtle"
            title="toggle read (m)"
            aria-label="toggle read"
            onClick={() =>
              void markRead.mutateAsync({
                ids: [entry.id],
                read: !entry.isRead,
              })
            }
          >
            {entry.isRead ? "●" : "○"}
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

      <ScrollArea
        offsetScrollbars
        viewportRef={viewportRef}
        style={{ flex: 1 }}
      >
        <Stack
          className="reading-pane-stack"
          gap="md"
          maw={720}
          mx="auto"
          style={{
            padding:
              "var(--mantine-spacing-sm) var(--mantine-spacing-lg) var(--mantine-spacing-lg)",
            paddingBottom:
              "calc(var(--mantine-spacing-lg) + env(safe-area-inset-bottom))",
          }}
        >
          <EntryMeta
            iconUrl={sub?.iconUrl}
            site={sub?.displayTitle ?? entry.siteName}
            author={entry.author}
            date={new Date(entry.publishedAtMs).toLocaleString()}
            size="sm"
          />

          <Title order={1} lh={1.25}>
            {entry.title}
          </Title>

          {entry.enclosures.filter(
            (e) => e.href && e.type?.startsWith("audio/"),
          ).length > 0 && (
            <Stack gap="xs">
              <Divider label="attachments" c="dimmed" />
              {entry.enclosures
                .filter((e) => e.href && e.type?.startsWith("audio/"))
                .map((enc) => (
                  <audio
                    key={enc.href}
                    controls
                    src={enc.href}
                    style={{ width: "100%" }}
                  >
                    <track kind="captions" />
                  </audio>
                ))}
            </Stack>
          )}

          {/* content is sanitized server-side at ingest; stored HTML rendered as-is */}
          <div
            ref={contentRef}
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
            {readLater ? (
              <Tooltip label="remove from read later (l)">
                <ActionIcon
                  variant="light"
                  color="accent"
                  size="lg"
                  aria-label="remove from read later"
                  onClick={() => void removeReadLater.mutateAsync([entry.id])}
                >
                  <LuTrash2 size={18} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label="read later (l)">
                <ActionIcon
                  variant={entry.isReadLater ? "light" : "subtle"}
                  color="accent"
                  size="lg"
                  aria-label={
                    entry.isReadLater ? "remove from read later" : "read later"
                  }
                  onClick={() =>
                    void toggleReadLater.mutateAsync({
                      ids: [entry.id],
                      save: !entry.isReadLater,
                    })
                  }
                >
                  <LuClock
                    size={18}
                    style={
                      entry.isReadLater ? { fill: "currentColor" } : undefined
                    }
                  />
                </ActionIcon>
              </Tooltip>
            )}
            {!isSavedUrl && (
              <ActionIcon
                variant={entry.isStarred ? "light" : "subtle"}
                color="yellow"
                size="lg"
                title="save (s)"
                aria-label={entry.isStarred ? "unsave" : "save"}
                onClick={() =>
                  void toggleStar.mutateAsync({
                    ids: [entry.id],
                    starred: !entry.isStarred,
                  })
                }
              >
                <LuBookmark
                  size={18}
                  style={entry.isStarred ? { fill: "currentColor" } : undefined}
                />
              </ActionIcon>
            )}
          </Group>
        </Stack>
      </ScrollArea>
    </Box>
  );
}
