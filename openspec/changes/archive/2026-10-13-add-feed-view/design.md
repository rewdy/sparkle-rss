# Design

## Context

See proposal.md for motivation. `StreamInner` already owns a shared infinite entry query, signed-image expiry refresh, scroll container, and pagination sentinel. `EntryList` provides dynamically measured virtual rows with date headers, source metadata, read-state typography, and read-later notes. `StoryPresentation` currently accepts List/Swipe and persists in `sparkle.ui.storyPresentation`. `Topbar` exposes that selector except on Saved, which renders `SavedList` independently.

Only user-auth exists as a main OpenSpec capability. Existing frontend and swipe documentation describes two modes; implementation must update that description rather than reinterpret Feed as a new subscription stream. Article images already exist in entry payloads; automatic images for saved off-feed URLs remain outside scope.

## Goals / Non-Goals

**Goals:** Share the list machinery, maintain a stable left text axis, and add a modest image preview without introducing a second data or navigation system. Give implementation a concrete visual starting point and verify it with representative content.

**Non-Goals:** New image selection, backfill, generated thumbnail assets, summaries extracted from HTML, full-width image cards, image saving controls on thumbnails, changes to Saved, or account-synced presentation preferences.

## Decisions

### 1. Text left, thumbnail right

Use the existing row padding for all Feed rows. A flex/grid text column starts at exactly the same horizontal coordinate with or without imagery. Give the text column `min-width: 0`; the optional right image column never affects its start position. Metadata stays above the headline within that column, time stays in the metadata row, and existing notes remain below the headline.

Initial visual target: a 96×72 CSS-pixel landscape thumbnail on desktop and 72×72 on small screens, about 12px between text and image, subtle corner rounding, and `object-fit: cover`. Images align near the top of the row; headlines wrap naturally rather than adding a new truncation rule. No-image rows recover the right column's width. Preserve existing unread weight, hover, and active styling; do not fade thumbnails to communicate read state.

```text
Today · 12
Source · Author                 10:24     ┌─────────┐
Headline begins here and wraps as needed  │  image  │
                                         └─────────┘
Source · Author                                      10:18
Headline begins at the exact same left coordinate
```

The user's explicit alignment requirement applies to both headline and metadata, including failed images. Left thumbnails were rejected because optional images would indent only some titles. A reserved left image slot was rejected because it wastes space in text-heavy feeds. Full-width cards would change the requested list character. The numerical image sizes are starting values, adjustable during visual review while retaining these invariants.

### 2. Add a presentation variant to the shared list

Extend `EntryList` with a List/Feed presentation prop defaulting to List; pass it through to the row and skeleton. Keep List markup/styles stable. Feed uses the same date flattening, virtualizer, measured row ref, and onSelect callback. Feed's estimates can depend on image presence and breakpoint, but measured height remains authoritative. Re-measure when presentation changes so thumbnail-height estimates do not leave gaps or overlaps. A separate duplicated Feed list would risk pagination and grouping drift.

Use a real keyboard-activatable row surface for Feed, with visible focus and decorative `alt=""` thumbnails. Clicking the thumbnail invokes the same article activation; it adds no independent control. Scope semantic/layout changes carefully so shared components do not alter List visually.

### 3. Extend the existing local preference compatibly

Add `feed` to the presentation union, prop contracts, selector options, and initialization validation. Preserve the `sparkle.ui.storyPresentation` key and existing exported names for a small additive change. Accept all three values and fall back to List otherwise; keep server settings unable to overwrite this local choice. Selector order is List / Feed / Swipe, styled consistently with current lowercase chrome.

At narrow widths, fit all three options by reducing responsive header gaps/padding or collapsing the brand wordmark to its existing sparkles mark with an accessible name. Preserve labeled mode choices and navigation/refresh/theme access. Do not hide Feed on phones or add horizontal header scrolling.

Saved continues to bypass the selector and stream presentation. Eligible streams include Read later, where only existing articleImage values can produce thumbnails.

### 4. Reuse image delivery and query ownership

Render only `articleImage.url`, with lazy loading, asynchronous decoding, and explicit dimensions. A pending thumbnail retains its reserved rectangle so completion does not change row height. On error remove that image slot and restore the full-width text row; dynamic measurement accommodates resulting text wrapping changes. Track failure by URL rather than entry ID so a renewed signature gets another chance. Keep failure state local to mounted rows and reset safely when the row identity or URL changes.

Continue the existing expiry-aware query refresh and shared entry cache. Do not introduce thumbnail fetch endpoints or high fetch priority across all visible rows. The existing list overscan can mount extra rows, but virtualization and lazy loading bound image work. Original-sized image delivery is accepted for this first version; generated derivatives would require a separate media change.

### 5. Keep existing stream routes and actions

Feed uses ordinary stream and `/e/:id` routes, with existing filter/sort query parameters. No `/feed-view` route is needed. Switching presentation does not mutate read state or query keys. Existing `/story/:index` URLs remain accepted: Feed treats the story suffix as inactive navigation metadata, matching current List behavior, and ordinary article links return through existing history handling. Do not add a separate scroll restoration contract; current list remount behavior remains the baseline.

Update the end-of-stream condition from List-only to both non-Swipe modes. Reuse empty text and provide a Feed skeleton with aligned text bars and right-hand image rectangles.

## Risks / Trade-offs

- [Large originals cost bandwidth] → Lazy load only mounted rows; document that this is display sizing, not generated thumbnails.
- [Mixed row heights or image failures destabilize virtualization] → Reserve loading dimensions, retain element measurement, re-measure presentation changes, and check long-stream scrolling with actual browser geometry.
- [Long metadata and a third selector crowd phones] → Use shrinkable text columns and responsive header spacing; verify 320, 390, 768, and 1440 CSS-pixel viewports.
- [Cropping removes useful image context] → Review landscape, portrait, square, and very wide images; adjust the initial dimensions/crop within the right-hand-thumbnail design.
- [Read-later URLs often have no stored image] → Render clean text-only rows; no new image ingestion is implied.

## Migration Plan

Deploy through the normal frontend pipeline after targeted tests, lint, typecheck, web build, and browser visual acceptance. No data migration or infrastructure rollout is needed. Retain existing local preferences. Rollback restores the two-mode frontend; its current parser safely treats a persisted `feed` value as List.

## Open Questions

- Exact thumbnail sizes and spacing can be refined from browser screenshots without changing scope or the shared left-axis requirement.
