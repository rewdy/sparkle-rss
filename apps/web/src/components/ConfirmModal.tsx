import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { ReactElement, ReactNode } from 'react';

/** Consistent destructive-action confirmation, matching the token-revoke flow. */
export function ConfirmModal({
  opened,
  title,
  confirmLabel = 'delete',
  danger = true,
  loading = false,
  onConfirm,
  onClose,
  children,
}: {
  opened: boolean;
  title: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="sm" centered>
      <Stack gap="sm">
        <Text size="sm">{children}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            cancel
          </Button>
          <Button color={danger ? 'red' : undefined} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
