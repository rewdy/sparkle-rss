# Design

## Context

See proposal.md for motivation and the two delta specs for behavior. `media_objects` already stores immutable content-addressed binaries and `user_media` stores scoped associations. `createMediaService` currently only attaches splashes. Article starring uses `user_entries.starred_at`, and the shared entry service also serves Google Reader. The web Saved route currently uses that article stream. `ReaderPane` renders sanitized HTML and post-processes its images through a content ref.

Observed gaps: both subscription deletion and orphan-feed cleanup delete media associations indiscriminately; API IAM grants only S3 reads; the splash fetcher buffers before checking actual size and follows redirects automatically. Doc 08 is partly historical planning and does not establish implemented security or garbage collection. Read-later URL content is available as sanitized HTML; its optional remote hero is not rendered in ReaderPane.

## Goals / Non-Goals

**Goals:** Reuse immutable media and scoped authorization, enforce bounded user-triggered fetching, preserve existing starred state, and make mixed pagination deterministic.

**Non-Goals:** A second article-storage model, synchronizing images to native clients, background image extraction, automatic hero persistence, generated thumbnails, or changing current starred-article retention. This version retains orphan binary objects as the current implementation does; general physical garbage collection is a separate lifecycle change.

## Decisions

### 1. Saved images are durable associations with source snapshots

Extend `user_media` for `kind='saved_article_image'` with nullable read-later source ID, dedupe hash, saved timestamp, image source URL, source identity, article title/URL, feed ID/title/URL, and site name. Keep existing columns compatible for splash rows. Use association ID as saved-image ID; `media_objects.id` remains the delivery identity. The association snapshot, not globally shared `media_objects.source_url`, is authoritative attribution.

Use a plain unique `(user_id, kind, dedupe_hash)` index; splash rows keep null dedupe hashes. Add ascending `(user_id, kind, saved_at, id)` and read-later-source indexes. Migrations have no FKs, partial indexes, or DESC keys. Store source IDs as historical references and tolerate absent rows; no destructive cascade is needed. Guard both unsubscribe and orphan-feed cleanup with `kind='article_splash'`. A separate saved-images table would duplicate association ownership and delivery joins; extending the anticipated media kind fits doc 08.

### 2. Authorize the selected image against stored source content

`POST /api/v1/saved-images` accepts `{source:{kind:'entry'|'read-later',id:string}, imageUrl:string}`. Resolve and authorize the source, derive attribution server-side, and match the normalized selected URL to supported `<img src>` URLs in the stored sanitized content. Resolve relative/protocol-relative URLs against the article URL, consistently in server and browser; do not add srcset behavior that the sanitizer currently strips. An existing authorized splash can be reused only when it belongs to the selected source. Feed-sourced read-later items use the underlying entry identity when it exists, so saving through either view does not duplicate it; otherwise use the retained read-later identity/content. Reject arbitrary URLs rather than building a generic image-download endpoint.

Source identity plus resolved image URL, hashed with SHA-256, forms the per-user dedupe key. Preserve URL query strings; they can select different images. Repeated saves return the original row and time. Removing then saving creates a fresh association/time. Different articles may retain separate provenance even when their bytes are identical.

### 3. Fetch the explicit selection with resource and network limits

Add a bounded binary fetch/inspection helper separate from splash heuristics. Reuse and strengthen public-address validation from article fetching, covering literal IPv4/IPv6 and mapped IPv6, URL credentials, and DNS rebinding by validating the actual connection destination (for example a validated DNS lookup on the HTTP dispatcher). Validate every redirect and cancel redirect bodies. Apply one overall 10-second fetch deadline, five redirects, a streaming 5 MiB cap, header/magic format agreement, and dimensions capped at 40 megapixels and 16,384 per axis. Support existing raster formats; reject SVG and malformed files. Do not apply the splash minimum size or avatar/logo filter to explicit saves. Retain bytes and animation without transcoding. Tests inject fetching and resolution/transport boundaries.

Perform the bounded save inline and return only after object upload and association persistence. Reuse immutable content hashes for objects; use conditional S3 creation and database conflict handling so concurrent uploads never overwrite a stored object. Existing source-authorized objects can bypass refetch. Concurrent association insertion uses the unique key and returns the winner. Failed uploads create no saved association; uploaded bytes without an association remain reusable/orphaned under existing retention. Automatic ingestion can continue using its selector without changing which splashes qualify.

### 4. A dedicated web saved-library endpoint keeps article services compatible

Add `GET /api/v1/saved?limit=&cursor=&sort=asc|desc`. A core saved-library service returns a discriminated union `{kind:'article',id,savedAtMs,entry}` or `{kind:'image',id,savedAtMs,image,source}` and `nextCursor`. Query a user-scoped UNION ALL of starred entries and saved-image associations, ordered by `(saved timestamp, kind, typed item ID)`. Compare article IDs numerically and image IDs as UUIDs; define fixed kind order and reverse all comparisons for ascending order. Apply cursor predicates to each branch before merge, then one bounded global limit+1; never fetch independent pages and concatenate them.

Use a dedicated versioned cursor containing stream scope, direction, timestamp, kind, and ID. Preserve database timestamp precision in the cursor (including existing article values) rather than truncating to DTO milliseconds; parenthesize disjunctions to preserve user scope. Serialize UI timestamps to milliseconds. Reject wrong-scope/direction cursors. Hydrate only the selected page, then reuse authorized media signing and renewal behavior. Existing `/entries?stream=starred` and all Google Reader routes remain article-only. This avoids creating another starred-state table or modifying native-client ordering.

### 5. API detail, removal, and frontend state

Add `GET /saved-images/:id`, `GET /saved-images?sourceKind=&sourceId=` for reader save-state lookup, and `DELETE /saved-images/:id`. List/detail responses include dimensions, alt, source snapshot, saved time, media ID, short-lived signed URL, and its expiry. Owner checks precede URL signing. Removal deletes only the owner's saved-image association and returns 204; missing or foreign associations return 404, including repeat deletion, consistently with the ownership spec. Subsequent detail is 404. Existing authorized media delivery remains reusable; issued signed URLs last only their existing expiry.

React Query owns source save-state queries, library pages, detail, and mutations. Show pending immediately but do not insert a successful thumbnail before persistence. On success invalidate library/source queries; on removal reconcile them and navigate from a deleted preview back to Saved. Article-star mutations also invalidate the library. Refresh signed delivery URLs through the existing expiry pattern. Jotai holds no saved payloads.

Enhance reader DOM post-processing with idempotent app-owned image control hosts and React controls/portals. Keep buttons outside publisher anchors, preserve layout/captions/links, and stop activation propagation. Clean up on article/content changes and unmount; react to contentHtml changes even if ID is unchanged. Accessible labels, Enter/Space activation, focus visibility, and coarse-pointer controls are required.

The existing Saved URL remains the entry point, but uses a dedicated mixed virtualized list grouped by `savedAtMs`. Image rows use bounded object-fit:contain thumbnails from stored originals; article rows reuse existing row presentation. Add `/saved/images/:id` (or the corresponding existing Saved base path) to route parsing, with preview fetched independently and back/forward behavior preserved. Image preview shows source snapshot, external article link, internal article link only when available, and remove action. Article keyboard navigation skips image rows; image previews do not run mark-read, article star/read-later shortcuts, or article story presentation. Saved uses the mixed list presentation; hide its swipe toggle and normalize Saved story URLs to its list so thumbnails are never interpreted as articles. Feed/read-later swipe views remain unchanged.

### 6. Storage permissions and lifecycle

Terraform grants the API Lambda scoped `s3:PutObject` on the media prefix in addition to existing reads; retain private bucket policy and local S3 endpoint support. No manual AWS resources or production apply are needed. Binary garbage collection is explicitly deferred: removal revokes association access but does not physically erase unreferenced bytes. Any future janitor must preserve objects referenced by any media kind. This avoids unsafe inline deletion races across globally deduplicated objects.

## Risks / Trade-offs

- [Original-sized thumbnails cost bandwidth] → Lazy loading and bounded display sizes; derivative generation is deferred.
- [Remote hotlink protection or removed source] → Show retryable failure; never fall back to a remote-only saved record.
- [Source deletion races with save] → Validate and snapshot before insertion; an explicit save stays independent once committed, even if its reference disappears.
- [Duplicate uploads and partial persistence] → Immutable conditional puts, unique keys, retryable operations, and no success until association commit.
- [Stored orphan bytes grow] → Document current retention and storage cost; do not claim physical removal until a separate race-safe janitor is implemented.
- [DOM enhancement disrupts linked images] → Test anchors, figures, layout, rerenders, cleanup, and keyboard interaction.
- [Cursor precision and mixed IDs] → Dedicated scoped cursor, preserved database precision, and tie-boundary/isolation integration tests.
- [DNS checks alone leave rebinding exposure] → Bind public-address validation to actual connection resolution and test redirects and encoded IPv6 addresses.

## Migration Plan

Deploy additive migrations and scoped API write permissions before enabling new reader/library UI through the existing CI pipeline. No existing starred rows or splash rows require rewrite. Confirm DSQL migration syntax and integration behavior locally, then deploy backward-compatible API and frontend. Rollback disables/reverts the new frontend while retaining the service media-cleanup protections and additive schema. Reverting the old unsubscribe/orphan cleanup would discard saved associations; do not reverse migrations or delete saved data. Update docs 03, 05, 07, 08, 10, roadmap, and decisions with actual behavior and the explicit binary-retention limitation in the implementation commit.
