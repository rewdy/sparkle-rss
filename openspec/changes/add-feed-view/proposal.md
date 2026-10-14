# Proposal

## Why

The compact List view makes headlines easy to scan but leaves existing article imagery unused. Feed adds visual context while retaining the familiar date-grouped list and reading workflow.

## What Changes

- Add a third device-local presentation, Feed, alongside List and Swipe wherever the existing presentation selector applies.
- Show a compact right-hand thumbnail from existing `articleImage` metadata, with source, author, time, headline, and existing read-later notes retained.
- Keep rows without usable imagery text-only, with no empty image slot or enlarged favicon.
- Keep every headline and metadata block on the same left text axis, regardless of thumbnail presence; thumbnails occupy only the right side.
- Preserve filtering, sorting, date grouping, virtualization, pagination, keyboard actions, and route-backed article opening. Existing users retain their selected presentation; List remains the fallback.
- Include responsive light/dark visual review and layout refinement as implementation acceptance work.
- Saved remains its dedicated mixed article/image list. No new ingestion, thumbnail generation, account setting, or API behavior is introduced.

## Capabilities

### New Capabilities

- `feed-presentation`: An image-enhanced, date-grouped stream list with device-local selection, graceful image fallback, and existing reader behavior.

### Modified Capabilities

None. The only current main capability is user authentication, which is unaffected.

## Impact

Frontend only: `ui-state.ts`, `Topbar`, `StreamInner`, `EntryList`, relevant CSS and web tests. Reuse existing entry queries, signed media URLs, expiry refresh, subscription metadata, and navigation callbacks. Update frontend documentation, swipe-view documentation, roadmap, and decision log when implementation lands. No database, Terraform, dependency, or Google Reader contract changes are expected.
