# Proposal

## Why

Readers can save articles but cannot keep individual images they discover while reading. Saving a private copy with its source attribution makes those images available alongside saved articles even when the original source disappears.

## What Changes

- Add image save controls in feed and read-later article content: hover/focus on desktop, visible on touch, with pending, saved, and retry feedback.
- Copy the selected image into private media storage and snapshot article/feed provenance; preserve explicit saves after unsubscribe or read-later removal.
- Expand the web Saved view into one cursor-paged timeline of starred articles and image thumbnails, ordered and grouped by save time, newest first by default.
- Add a route-backed image preview with attribution, source links, and removal. Saving an image does not star the article or add it to read later.
- Make repeated saves of the same source image idempotent and keep storage access user-scoped.
- Keep existing article starring and Google Reader behavior intact; image saves exist only on `/api/v1`.

## Capabilities

### New Capabilities

- `saved-article-images`: Capture, privately store, attribute, retain, preview, and remove images selected from owned articles.
- `saved-library`: Interleave existing starred articles and saved image thumbnails in the web Saved timeline with consistent chronology and navigation.

### Modified Capabilities

None. The only existing OpenSpec capability is `user-auth`; this change uses its existing authentication.

## Impact

Changes will touch the DSQL-safe media schema/migrations, core media and saved-library services, feed cleanup paths, `/api/v1` routes and service wiring, React reader/list/routing/query mutations, and API Lambda S3 write permissions in Terraform. Existing private S3 storage and immutable content hashing are reused. Design/data-model/frontend/local-development docs, roadmap, and the decision log will be updated during implementation. No Google Reader API extensions, standalone image uploads, image search, collections, generated thumbnail pipeline, automatic read-later hero persistence, or article-retention redesign are included.
