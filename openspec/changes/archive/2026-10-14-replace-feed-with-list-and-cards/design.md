# Design

## Context

See proposal.md for motivation. `EntryList` currently branches between text-only List and image-enhanced Feed, using one dynamically measured virtual list. `StreamInner` owns the entry query, signed-URL expiry refresh, nested scroll container, and pagination sentinel; Swipe uses `StoryView`. `Topbar` and `ui-state.ts` expose `list | feed | swipe`. Saved has a separate mixed library and hides the selector. The existing `feed-presentation` specification explicitly protects the old List; this change intentionally replaces that contract through its delta.

## Goals / Non-Goals

**Goals:** Reuse the Feed row behavior as List, add a bounded responsive card grid, and share entry data/navigation rather than duplicate stream logic. Maintain a consistent ordered browsing experience through resize and reader navigation.

**Non-Goals:** Change Swipe physics or routes, redesign Saved, generate image derivatives, fetch additional imagery, introduce masonry ordering, add card action menus, or change server contracts.

## Decisions

### Consolidate List and normalize local preferences

Make the image-enhanced `EntryList` the only List rendering path, including its native button rows, no-image text-only fallback, rounded measurements, and thumbnail skeletons. Remove its presentation branch rather than keep an unreachable compact layout. Change the public union and selector to `list | cards | swipe`. Normalize legacy `feed` at local-state initialization and persist only the changed preference using the existing patch helper, preserving other keys and tolerating unavailable storage. Do not accept `feed` as an active mode or send this preference to account settings. Keeping a hidden Feed alias would prolong two names for the same behavior.

### Add a sibling CardsView and reuse StreamInner

`CardsView` receives entries, loading, active ID, selection callback, and the existing scroll ref. `StreamInner` chooses List/Cards/Swipe while retaining one React Query cache, expiry timer, sentinel, and end-of-stream footer. Reuse `groupByDay`, `timeLabel`, subscription metadata, and `EntryMeta`. Use native button card activation with decorative images and no nested interactive controls. Preserve full wrapping titles and existing notes; no article HTML rendering or new excerpt extraction. Keep `onSelect` as the sole opening path so mark-on-open and route parameters remain shell-owned.

### Virtualize grouped grid rows

Use the existing virtualizer library with a flattened model of full-width date headers and rows containing up to the current column count of entries, restarting rows at each date group. Each measured row uses a CSS grid with equal-width columns; the tallest card sets row height. This preserves reading order and bounds mounted imagery, unlike mounting every loaded card or masonry columns. Use stable keys, modest overscan, rounded dynamic measurements, and a mapping from entry ID to row index for active-entry scrolling.

Use the active Mantine theme's viewport `sm` and `md` breakpoints for both the column-count logic and rendered grid: base=1, sm=2, md=3. The current theme inherits default breakpoint values. Rebuild and remeasure rows when columns or available scroller width change, including sidebar/reader layout changes; retain the first visible article as an anchor through regrouping when possible. Do not increase past three columns on larger screens. The grid must fit its available pane even when a wide viewport includes a sidebar or reader.

Retain a focused card row in the virtual range while focused. When Tab or Shift+Tab would cross a mounted boundary, mount/scroll the next logical card before transferring focus; leave the grid normally at its first/last card. Verify in a real browser because jsdom cannot validate virtual scrolling. Reader j/k remains based on flat stream order, not visual column position.

### Keep a consistent media slot

Use a reserved 16:9 top media area with `object-fit: cover`, lazy loading, and async decoding. Track failures by URL so refreshed signatures retry. Missing/failed media uses a quiet theme surface with a small decorative existing icon, hidden from assistive technology. This avoids blank card tops changing geometry and requires no generated assets or network requests. Omitting the media area was considered, but would produce uneven visual rhythm; enlarged favicons were rejected because source identity belongs in metadata. List continues to omit missing thumbnail slots.

### Keep existing history and Saved boundaries

Do not add Cards routes. Existing article selection and Back/Escape behavior remain authoritative; scroll the active card into view after reader navigation when it is still in loaded data. Presentation switching does not mutate read state. Saved keeps its dedicated renderer and preserves the local selection. Swipe's story-index route behavior remains unchanged.

## Risks / Trade-offs

- Original stored images can cost more bandwidth in Cards → Bound mounted rows and use lazy loading; reuse expiry refresh. Derivatives remain a separate project.
- Variable title/note heights and regrouping can shift scroll or overlap rows → Measure row heights, reserve media ratio, remeasure on width changes, and exercise long titles and breakpoint transitions in browser QA.
- Virtualization can interrupt keyboard focus → Pin the focused row and explicitly verify traversal across the mounted range in both directions.
- Three viewport-based columns may become narrow beside the reader/sidebar → Use shrinkable tracks and wrapping content; review desktop pane combinations and 320px mobile layout.
- Removing compact List changes users' existing preference appearance → Preserve the `list` key, document the deliberate layout replacement, and normalize old `feed` to it.

## Migration Plan

Deploy through the normal web pipeline after focused tests, lint, typecheck, build, and browser QA. No schema or backend migration is needed. Existing `list`, `swipe`, and invalid preferences resolve synchronously before first paint; legacy `feed` becomes `list`. Returning from Saved leaves the preference intact. Rollback restores the previous web bundle: `list`/`swipe` remain accepted and a stored `cards` value falls back to the old List; the original Feed choice cannot be inferred after normalization.
