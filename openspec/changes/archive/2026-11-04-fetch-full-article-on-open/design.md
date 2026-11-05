# Design

## Context

See proposal.md for motivation and the capability spec for acceptance. The current extractor is wired to URL-based Read Later only. Entry DTO mapping is shared with Google Reader; Read Later and saved-image authorization separately read `user_entries.contentHtml`. Ingest inserts with conflict-do-nothing. ReaderPane renders body HTML and ArticleImageControls rebuilds on content changes. Existing saved-image fetching already has connection-bound public-address validation that article fetching can reuse.

Doc 11 is an estimate, not an implementation contract. Its assumptions need correction: article fetching resets its timeout per redirect, checks DNS separately from connection resolution, truncates oversized bodies, and does not explicitly reject credentials. Its frontend suggestion of optimistic extracted content cannot work before extraction returns. Its infrastructure numbers are stale: Terraform currently configures the API at 29 seconds and the worker at 180 seconds. Use code/configuration as evidence and update historical planning during implementation.

## Goals / Non-Goals

**Goals:** A single persisted operation with independent invocation and rendering; automation is a reader trigger change, not a storage or extraction redesign. Cross-process concurrency and retry behavior must already exist at the manual milestone.

**Non-Goals:** Ingest jobs, complex teaser classification beyond the text-length threshold, shared cross-user content, existing-data scraping backfills, scheduled refresh, off-feed URL re-extraction, new thumbnail generation, and bypassing publisher access controls. Automatic fetching means explicit reading-pane opens, not background story mounting.

## Decisions

### 1. Separate original and extracted bodies

Add nullable full-content HTML, final URL, fetched-at, attempt token/start, last failure code, and separate automatic/manual next-attempt timestamps to `user_entries`; derive idle/pending/ready/error status. Preserve `content_html` and all existing metadata. The bounded per-user admission history avoids new counting indexes; no partial indexes or FKs are introduced. A success is immutable for this version, with no force-refresh operation or TTL.

Use a web-only content projection helper for entry detail/list, Saved article hydration, and feed-backed Read Later. Return `contentHtml` as the selected web body plus `originalContentHtml` and `fullContent` metadata (status, fetchedAtMs, finalUrl, retryAtMs, automaticRetryAtMs). Google Reader continues through the original entry service unchanged. Avoid implementing projection inside the shared entry mapper, which would silently change the external contract. Tab selection is ephemeral UI state. On a subsequent open, cached full content or an automatically eligible short body selects Fetched article; a longer body renders original feed content directly, with no tabs or fetch/retry controls, even if a fetched copy was previously cached.

### 2. One operation, two caller triggers

Introduce `createArticleContentService` in core with injectable extractor/clock and `ensure(userId, entryId, trigger)` plus status access. `POST /api/v1/entries/:id/content` accepts `{trigger:'manual'|'automatic'}` and no URL. It returns 200 with authoritative content metadata on cached/successful completion or an automatic request skipped by the text-length policy, 202 with bounded retry-after for an active claim, 429 with retry-after for cooldown/budget, 404 for missing/foreign sources, and a safe mapped error with persisted retry metadata for extraction failure. Existing entry detail exposes status for polling after 202; GET has no fetching side effects. Frontend polling stops on terminal state, navigation, or lease expiry; no unbounded loop.

Manual and automatic callers both use the same operation; the trigger only selects the cooldown. A user cannot bypass the 30-second minimum by claiming to be manual. Success and pending checks precede budget checks. Maintain a bounded rolling array of admitted attempt timestamps in a separate `content_fetch_admissions` JSONB column on the existing user-settings row, independently of preference JSON. Prune timestamps older than one hour and atomically append on admission, with a maximum of 30 entries. Serialize admission and entry claiming in one per-user transaction with bounded DSQL conflict retries. Counting only the last attempt on each article would undercount retries and deleted entries; the bounded admission history avoids that bug. The transaction performs no network I/O.

### 3. Durable claims and safe persistence

Claim the owned entry with a random attempt token using a conditional update/transaction after budget admission. A claim expires after 60 seconds. Another request returns pending while valid, and may reclaim an expired attempt. Perform extraction outside a transaction. Final updates require user ID, entry ID, matching token, and a still-valid claim; deletion or a newer attempt makes an old result a no-op. Do not upsert on completion. Handle DSQL optimistic conflicts without repeating outbound fetches. Failure records safe codes and cooldowns of 30 seconds for manual and 15 minutes for automatic retries. A subsequent automatic open after cooldown may retry; an already mounted reader does not continually retry failures.

The attempt start remains recorded on success/failure for budget accounting. Concurrent requests serialize admission through the existing per-user settings row (ensure it exists without replacing settings JSON, then lock through a conditional version update in the admission transaction); all content claims for the same user use this path. Schema adds an admission version column there rather than overwriting unrelated settings. This is database coordination across Lambda instances, not an in-memory rate limiter. Test with real concurrent transactions.

### 4. Harden and reuse extraction

Reuse Readability and the sanitizer, and share the validated connection transport from the saved-image path rather than copying address filters. Verify literal/mapped IPv6 and DNS rebinding, reject credentials, cancel redirect/error bodies, enforce one 10-second network deadline across DNS/redirects/body, accept HTML/XHTML only, and reject overflow instead of slicing. Bound DOM input to 2 MiB, require at least the existing 250-character prose threshold and nonempty sanitized output, and reject output exceeding 500,000 characters. Resolve href/src against the final response URL before sanitization; sanitize after resolution. Do not trust publisher base tags. Keep existing Read Later's save-link-on-failure semantics while expanding extractor tests. This changes extractor internals, not Read Later's outward fallback contract.

### 5. Reader lifecycle and retained images

Milestone A provides Mantine outline tabs labeled Fetched article and Original, plus accessible pending/failure/retry feedback. The fetched panel renders a loader from the initial eligible render (before mutation startup) through pending completion. Original remains selectable while loading. Longer bodies hide all tabs and fetching controls and display original content directly. Cached tab changes for short bodies do not refetch. React Query owns content operations and status. Patch only content fields in existing caches or invalidate for authoritative reload; preserve optimistic read/star fields. Address Read Later using its underlying entryId, not the read-later UUID. Re-run lazy image enhancement when content changes for the same ID.

Milestone B invokes the same mutation once per eligible reading-pane open, including direct links and keyboard navigation. Server state prevents remount/StrictMode/tab duplicates. No trigger runs during list hydration, prefetch, or story scrolling. Opening a full reader from a story qualifies. Automatic fetching is eligible only when original feed text is shorter than `AUTOMATIC_FULL_CONTENT_TEXT_LIMIT` (500) in `packages/core/src/article/content-policy.ts`. Parse HTML, ignore scripts/styles/templates and image attributes, separate block boundaries, decode entities, normalize whitespace, trim, and count Unicode characters. Exactly 500 characters skips automatic fetching. The service projects `fullContent.automaticFetchEligible` for the web trigger and independently enforces the same policy before any admission or outbound work. Reader manual fetch/retry actions are limited to short bodies as well; longer bodies hide all fetching UI. The existing internal manual API remains unchanged. Always measure retained original feed HTML, not an already extracted body. URL Read Later items remain excluded.

Saved-image source resolution must accept images from either retained original or fetched HTML using the appropriate source base; canonical absolute URLs are stored in fetched HTML. Keep the original article URL as attribution, retain saved-image dedupe identity, and preserve prior saved images and splashes. Do not automatically ingest extracted hero images.

## Risks / Trade-offs

- [Length is an imperfect summary detector] → Bodies at or above the threshold intentionally have no reader fetch option; short complete articles may still be fetched. One named constant allows tuning without a migration.
- [Readability can select incorrect prose or reject short valid pages] → Original/full toggle and original-site link; no claim of paywall or JS rendering support.
- [Slow extraction blocks API work] → 10-second total network budget, bounded parse input, no image downloads; verify total operation remains inside the actual 29-second API timeout. Do not promise a hard CPU timeout from AbortSignal alone.
- [Per-user duplication] → Matches existing user-scoped storage; shared cache deferred without coupling triggers to caching.
- [Concurrent updates or deletes] → Token-guarded writes and bounded transactional retries; no network in transactions.
- [Historical doc drift] → Update doc 11 to reference this two-stage plan and remove obsolete estimates/assumptions as part of implementation.

## Migration Plan

Deploy additive columns/indexes through the existing DSQL-safe migration pipeline before API code. No body rewrite or scraping backfill: null metadata means unattempted for old entries. Deliver and verify milestone A, retaining this change as incomplete. Then enable automatic-on-open in milestone B using the same API and service. No new AWS resources or ingest permissions are needed. Verify endpoint budgets against Terraform, lint/types/tests/builds and unchanged Google Reader conformance; run the repository's manual native-client release gate if the shared surface is inadvertently touched. Rollback disables the trigger/UI and retains additive data; original content still serves normally. Source deletion removes extracted content with its entry; independently saved images retain their existing snapshots.
