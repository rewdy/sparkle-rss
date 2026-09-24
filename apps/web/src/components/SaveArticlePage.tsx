import {
  Accordion,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCircleAlert, LuClock } from "react-icons/lu";
import { useLocation, useSearch } from "wouter";
import { ApiError } from "../lib/api";
import { useSaveReadLaterUrl } from "../lib/mutations";
import { BookmarkletLink } from "./BookmarkletLink";

/**
 * Adds an article to the read later queue by URL. Reachable directly
 * (/read-later/new), from the read-later stream's add button, and from the
 * bookmarklet, which opens it in a small window with the page's URL, title, and
 * selected text prefilled (`?url=&title=&excerpt=&auto=1`).
 */
export function SaveArticlePage(): ReactElement {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const [url, setUrl] = useState(params.get("url") ?? "");
  const [title, setTitle] = useState(params.get("title") ?? "");
  const [excerpt, setExcerpt] = useState(params.get("excerpt") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const save = useSaveReadLaterUrl();
  const inPopup = typeof window !== "undefined" && Boolean(window.opener);

  const submit = useCallback(
    async (input: { url: string; title?: string; excerpt?: string }) => {
      setError(null);
      try {
        const { item } = await save.mutateAsync(input);
        setSavedId(item.id);
        // Opening the saved item is the confirmation: it shows the extracted
        // copy, or the original link when extraction was not possible.
        navigate(`/read-later/e/${item.id}`);
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
    [navigate, save],
  );

  // Bookmarklet flow: submit once, as soon as the prefilled form is mounted.
  const autoSubmitted = useRef(false);
  const auto = params.get("auto") === "1";
  useEffect(() => {
    if (!auto || autoSubmitted.current || url.trim() === "") return;
    autoSubmitted.current = true;
    void submit({
      url,
      title: title || undefined,
      excerpt: excerpt || undefined,
    });
  }, [auto, url, title, excerpt, submit]);

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
        <Text size="sm" c="dimmed">
          Paste a link to keep it for later. We fetch a readable copy when the
          site allows it; otherwise the original stays linked.
        </Text>

        <TextInput
          label="address"
          placeholder="https://example.com/article"
          required={true}
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
        <TextInput
          label="title"
          description="optional; taken from the page when left empty"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Textarea
          label="note"
          description="optional; quoted text or a reminder"
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
          {inPopup && savedId && (
            <Button
              variant="subtle"
              type="button"
              onClick={() => window.close()}
            >
              close window
            </Button>
          )}
        </Group>

        {/* Collapsed by default: most saves are typed or pasted, and the
            bookmarklet only needs setting up once. */}
        <Accordion variant="separated" mt="xs">
          <Accordion.Item value="bookmarklet">
            <Accordion.Control>
              <Text size="sm">save articles with one click</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <BookmarkletLink />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Box>
  );
}
