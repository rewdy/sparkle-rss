import {
  ActionIcon,
  Burger,
  Button,
  Divider,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import {
  LuMoon,
  LuRefreshCw,
  LuSparkles,
  LuSun,
  LuSunMoon,
} from "react-icons/lu";
import { Link } from "wouter";
import { useMarkAllRead } from "../lib/mutations";
import type { StreamDescriptor } from "../lib/types";
import { useColorSchemeValue } from "../lib/ui-state";

export function Topbar({
  stream,
  title,
  filter,
  onFilterChange,
  navOpened,
  onToggleNav,
  presentation,
  onPresentationChange,
}: {
  stream: StreamDescriptor;
  title: string;
  filter: "all" | "unread";
  onFilterChange: (f: "all" | "unread") => void;
  navOpened: boolean;
  onToggleNav: () => void;
  presentation: "list" | "swipe";
  onPresentationChange: (value: "list" | "swipe") => void;
}): ReactElement {
  const qc = useQueryClient();
  const markAll = useMarkAllRead(stream);
  const [scheme, setScheme] = useColorSchemeValue();

  function cycleScheme(): void {
    setScheme(
      scheme === "dark" ? "light" : scheme === "light" ? "system" : "dark",
    );
  }

  return (
    <Group justify="space-between" h="100%" px="md" wrap="nowrap" miw={0}>
      <Group gap="sm" wrap="nowrap" miw={0}>
        <Burger
          opened={navOpened}
          onClick={onToggleNav}
          hiddenFrom="sm"
          size="sm"
          aria-label="toggle navigation"
        />
        <Text
          size="sm"
          fw={700}
          component={Link}
          href="/today"
          style={{
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          className="site-title"
        >
          <LuSparkles size={15} />
          Sparkle RSS
        </Text>
        <Divider
          orientation="vertical"
          c="dimmed"
          visibleFrom="sm"
          style={{ alignSelf: "center", height: 14 }}
        />
        <Text size="sm" truncate={true} maw={320} visibleFrom="sm">
          {title}
        </Text>
      </Group>

      <Group gap="xs" wrap="nowrap">
        <SegmentedControl
          size="xs"
          value={presentation}
          onChange={(value) => {
            if (value === "list" || value === "swipe")
              onPresentationChange(value);
          }}
          data={[
            { label: "list", value: "list" },
            { label: "swipe", value: "swipe" },
          ]}
        />
        {stream.kind !== "starred" && stream.kind !== "unread" && (
          <SegmentedControl
            size="xs"
            visibleFrom="sm"
            value={filter}
            onChange={(value) => {
              if (value === "all" || value === "unread") onFilterChange(value);
            }}
            data={[
              { label: "all", value: "all" },
              { label: "unread", value: "unread" },
            ]}
          />
        )}
        {stream.kind !== "starred" && stream.kind !== "today" && (
          <Tooltip label="mark everything read (Shift+A)">
            <Button
              size="compact-xs"
              variant="default"
              visibleFrom="sm"
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
            onClick={cycleScheme}
          >
            {scheme === "dark" ? (
              <LuMoon size={15} />
            ) : scheme === "light" ? (
              <LuSun size={15} />
            ) : (
              <LuSunMoon size={15} />
            )}
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
