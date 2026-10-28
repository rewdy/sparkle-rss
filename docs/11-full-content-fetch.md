# 11 — Full Article Content

OpenSpec: `fetch-full-article-on-open`. The September estimate is superseded by
this implementation and the change's capability spec. The confirmed sequence is
manual fetching followed by automatic fetching when the reading pane opens; both
use one core service. Automatic ingestion is outside this change.

## Reader behavior

Opening a feed article's reading pane automatically requests readable source-page
content. This includes existing entries, Saved articles, deep links, keyboard
navigation, and feed-backed Read Later items. Automatic fetching requires a valid HTTP(S) URL and fewer than 500 readable
characters in the original feed body. Empty content qualifies; exactly 500 or
more characters skips automatic fetching. `AUTOMATIC_FULL_CONTENT_TEXT_LIMIT` in
`packages/core/src/article/content-policy.ts` is the single tuning constant. The
policy ignores markup and script/style/template text, separates block text, decodes
entities, normalizes whitespace, trims, and counts Unicode characters. At or above the threshold, the reader shows only original feed content and hides
all content tabs and fetch/retry controls, even if an older fetched copy exists.
List hydration, prefetching, pagination, and scrolling Swipe stories do not fetch.
Opening the full reader from a story does. Off-feed URL items keep their existing
Read Later extraction behavior.

Mantine outline tabs labeled **Fetched article** and **Original** select the
reader body. Automatically eligible articles default to Fetched article, which shows
a loading indicator from the first render until extraction finishes; the original
body is not briefly rendered underneath it. Original stays selectable during
loading. Longer articles show original feed content directly without tabs or a
fetch action. Cached results switch without refetching. Errors show
actionable feedback and a retry control, with original content still available. Extracted content is preferred on a
subsequent open. Success is retained indefinitely, without scheduled refresh.
Publisher paywalls, JavaScript rendering, and extraction quality are not guaranteed;
the original-site link remains available.

## Storage and compatibility

`user_entries.content_html` remains the original feed body. Separate nullable
full-content HTML/URL/fetched-at columns hold extraction results. Attempt token/time,
failure, and manual/automatic retry times coordinate work. Source deletion removes
this content with its entry; independently saved images retain their existing copies.

Only web API decoration selects extracted content. Google Reader still uses the
original mapper, original body, IDs, timestamps, ordering, and article state.
Title, author, splash images, read/star/read-later flags, and save timestamps are
not changed by extraction. Feed-backed Read Later resolves through its entry ID.

## API and state

`POST /api/v1/entries/:id/content` accepts only
`{ "trigger": "manual" | "automatic" }`; the source URL comes from the owned row.
Missing/foreign IDs return 404 without fetching. Invalid URLs return 400.

Responses contain `{status, content, retryAfter, message?}`. `content` contains
`contentHtml`, `originalContentHtml`, and `fullContent` metadata: `status`
(`idle|pending|ready|error`), `fetchedAtMs`, `finalUrl`, `retryAtMs`,
`automaticRetryAtMs`, `pendingUntilMs`, `automaticFetchEligible`, and safe `error`, with null absent values.
200 means ready or an automatic request skipped by the length policy, 202 pending, 429 cooldown/budget, and 502 extraction failure.
Pending/limited/failure responses include `Retry-After` when applicable.
Web entry detail/list, Saved article hydration, and feed-backed Read Later carry
the same body fields. GET never initiates extraction.

A database admission transaction serializes requests through a user-settings
version column and a bounded JSON array of the last hour's admitted attempts.
The 30/hour budget includes retries and survives source deletion. Preference JSON
is independent. Cached successes and pending-status reads consume no attempts.
An entry claim expires after 60 seconds; completion requires the matching token
and an unexpired claim. Network I/O runs outside transactions. Up to three
transaction conflict retries do not repeat an already completed outbound fetch.
Failures permit manual retry after 30 seconds and automatic retry on a subsequent
open after 15 minutes. A mounted reader does not loop through automatic retries.

## Fetching and images

The article and saved-image paths share the pinned public-socket transport. URL
credentials, non-HTTP(S) schemes, and non-public connection addresses are rejected.
Every redirect is validated, at most five are followed, and a single 10-second
network deadline spans DNS, redirects, and body reads. Only HTML/XHTML is accepted;
input exceeding 2 MiB and extracted HTML exceeding 500,000 characters are rejected,
not truncated. Readability's 250-character prose minimum and nonempty sanitized
output are required for a full-content success. Bounded DOM parsing is synchronous;
the network deadline is not a hard CPU timeout.

Links/images resolve against the final URL before sanitization, ignoring publisher
base tags. Existing image-save controls authorize selected images against either
retained body. Fetching does not persist images or replace hero thumbnails.
Read Later still saves a link when its extractor fails.

## Delivery and verification

Migration `0005_dry_violations.sql` is additive and needs no article backfill.
Migrate before publishing Lambda code; the existing deploy workflow runs migrations
before Terraform updates existing Lambdas. Rollback disables the UI/trigger and
retains additive schema and extracted bodies. Do not reverse migrations.

Local service, API, hook, reader, and unchanged Google Reader conformance tests
cover persistence, aliases, source deletion, concurrent requests, leases, cooldowns,
rate limits, relative images, and article-state isolation. Browser acceptance and
CI migration review are tracked separately in the OpenSpec tasks and roadmap;
unit/integration results alone do not establish production deployment.
