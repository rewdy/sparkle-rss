import { Group, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { FeedIcon } from "./FeedIcon";

/**
 * Standard entry byline: `[icon] Site • Author • Date`. Any text part is
 * omitted when empty; callers pass a preformatted `date` only where it makes
 * sense (the list view shows time separately on the right).
 */
export function EntryMeta({
  iconUrl,
  site,
  author,
  date,
  size = "xs",
  c = "dimmed",
  truncate = false,
  maw,
}: {
  iconUrl?: string | null;
  site?: string;
  author?: string;
  date?: string;
  size?: "xs" | "sm";
  c?: string;
  truncate?: boolean;
  maw?: number | string;
}): ReactElement {
  const parts = [site, author, date].filter((part): part is string =>
    Boolean(part),
  );
  return (
    <Group gap="xs" wrap="nowrap" miw={0} maw={maw} style={{ minWidth: 0 }}>
      <FeedIcon iconUrl={iconUrl} />
      <Text size={size} c={c} truncate={truncate}>
        {parts.join(" • ")}
      </Text>
    </Group>
  );
}
