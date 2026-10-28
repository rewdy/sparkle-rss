# Proposal

## Why

Feeds that supply only a teaser or an empty body force readers out of Sparkle to read an article. Reuse article extraction to provide durable full content in the web reader, first on demand and then automatically when an article is opened.

## What Changes

- Add a user-scoped full-content service and web API, usable by both explicit and automatic reader triggers.
- Preserve original feed HTML for Google Reader; persist extracted HTML and fetch state separately and select it only in web responses.
- Ship a manual Load full article milestone, followed by automatic fetching on explicit article open. Both stages are required before this change is complete.
- Keep feed content readable during requests and failures, with retry, persisted success, and an option to view the original feed content.
- Support existing feed entries and their feed-backed Read Later views with automatic fetching limited to original feed bodies below a configurable 500-character readable-text threshold, without ingest jobs or a data backfill.
- Bound and secure outbound fetching, coalesce concurrent work, persist retry eligibility, and authorize images against the stored content readers actually see.

## Capabilities

### New Capabilities

- `full-article-content`: Fetch, retain, and display web-only extracted content for owned feed entries, with manual and automatic-on-open triggers and safe failure behavior.

### Modified Capabilities

None. Existing presentation specs remain unchanged. The active saved-image change is an integration dependency: fetched-content images must use its existing authorization and saving contract.

## Impact

Touches additive DSQL-safe entry columns, core extraction/content/read-later/saved-image services, web API decoration and routing, React Query mutations and reader lifecycle, tests, and docs 01/03/05/06/07/11 plus decisions. Original entry IDs, timestamps, ordering, read/star/read-later state, splash images, and Google Reader content remain unchanged. No ingestion automation, shared cross-user cache, off-feed URL refresh, paywall bypass, or automatic image persistence is included.
