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
import {
  canOfferRssFinder,
  isHttpUrl,
  useDiscoverFeed,
} from "../lib/subscription-discovery";
import type { Folder } from "../lib/types";
import { RssFinderLink } from "./RssFinderLink";

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
  const [fallbackUrl, setFallbackUrl] = useState("");
  const discovery = useDiscoverFeed();
  const subscribe = useSubscribe();
  const pending = discovery.isPending || subscribe.isPending;

  async function submit(): Promise<void> {
    if (!isHttpUrl(url.trim()) || pending) return;
    const sourceUrl = url.trim();
    setSubmitError(null);
    setFallbackUrl("");
    try {
      const { feed } = await discovery.mutateAsync(sourceUrl);
      await subscribe.mutateAsync({
        url: feed.feedUrl,
        title: title.trim() || undefined,
        folderId: folderId === "" ? null : Number(folderId),
      });
      setUrl("");
      setTitle("");
      onClose();
    } catch (error) {
      setSubmitError(
        (error as { status?: number })?.status === 409
          ? "Already subscribed to this feed"
          : "Could not add feed",
      );
      if (canOfferRssFinder(error)) setFallbackUrl(sourceUrl);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="subscribe" size="md">
      <Stack gap="sm">
        <TextInput
          label="feed or site URL"
          placeholder="https://example.com/blog"
          value={url}
          disabled={pending}
          onChange={(e) => {
            setUrl(e.currentTarget.value);
            setSubmitError(null);
            setFallbackUrl("");
          }}
          data-autofocus
          error={
            !isHttpUrl(url) && url.length > 0
              ? "must start with http(s)://"
              : (submitError ?? undefined)
          }
        />
        {fallbackUrl && <RssFinderLink sourceUrl={fallbackUrl} />}
        <TextInput
          label="custom title (optional)"
          value={title}
          disabled={pending}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <NativeSelect
          label="folder"
          description="feeds can be moved between folders later"
          value={folderId}
          disabled={pending}
          onChange={(e) => setFolderId(e.currentTarget.value)}
          data={[
            { value: "", label: "— none —" },
            ...folders.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={pending}>
            cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            subscribe
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
