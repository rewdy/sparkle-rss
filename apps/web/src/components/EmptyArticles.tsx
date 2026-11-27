import { Stack, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { useState } from "react";
import { LuCoffee } from "react-icons/lu";

const messages = [
  "All quiet on the reading front.",
  "Nothing to read. Everything to ponder.",
  "It’s a slow news minute.",
  "No headlines in sight.",
  "A little intermission.",
  "The headlines are playing hide-and-seek.",
  "The news desk is taking a breather.",
  "Nothing on the reading menu right now.",
];

export function EmptyArticles(): ReactElement {
  const [message] = useState(
    () => messages[Math.floor(Math.random() * messages.length)],
  );

  return (
    <Stack
      align="center"
      justify="center"
      gap="sm"
      c="dimmed"
      p="xl"
      style={{ flex: 1 }}
    >
      <LuCoffee size={32} aria-hidden="true" />
      <Text ta="center" size="sm">
        {message}
      </Text>
    </Stack>
  );
}
