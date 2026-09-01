# 09 — Swipe Story View (Planning)

This document plans an alternative presentation for stream/listing pages. The existing
standard list remains unchanged; users can switch between it and a full-screen,
TikTok-inspired story viewer on each device.

## Product decisions

- The header contains a toggle between `list` and `swipe` presentation.
- The selected presentation is stored in device-local storage, not account settings.
  A user may therefore use swipe mode on a phone and list mode on a desktop.
- The active story position is navigation state: story 0 uses the ordinary stream URL,
  and later stories use `<stream>/story/<zero-based-index>`. Query filters remain in the
  URL, so refresh and browser back/forward restore the viewed story when the same stream
  data is available.
- Swipe up advances to the next entry in the current list order (normally older); swipe
  down moves to the previous entry (normally newer).
- Swiping past an article does not mark it read. Activating `Read` uses the existing
  article route and honors the existing `markReadOnOpen` preference.
- Near the end of a loaded page, the view fetches the next cursor page. At the true end,
  navigation stops with a subtle end-of-list state.
- The swipe view uses a real vertical scroll container with CSS scroll snapping. Touch
  swipes, mouse-wheel scrolling, trackpad gestures, and keyboard scrolling therefore use
  the same interaction model; the browser owns the gesture physics.

## Story presentation

Each story occupies the viewport. The initial design is intentionally simple so real
downloaded images can be evaluated before visual refinement:

```text
┌──────────────────────────────┐
│                              │
│          hero image          │
│                              │
│       author · source        │
│          publish time        │
│          headline            │
│            Read              │
│                              │
└──────────────────────────────┘
```

Text is centered over or below the image according to the first visual prototype. The
implementation must preserve readable contrast with an overlay/scrim or theme surface.
Hero images use the existing downloaded article image, rendered with lazy loading and
safe `object-fit` behavior. The swipe view does not render article HTML.

### No-hero fallback

When an entry has no qualifying hero image, use the same story layout with a theme
background and show the feed favicon next to the feed/blog title when one exists. The
favicon source is the existing subscription `iconUrl`, which may be empty for some feeds.
If no favicon exists, reserve no broken-image space and render the source title as text.

The favicon is a small source-identity mark only; it must never be enlarged, stretched,
or used as the story's hero/background image.

Do not use a domain-favicon fallback in this view unless the product explicitly chooses
that later; the fallback should reflect only imagery already known to Sparkle RSS.

## Frontend architecture

Add a sibling component rather than modifying the existing list behavior:

- `StoryView` owns the full-screen scroll-snap surface; the stream route owns the current
  story index so it survives refresh and participates in browser history.
- `StreamInner` or the stream shell chooses `EntryList` versus `StoryView` based on a
  local presentation atom.
- `Topbar` owns the visible toggle control but not the story state.
- TanStack Query remains the source of entries, subscriptions, and pagination.
- Jotai owns only the local presentation preference and transient gesture state.

Suggested local state:

```ts
type StoryPresentation = "list" | "swipe";
const storyPresentationAtom = atomWithStorage<StoryPresentation>(
  "sparkle.storyPresentation",
  "list",
);
```

Use the repository's existing `sparkle.ui` storage convention if that proves preferable;
the key requirement is that this value is local-only and never sent through
`user_settings`.

The existing route-derived open-entry behavior remains authoritative. Clicking `Read`
navigates to `<stream>/e/:id` using the existing `openEntry` path. Returning with Back or
Escape returns to the stream/story route that opened the article and preserves the
selected presentation.

## Entry and feed data contract

The server stores hero media, and the web `Entry` DTO exposes the associated media ID as
nullable metadata:

```ts
articleImage: {
  id: string;
  width: number;
  height: number;
  alt: string;
} | null;
```

The browser should render `/api/v1/media/{id}` as the image URL. That endpoint already
owns authorization and redirects to private S3 through a short-lived presigned URL.

The swipe surface keeps the full entry result in the React Query cache but mounts only
through the active story plus the next two stories. The active and immediately next
hero images receive high fetch priority; other mounted images remain browser-lazy.

The source title and favicon should come from the existing subscription query, keyed by
`feedId`. Do not duplicate feed metadata into the entry row or account settings.

## Gesture behavior

Use the browser's native scrolling and snapping rather than a custom gesture state machine:

```text
wheel/touch/trackpad/keyboard input
  → native vertical scroll
  → CSS scroll snap settles on one full-screen story
  → IntersectionObserver identifies the settled story
  → route updates to the story index
```

The story container should use `scroll-snap-type: y mandatory`, each story should use
`scroll-snap-align: start` and `scroll-snap-stop: always`, and vertical overscroll should
be contained within the story surface. Do not cancel wheel events or implement a second
pointer-drag animation layer.

The story index is derived from the currently flattened entry list. When the active index
approaches the final loaded entry, request the next cursor page and append entries without
resetting the current story.

## Read-state behavior

- `Read` calls the existing `openEntry` callback.
- If `markReadOnOpen` is enabled, the current mutation marks the story read before route
  navigation, matching standard list behavior.
- If disabled, opening the article does not mark it read.
- Swiping alone never changes read state.
- Returning to the stream uses the existing react-query cache/mutation invalidation, so
  the story's read styling is current when the swipe view reappears.

## Accessibility and failure states

- The active story has a meaningful accessible label containing headline and source.
- `Read` is a real button/link with visible focus.
- Announce story changes through a polite live region without announcing every pointer
  movement.
- Provide keyboard controls for previous/next, Read, and close.
- Show loading and end-of-stream states without leaving an empty viewport.
- If an image fails in the browser despite successful ingestion, retain the no-hero
  surface and favicon fallback rather than displaying a broken image.

## Implementation phases

1. Extend the entry API/service projection with authorized article-image metadata and
   add API/client contract tests.
2. Add the device-local presentation atom and header toggle. Verify standard list output
   is unchanged and the preference survives reload without affecting another device.
3. Build the static `StoryView` card using real entry data, hero images, source title,
   favicon fallback, headline, time, and Read navigation.
4. Add touch/pointer/keyboard navigation, transition guards, pagination-at-the-end, and
   end-of-stream handling.
5. Add focused component tests plus manual mobile/desktop verification at common
   viewport sizes, including entries with hero images, no images, and missing favicons.
6. Refine visual treatment after inspecting real production image samples; keep that
   refinement separate from the interaction foundation.

## Exit criteria

- List mode is pixel- and behavior-compatible with the current implementation.
- Swipe/list selection is device-local and survives reload.
- Swipe up/down navigation is deterministic and paginates correctly.
- Read navigation and read-state behavior match the current setting.
- Hero images render when available; no-hero stories show the feed favicon when present.
- No image or favicon produces a broken-image artifact.
- Keyboard, touch, mouse, and browser Back/Escape paths work.
- API authorization prevents cross-user media access.
