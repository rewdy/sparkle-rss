import {
  Alert,
  Box,
  Button,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { LuCircleAlert, LuCircleCheck, LuClock } from "react-icons/lu";
import { useLocation, useSearch } from "wouter";
import { ApiError } from "../lib/api";
import { useSaveReadLaterUrl } from "../lib/mutations";

/**
 * How the save form is being shown:
 * - `page`: the in-app route (/read-later/new), opened from the read-later
 *   stream's add button. Gets the explanatory copy, and opens the saved item so
 *   the extracted article is the confirmation.
 * - `popup`: the same form as the bookmarklet's window. No app chrome and no
 *   explanatory copy; it confirms in place instead of navigating, because the
 *   window is small and the user is done with it. The prefilled URL, title, and
 *   selected text arrive as query params (`?url=&title=&excerpt=`).
 */
export type SaveArticleVariant = "page" | "popup";

export function SaveArticleForm({
  variant,
}: {
  variant: SaveArticleVariant;
}): ReactElement {
  const popup = variant === "popup";
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const [url, setUrl] = useState(params.get("url") ?? "");
  const [title, setTitle] = useState(params.get("title") ?? "");
  const [excerpt, setExcerpt] = useState(params.get("excerpt") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const save = useSaveReadLaterUrl();

  const submit = useCallback(
    async (input: { url: string; title?: string; excerpt?: string }) => {
      setError(null);
      try {
        const { item } = await save.mutateAsync(input);
        setSavedId(item.id);
        if (!popup) navigate(`/read-later/e/${item.id}`);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e.status === 400
              ? "that address can't be saved. Check the link and try again."
              : "the article could not be saved. Try again."
            : "the article could not be saved. Try again.",
        );
      }
    },
    [navigate, popup, save],
  );

  if (popup && savedId) {
    return (
      <Box maw={360} mx="auto" p="lg">
        <Stack gap="md" align="center">
          <LuCircleCheck size={28} />
          <Title order={3}>saved</Title>
          <Text size="sm" c="dimmed" ta="center">
            This article is in your read later queue.
          </Text>
          <Button fullWidth={true} type="button" onClick={() => window.close()}>
            close
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      component="form"
      maw={640}
      mx="auto"
      p="lg"
      onSubmit={(event) => {
        event.preventDefault();
        if (url.trim() === "") return;
        void submit({
          url,
          title: title || undefined,
          excerpt: excerpt || undefined,
        });
      }}
    >
      <Stack gap="sm">
        <Group gap="xs">
          <LuClock size={18} />
          <Title order={2}>read later</Title>
        </Group>
        {!popup && (
          <Text size="sm" c="dimmed">
            Paste a link to keep it for later. We fetch a readable copy when the
            site allows it; otherwise the original stays linked.
          </Text>
        )}

        <TextInput
          label="address"
          placeholder="https://example.com/article"
          required={true}
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
        <TextInput
          label="title"
          description={
            popup ? undefined : "optional; taken from the page when left empty"
          }
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Textarea
          label="note"
          description={
            popup ? undefined : "optional; quoted text or a reminder"
          }
          rows={3}
          value={excerpt}
          onChange={(event) => setExcerpt(event.currentTarget.value)}
        />

        {error && (
          <Alert color="red" variant="light" icon={<LuCircleAlert size={16} />}>
            {error}
          </Alert>
        )}

        <Group gap="sm">
          <Button type="submit" loading={save.isPending}>
            save
          </Button>
          <Button
            variant="default"
            onClick={() => navigate("/read-later")}
            type="button"
          >
            cancel
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
