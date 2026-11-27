# Design

## Context

`Shell` clamps reader stepping to the flattened entries cache. `StreamInner` paginates from a scroll sentinel whose observer is disabled while the stream is hidden. Its existing footer already serves readers browsing the List or Cards surface. The frontend requires URL-backed views and one history entry per reader session.

## Goals / Non-Goals

Keep article stepping, completion, and return navigation connected in the reader. Scope the new view to Today, Unread, and All. Out of scope are changes to stream footers, the empty states, other streams, and API contracts.

## Decisions

- **Use the reader pane for completion.** A dedicated pane makes Next and Previous feel like steps in the same sequence. A modal would add dismissal behavior and interrupt that sequence. A synthetic feed row would participate in article collection logic such as grouping, counts, or virtualization, where the message has no article data. Use a small decorative themed icon, a heading, short copy, and a primary “Back to Today,” “Back to Unread,” or “Back to All” link. All already serves as home, so a single channel link is sufficient.
- **Route the end view within the current session.** Use `<channel>/e/<last-id>/end` for the three supported channels, preserving filter and sort. Parse it as a distinct reader view with a previous article anchor. Include it in reader history origin validation and the shell’s reader-open checks so the stream stays mounted, hidden, and inert. Reuse the existing session replace and close behavior. The anchor gives Previous a destination after reload, including when Unread membership changed. Check availability when reopening it and keep the return action usable if it has gone away. Keep article queries and mutations disabled for the end view itself.
- **Advance using the existing infinite query.** Have the shell request the next cursor when forward navigation reaches the loaded boundary. Resolve against the same channel/filter/sort and current reader location, using the fetched pages to determine the next article or exhaustion. Reuse existing article opening for a real successor. Keep a single pending advance per reader location, surface progress and a retry on failure, and follow additional cursors when pages supply no successor. A separate request path would duplicate cursor and cache handling.
- **Handle missing anchors conservatively.** If a deep-linked, filtered, or refreshed article is absent from the loaded sequence, retain the existing navigation fallback until the reader can establish the article’s position. Cache absence alone is insufficient to establish the final position.

## Risks / Trade-offs

- **Late pagination or repeated input** → Deduplicate forward requests and verify the reader location and channel query key before navigating. Ignore stale completions after return, previous, or channel changes.
- **Changing Unread membership** → Keep the article anchor independent of stream membership on the end route. Apply the existing return behavior when the last viewed row has disappeared.
- **Keyboard focus when replacing the pane** → Focus the end heading, use native activation for the return link and Previous control, and verify focus and readability on mobile and desktop.
