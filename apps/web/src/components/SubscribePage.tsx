import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  NativeSelect,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { qk } from "../lib/keys";
import { useSubscribe } from "../lib/mutations";
import {
  canOfferRssFinder,
  isHttpUrl,
  useFeedDiscovery,
} from "../lib/subscription-discovery";
import { RssFinderLink } from "./RssFinderLink";

export function SubscribePage({ search }: { search: string }) {
  // Isolate form/mutation state when a named popup is reused for a new source.
  return <SubscriptionConfirmation key={search} search={search} />;
}

function SubscriptionConfirmation({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const sourceUrl = params.get("url") ?? "";
  const pageTitle = params.get("title")?.trim() ?? "";
  const valid = isHttpUrl(sourceUrl);
  const discovery = useFeedDiscovery(sourceUrl);
  const folders = useQuery({
    queryKey: qk.folders,
    queryFn: api.folders.list,
    enabled: valid,
    retry: false,
  });
  const subscribe = useSubscribe();
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<"subscribed" | "duplicate" | null>(null);
  const feed = discovery.data?.feed;
  const name = feed?.title?.trim() || pageTitle || feed?.feedUrl;

  function dismiss() {
    setCancelled(true);
    window.close();
  }

  async function confirm() {
    if (!feed || !folders.isSuccess || subscribe.isPending || done || cancelled)
      return;
    setError(null);
    try {
      await subscribe.mutateAsync({
        url: feed.feedUrl,
        title: title.trim() || undefined,
        folderId: folderId ? Number(folderId) : null,
      });
      setDone("subscribed");
    } catch (cause) {
      if ((cause as { status?: number })?.status === 409) setDone("duplicate");
      else setError(cause);
    }
  }

  return (
    <Center mih="100dvh" p="md">
      <Paper withBorder p="lg" w="100%" maw={480}>
        <Stack gap="md">
          <Text size="xs" c="accent" fw={700}>
            Sparkle RSS
          </Text>
          {cancelled ? (
            <Text>Subscription cancelled.</Text>
          ) : done ? (
            <>
              <Title order={2} size="h3">
                {done === "duplicate"
                  ? "Already subscribed to this feed"
                  : "Subscribed!"}
              </Title>
              <Text size="sm">{name}</Text>
              <Button variant="default" onClick={dismiss}>
                Close
              </Button>
            </>
          ) : !valid ? (
            <>
              <Alert color="red" title="Could not find a feed">
                Open the Subscribe bookmarklet on a page with a valid http(s)
                URL.
              </Alert>
              <Button variant="default" onClick={dismiss}>
                Cancel
              </Button>
            </>
          ) : discovery.isPending ? (
            <>
              <Group role="status">
                <Loader size="sm" />
                <Text>Looking for a feed…</Text>
              </Group>
              <Button variant="default" onClick={dismiss}>
                Cancel
              </Button>
            </>
          ) : discovery.isError ? (
            <>
              <Alert color="red" title="Could not find a feed">
                Try again, or use RSSFinder to help locate the feed.
              </Alert>
              {canOfferRssFinder(discovery.error) && (
                <RssFinderLink sourceUrl={sourceUrl} />
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={dismiss}>
                  Cancel
                </Button>
                <Button onClick={() => void discovery.refetch()}>Retry</Button>
              </Group>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              <Stack gap="md">
                <Title order={2} size="h3">
                  Subscribe to {name}?
                </Title>
                <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                  {feed?.feedUrl}
                </Text>
                <TextInput
                  label="Custom title (optional)"
                  maxLength={300}
                  value={title}
                  disabled={subscribe.isPending}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
                <NativeSelect
                  label="Folder"
                  value={folderId}
                  disabled={!folders.isSuccess || subscribe.isPending}
                  onChange={(event) => setFolderId(event.currentTarget.value)}
                  data={[
                    { value: "", label: "— none —" },
                    ...(folders.data?.folders ?? []).map((folder) => ({
                      value: folder.id,
                      label: folder.name,
                    })),
                  ]}
                />
                {folders.isError && (
                  <Alert color="red" title="Could not load folders">
                    <Button size="xs" onClick={() => void folders.refetch()}>
                      Retry folders
                    </Button>
                  </Alert>
                )}
                {error != null && (
                  <>
                    <Alert color="red" title="Could not add feed">
                      Your subscription was not confirmed. Try again.
                    </Alert>
                    {canOfferRssFinder(error) && (
                      <RssFinderLink sourceUrl={sourceUrl} />
                    )}
                  </>
                )}
                <Group justify="flex-end">
                  <Button
                    variant="default"
                    onClick={dismiss}
                    disabled={subscribe.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={subscribe.isPending}
                    disabled={!folders.isSuccess}
                  >
                    Subscribe
                  </Button>
                </Group>
              </Stack>
            </form>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
