# Proposal

## Why

List and Feed currently offer two similar row layouts. Consolidating them into the image-enhanced List frees the selector for a distinct Cards layout while retaining Swipe.

## What Changes

- **BREAKING** Replace the old text-only List layout with today's Feed layout; remove Feed as a selectable presentation.
- Offer exactly List, Cards, and Swipe on eligible article streams. Preserve Saved's dedicated mixed library.
- Migrate stored `feed` preferences to `list`; retain `list` and `swipe`, accept `cards`, and default missing/invalid values to `list`.
- Add date-grouped article cards: three columns at `md` and above, two from `sm` to below `md`, and one below `sm`.
- Use existing authorized article images in a fixed-ratio card media area. Missing or failed images show a restrained theme-colored decorative placeholder; source favicons remain small metadata marks.
- Preserve stream ordering, pagination, filters, read state, notes, reader navigation, and keyboard workflows across presentations.

## Capabilities

### New Capabilities

- `cards-presentation`: Responsive, accessible, date-grouped article cards with authorized imagery, placeholders, and existing reader workflow parity.

### Modified Capabilities

- `feed-presentation`: Promote the image-enhanced row layout to List, remove the Feed choice, and migrate device-local preferences to the List/Cards/Swipe set. Retain the existing capability path to preserve specification continuity.

## Impact

Web-only changes affect `ui-state.ts`, `Topbar`, `EntryList`, `StreamInner`, styles, and presentation/component tests; add a sibling `CardsView`. Reuse React Query entries and signed-URL refresh, Jotai local preferences, and existing reader callbacks. Update frontend/swipe docs, roadmap, and decision log during implementation. No API, Google Reader, database, infrastructure, media-generation, or dependency changes are planned; Swipe and Saved retain their existing behavior.
