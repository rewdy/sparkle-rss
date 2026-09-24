import { Button, Code, CopyButton, Group, Stack, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { buildBookmarklet } from "../lib/bookmarklet";

/**
 * The draggable "read later" bookmarklet, shared by the settings card and the
 * collapsed help section on the save-article form.
 *
 * The link is meant to be dragged to the bookmarks bar rather than clicked:
 * running it here would target our own page, where our CSP blocks it.
 */
export function BookmarkletLink({
  showCode = false,
}: {
  showCode?: boolean;
}): ReactElement {
  const snippet = buildBookmarklet(window.location.origin);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  // React refuses to render a `javascript:` href (it swaps in a throw-stub as
  // a security measure), so the bookmarklet URL is written to the DOM node
  // directly after mount. Dragging reads the DOM href, so this still works.
  useEffect(() => {
    anchorRef.current?.setAttribute("href", snippet);
  }, [snippet]);

  return (
    <Stack gap="xs">
      <Group gap="sm">
        <Button
          ref={anchorRef}
          size="sm"
          variant="default"
          component="a"
          draggable={true}
          onClick={(event) => event.preventDefault()}
        >
          Read later
        </Button>
        <CopyButton value={snippet}>
          {({ copied, copy }) => (
            <Button size="sm" variant="subtle" type="button" onClick={copy}>
              {copied ? "copied" : "copy code"}
            </Button>
          )}
        </CopyButton>
      </Group>
      {showCode && (
        <Code block style={{ overflowX: "auto", fontSize: 11 }}>
          {snippet}
        </Code>
      )}
      <Text size="xs" c="dimmed">
        drag the “Read later” button onto your bookmarks bar. On any page, it
        opens this form in a small window with the address, title, and any
        selected text prefilled.
      </Text>
    </Stack>
  );
}
