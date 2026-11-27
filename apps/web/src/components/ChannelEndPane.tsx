import { Button, Center, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { LuPartyPopper } from "react-icons/lu";

export function ChannelEndPane({
  channel,
  channelHref,
  onClose,
  onPrevious,
  previousStatus,
}: {
  channel: string;
  channelHref: string;
  onClose: () => void;
  onPrevious: () => void;
  previousStatus: "idle" | "loading" | "error" | "unavailable";
}): ReactElement {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <Center mih="calc(100dvh - var(--app-shell-header-offset, 0rem))" p="lg">
      <Stack align="center" ta="center">
        <ThemeIcon
          color="accent"
          variant="light"
          radius="xl"
          size={56}
          aria-hidden
        >
          <LuPartyPopper size={26} />
        </ThemeIcon>
        <Title order={1} ref={heading} tabIndex={-1}>
          You’re at the end!
        </Title>
        <Text c="dimmed">
          That’s the last story in this view. Thanks for reading!
        </Text>
        <Button
          component="a"
          href={channelHref}
          color="accent"
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              event.shiftKey
            )
              return;
            event.preventDefault();
            onClose();
          }}
        >
          Back to {channel}
        </Button>
        {previousStatus === "unavailable" ? (
          <Text role="status" size="sm">
            The previous story is unavailable.
          </Text>
        ) : (
          <Button
            variant="default"
            size="compact-sm"
            disabled={previousStatus === "loading"}
            onClick={onPrevious}
          >
            {previousStatus === "error"
              ? "Retry previous (k)"
              : "↑ previous (k)"}
          </Button>
        )}
      </Stack>
    </Center>
  );
}
