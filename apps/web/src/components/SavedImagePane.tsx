import { Button, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../lib/api";
import { qk, viewSearch } from "../lib/keys";
import { useRemoveImage } from "../lib/mutations";
import { useMediaRefresh } from "../lib/saved-queries";

export function SavedImagePane({
  id,
  sort,
  onClose,
  onRemoved,
}: {
  id: string;
  sort: "asc" | "desc";
  onClose: () => void;
  onRemoved: () => void;
}) {
  const query = useQuery({
    queryKey: qk.savedImage(id),
    queryFn: () => api.savedImages.get(id),
    gcTime: 240_000,
    retry: (_count, error) =>
      !(error instanceof ApiError && error.status === 404),
  });
  const remove = useRemoveImage();
  const item = query.data?.item;
  useMediaRefresh(item?.image.urlExpiresAtMs, query.refetch);
  return (
    <Stack p="md" maw={1000} mx="auto">
      <Group justify="space-between">
        <Button variant="subtle" onClick={onClose}>
          back
        </Button>
        {item && (
          <Button
            color="red"
            variant="subtle"
            loading={remove.isPending}
            onClick={() => remove.mutate(id, { onSuccess: onRemoved })}
          >
            remove saved image
          </Button>
        )}
      </Group>
      {query.isPending ? (
        <Loader aria-label="loading saved image" />
      ) : !item ? (
        <Text role="alert">
          {query.error instanceof ApiError && query.error.status === 404
            ? "This saved image is no longer available."
            : "Could not load saved image."}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            retry
          </Button>
        </Text>
      ) : (
        <>
          <img
            src={item.image.url}
            alt={item.image.alt || `Image from ${item.source.articleTitle}`}
            style={{
              maxWidth: "100%",
              maxHeight: "70dvh",
              objectFit: "contain",
            }}
          />
          <Title order={2}>{item.source.articleTitle}</Title>
          <Text c="dimmed">
            {item.source.feedTitle || item.source.siteName} · saved{" "}
            {new Date(item.savedAtMs).toLocaleString()}
          </Text>
          <Group>
            {item.source.articleUrl && (
              <Button
                component="a"
                href={item.source.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="default"
              >
                open original article
              </Button>
            )}
            {item.source.available && (
              <Button
                component="a"
                href={
                  item.source.kind === "entry"
                    ? `/starred/e/${item.source.id}${viewSearch("all", sort)}`
                    : `/read-later/e/${item.source.id}`
                }
                variant="subtle"
              >
                read article
              </Button>
            )}
          </Group>
        </>
      )}
      {remove.isError && (
        <Text role="alert" c="red">
          Could not remove image. Try again.
        </Text>
      )}
    </Stack>
  );
}
