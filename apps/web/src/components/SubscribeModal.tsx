import {
  Button,
  Group,
  Modal,
  NativeSelect,
  Stack,
  TextInput,
} from "@mantine/core";
import type { ReactElement } from "react";
import { useState } from "react";
import { useSubscribe } from "../lib/mutations";
import type { Folder } from "../lib/types";

export function SubscribeModal({
  opened,
  onClose,
  folders,
}: {
  opened: boolean;
  onClose: () => void;
  folders: Folder[];
}): ReactElement {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const subscribe = useSubscribe();

  async function submit(): Promise<void> {
    if (!url.trim()) return;
    setSubmitError(null);
    try {
      await subscribe.mutateAsync({
        url: url.trim(),
        title: title.trim() || undefined,
        folderId: folderId === "" ? null : Number(folderId),
      });
      setUrl("");
      setTitle("");
      onClose();
    } catch {
      setSubmitError("Could not add feed");
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="subscribe" size="md">
      <Stack gap="sm">
        <TextInput
          label="feed or site URL"
          placeholder="https://example.com/blog"
          value={url}
          onChange={(e) => {
            setUrl(e.currentTarget.value);
            setSubmitError(null);
          }}
          data-autofocus
          error={
            !url.startsWith("http") && url.length > 0
              ? "must start with http(s)://"
              : (submitError ?? undefined)
          }
        />
        <TextInput
          label="custom title (optional)"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <NativeSelect
          label="folder"
          description="feeds can be moved between folders later"
          value={folderId}
          onChange={(e) => setFolderId(e.currentTarget.value)}
          data={[
            { value: "", label: "— none —" },
            ...folders.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            cancel
          </Button>
          <Button onClick={() => void submit()} loading={subscribe.isPending}>
            subscribe
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
