import { Box, Button, Center, Group, Image, Stack, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { LuCheck } from "react-icons/lu";
import { timeLabel } from "../lib/date-grouping";
import type { Entry, Subscription } from "../lib/types";

export function StoryView({
  entries,
  subscriptions,
  loading,
  onRead,
  readHref,
  activeIndex,
  onActiveIndexChange,
}: {
  entries: Entry[];
  subscriptions: Subscription[];
  loading: boolean;
  onRead: (entry: Entry) => void;
  readHref: (entry: Entry) => string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(activeIndex);
  const routeUpdateIndexRef = useRef<number | null>(null);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    const container = scrollRef.current;
    const target = container?.children[activeIndex] as HTMLElement | undefined;
    if (routeUpdateIndexRef.current === activeIndex) {
      routeUpdateIndexRef.current = null;
      return;
    }
    routeUpdateIndexRef.current = null;
    if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
  }, [activeIndex]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || entries.length === 0) return;
    const observer = new IntersectionObserver(
      (observations) => {
        const visible = observations
          .filter((observation) => observation.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = Number.parseInt(
          (visible.target as HTMLElement).dataset.storyIndex ?? "0",
          10,
        );
        if (index !== activeIndexRef.current) {
          routeUpdateIndexRef.current = index;
          onActiveIndexChange(index);
        }
      },
      { root: container, threshold: [0.6] },
    );
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [entries.length, onActiveIndexChange]);

  if (loading) return <Center h="100%">loading…</Center>;
  if (!entries.length) return <Center h="100%">nothing here yet.</Center>;
  // Keep the active story and the next two stories mounted. Previously every
  // entry in the React Query cache rendered here, which allowed the browser to
  // defer image requests unpredictably and made large feeds expensive.
  const renderedEntries = entries.slice(
    0,
    Math.min(entries.length, Math.max(3, activeIndex + 3)),
  );
  return (
    <Box
      ref={scrollRef}
      h="calc(100dvh - var(--app-shell-header-offset, 0rem))"
      tabIndex={0}
      aria-label={`Story ${activeIndex + 1} of ${entries.length}`}
      style={{
        overflowY: "scroll",
        overscrollBehaviorY: "contain",
        scrollSnapType: "y mandatory",
        scrollbarWidth: "none",
      }}
      data-story-view
    >
      {renderedEntries.map((entry, index) => {
        const sub = subscriptions.find((item) => item.feedId === entry.feedId);
        return (
          <Box
            key={entry.id}
            data-story-index={index}
            style={{
              height: "calc(100dvh - var(--app-shell-header-offset, 0rem))",
              position: "relative",
              scrollSnapAlign: "start",
              scrollSnapStop: "always",
            }}
          >
            {entry.articleImage ? (
              <Image
                src={`/api/v1/media/${entry.articleImage.id}`}
                alt={entry.articleImage.alt}
                fit="cover"
                h="100%"
                loading={index <= activeIndex + 2 ? "eager" : "lazy"}
                fetchPriority={index <= activeIndex + 1 ? "high" : "auto"}
              />
            ) : null}
            <Stack
              align="center"
              justify="center"
              gap="xs"
              p="xl"
              h="100%"
              style={{
                position: "absolute",
                inset: 0,
                background: entry.articleImage
                  ? "linear-gradient(transparent 25%, rgba(0,0,0,.78))"
                  : "var(--mantine-color-body)",
              }}
            >
              <Group gap="xs" c={entry.articleImage ? "white" : undefined}>
                {sub?.iconUrl ? (
                  <Image src={sub.iconUrl} alt="" w={24} h={24} radius="sm" />
                ) : null}
                <Text size="sm">{sub?.displayTitle ?? ""}</Text>
              </Group>
              <Text size="sm" c={entry.articleImage ? "gray.3" : "dimmed"}>
                {entry.author} · {timeLabel(entry.publishedAtMs)}
              </Text>
              <Text
                ta="center"
                size="xl"
                fw={700}
                maw={680}
                c={
                  entry.articleImage
                    ? entry.isRead
                      ? "gray.3"
                      : "white"
                    : entry.isRead
                      ? "dimmed"
                      : undefined
                }
              >
                {entry.title}
              </Text>
              <Button
                component="a"
                href={readHref(entry)}
                color={entry.isRead ? "gray" : undefined}
                leftSection={entry.isRead ? <LuCheck size={14} /> : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onRead(entry);
                }}
                mt="sm"
              >
                Read
              </Button>
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}
