import { Kbd, Modal, Stack, Table, Text } from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import type { ReactElement } from "react";
import { shortcutsOpenAtom } from "../lib/ui-state";

const SHORTCUTS: Array<[string, string]> = [
  ["j / k", "open next / previous item"],
  ["m", "toggle read"],
  ["s", "toggle star"],
  ["Shift + A", "mark stream read"],
  ["Esc", "back to list (close article)"],
  ["?", "toggle this help"],
];

export function ShortcutsModal(): ReactElement {
  const open = useAtomValue(shortcutsOpenAtom);
  const setOpen = useSetAtom(shortcutsOpenAtom);

  return (
    <Modal
      opened={open}
      onClose={() => setOpen(false)}
      title="keyboard shortcuts"
      size="sm"
      centered
    >
      <Stack gap="sm">
        <Table verticalSpacing={4} fz="sm">
          <Table.Tbody>
            {SHORTCUTS.map(([keys, action]) => (
              <Table.Tr key={keys}>
                <Table.Td w={120}>
                  <Kbd>{keys}</Kbd>
                </Table.Td>
                <Table.Td c="dimmed">{action}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed">
          click an entry to open the reading pane
        </Text>
      </Stack>
    </Modal>
  );
}
