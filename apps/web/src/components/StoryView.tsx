import {
  ActionIcon,
  Box,
  Button,
  Center,
  Group,
  Image,
  Stack,
  Text,
} from "@mantine/core";
import type { PointerEvent, ReactElement } from "react";
import { useRef, useState } from "react";
import { LuArrowDown, LuArrowUp } from "react-icons/lu";
import { timeLabel } from "../lib/date-grouping";
import type { Entry, Subscription } from "../lib/types";

export function StoryView({
  entries,
  subscriptions,
  loading,
  onRead,
  onNext,
  onPrev,
}: {
  entries: Entry[];
  subscriptions: Subscription[];
  loading: boolean;
  onRead: (entry: Entry) => void;
  onNext: () => void;
  onPrev: () => void;
}): ReactElement {
  const [index, setIndex] = useState(0);
  const start = useRef<number | null>(null);
  const entry = entries[index];
  if (loading) return <Center h="100%">loading…</Center>;
  if (!entry) return <Center h="100%">nothing here yet.</Center>;
  const sub = subscriptions.find((item) => item.feedId === entry.feedId);
  const move = (direction: "next" | "prev") => {
    const target = direction === "next" ? index + 1 : index - 1;
    if (target >= 0 && target < entries.length) setIndex(target);
    if (target >= entries.length) {
      setIndex(target);
      onNext();
    }
    if (target < 0) onPrev();
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    start.current = event.clientY;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    const delta = event.clientY - start.current;
    start.current = null;
    if (Math.abs(delta) > 80) move(delta < 0 ? "next" : "prev");
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      move("prev");
    } else if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      move("next");
    }
  };
  return (
    <Box
      h="calc(100dvh - var(--app-shell-header-offset, 0rem))"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-label={`Story ${index + 1} of ${entries.length}: ${entry.title}`}
      style={{ touchAction: "none", position: "relative", overflow: "hidden" }}
      data-story-view
    >
      {entry.articleImage ? (
        <Image
          src={`/api/v1/media/${entry.articleImage.id}`}
          alt={entry.articleImage.alt}
          fit="cover"
          h="100%"
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
          c={entry.articleImage ? "white" : undefined}
        >
          {entry.title}
        </Text>
        <Button
          component="a"
          href={`${window.location.pathname}/e/${entry.id}`}
          onClick={(event) => {
            event.preventDefault();
            onRead(entry);
          }}
          mt="sm"
        >
          Read
        </Button>
      </Stack>
      <ActionIcon
        aria-label="previous story"
        variant="subtle"
        onClick={() => move("prev")}
        style={{ position: "absolute", left: 12, top: "50%" }}
      >
        <LuArrowUp />
      </ActionIcon>
      <ActionIcon
        aria-label="next story"
        variant="subtle"
        onClick={() => move("next")}
        style={{ position: "absolute", right: 12, top: "50%" }}
      >
        <LuArrowDown />
      </ActionIcon>
    </Box>
  );
}
