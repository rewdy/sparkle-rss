# 11 — Full Content for Teaser Feeds (Planning / LOE)

Proposal captured 2026-09-23. **Not approved and not scheduled** — this records a
level-of-effort estimate so a decision can be made later. Nothing here is committed work;
the read-later fetcher it proposes to reuse is already shipped (doc 10).

## Problem

Some feeds publish only a summary/teaser rather than the full article body. The reader
renders exactly what the feed supplied, so those articles are unreadable in-app even though
the source page has the rest of the text.

The question this doc answers: given the existing read-later scraper, what would it take to
fetch and show the full article for feed entries whose feed content is a teaser?

## What already exists and is reusable as-is

`packages/core/src/article/fetch-article.ts` is a complete, tested, defensive extractor and
needs no changes for either option below:

- `fetchAndExtractArticle(rawUrl, deps?)` (`fetch-article.ts:279-294`) — SSRF guard
  (`assertPubliclyFetchable`, `:85-111`), manual redirect loop capped at 5 hops, 10 s
  timeout, 2 MB `readBounded` body cap, cookie/auth headers never forwarded.
- `extractArticle(html, url)` (`fetch-article.ts:231-277`) — `@mozilla/readability` on a
  `linkedom` DOM, with OpenGraph/`<title>`/meta fallback (`metaFallback`, `:186-225`).
- Output `ExtractedArticle` (`fetch-article.ts:28-40`) includes `contentHtml`, `imageUrl`,
  `byline`, `publishedAt`, and `extracted: boolean` (true when a real body was found;
  bodies under `MIN_BODY_CHARS = 250` are rejected).
- Content is sanitized through the shared `sanitizeEntryHtml` allowlist, the same one feed
  ingest uses, so rendering via the existing `dangerouslySetInnerHTML` path
  (`apps/web/src/components/ReaderPane.tsx:175`) adds no new risk.
- Errors are `AppError` with meaningful status codes (400 bad/blocked URL, 502 upstream,
  508 redirect loop).

It is currently wired only to read later: `createReadLaterService` takes an injectable
`articleFetcher` defaulting to `fetchAndExtractArticle`
(`packages/core/src/services/read-later.ts:117-120`) and calls it from
`saveUrlWithExtraction` (`:414-446`). Nothing about that wiring is specific to read later.

## What is missing for feed entries

1. **Teaser detection.** `packages/core/src/feed/parse.ts:109-110` takes the first of
   `content:encoded` / `content` / `summary` and stores it as `contentHtml` (`:132`). There
   is no flag, and `contentSnippet` is read from the parser type but never used. A
   heuristic is needed (presence of `content:encoded`, body length, summary-equals-content)
   plus a persisted column so the decision is not recomputed and is available to the API
   and UI.
2. **No per-entry content state.** `user_entries` (`packages/db/src/schema.ts:109-142`) has
   `contentHtml` but no source/status marker. Any fetched-vs-teaser distinction, and any
   "pending/failed" state for async work, requires new column(s) and a DSQL-safe forward
   migration (no `serial`, no partial indexes, no multi-DDL transactions; custom runner in
   `packages/db/src/dsql-migrator.ts`).
3. **No trigger.** There is no endpoint or queue message that means "go get the full body of
   this entry". Extraction currently happens inline in `POST /read-later`
   (`apps/api/src/apps/web-api.ts:393-411`).
4. **No shared fetch cache.** Fetches are per-user. Two users subscribed to the same teaser
   feed would each fetch the same URL, and the automated option would multiply this across
   every entry.
5. **No retry/backfill machinery** for entries that were ingested before the feature
   existed, if the automated option is chosen.

## Compatibility constraint

`user_entries.contentHtml` is what `/api/greader.php` serves to NetNewsWire as entry
content (doc 02). Adding columns is safe; changing what `contentHtml` means for an entry
that has already been synced is only visible to clients on a re-sync, and is fine as long as
no greader field semantics change. The proof obligation is that
`apps/api/test/greader.conformance.test.ts` stays green with no edits, per the repo
invariant.

## Option A — on-demand ("load full article" in the reader)

The reader shows a teaser plus a control that fetches the body for that one entry.

| Step | Detail | Estimate |
| --- | --- | --- |
| Migration + column | e.g. `content_source` (`feed` / `fetched`) plus optionally `content_fetched_at`; DSQL-safe forward migration | 0.5 d |
| Teaser heuristic | In `parse.ts`, set the new column at ingest; unit-test the cases | 0.5 d |
| API endpoint | `POST /entries/:id/content` (or similar) — resolve entry, enforce user scoping, call `fetchAndExtractArticle`, persist the body + source flag, return the updated entry; per-user rate limit mirrors the read-later guard | 1–1.5 d |
| Frontend | Button/banner in `ReaderPane` when `content_source === 'feed'`, mutation with optimistic cache update (mirror `useToggleStar`), loading and error states | 1–1.5 d |
| Tests | Heuristic unit tests, API integration tests (happy path, blocked URL, upstream failure, cross-user isolation), web component tests | 1 d |
| Docs | doc 05 (reader affordance), doc 06 (roadmap line), decisions entry when landed | 0.5 d |
| **Total** | | **4–6 days** |

Cost and blast radius stay bounded: one fetch per explicit user action, no ingest-path
changes, no background load.

## Option B — automatic at ingest for teaser-only feeds

Everything in Option A, minus the reader control, plus:

| Additional step | Detail | Estimate |
| --- | --- | --- |
| Worker message type | `apps/api/src/entries/worker-lambda.ts:102-123` currently assumes `{feedId}`; make it a discriminated union with a content-fetch job | 1 d |
| Fanout enqueue | `insertEntriesForUser` (`packages/core/src/services/subscriptions.ts:333-368`) must return inserted ids and enqueue extraction for teaser entries only | 0.5–1 d |
| Async state handling | `pending`/`ready`/`error` per entry (new column), timeouts, retries, DLQ behaviour | 1 d |
| URL dedupe / shared fetch | One fetch per URL rather than per user; needs a cache keyed by normalized URL | 1–2 d |
| Backfill | Fetch bodies for teaser entries already in `user_entries`, rate-limited and resumable | 1–2 d |
| Observability | Counters and alarms for fetch volume, failure rate, and Lambda duration | 0.5 d |
| **Total on top of A** | | **8–12 days**, plus ongoing fetch egress and Lambda cost |

## Risks and decisions that gate Option B more than Option A

- **Per-user refetch.** Without a shared cache, N subscribers to one teaser feed means N
  fetches of the same URL.
- **robots.txt / ToS / paywalls.** The read-later fetcher does not consult robots today.
  Doing this automatically across every teaser entry in every feed at ingest scale is a
  product/legal decision, not just an engineering one. Consider honoring robots.txt and a
  per-feed opt-out before enabling automation.
- **Lambda timeouts.** Extraction is bounded at 10 s per URL. Inline extraction in the batch
  ingest worker risks throttling at scale, which is why Option B routes through the existing
  queue rather than calling the fetcher directly. doc 10 already sketches this queue path
  (`docs/10-read-later.md:221-226`).
- **Volume.** Automatic fetching turns ingest cost into a function of feed content quality,
  not just feed count. The current CloudWatch/billing tripwire (doc 01, roadmap "Cost &
  billing") should be armed first.
- **DSQL migration constraints.** Forward-only; dropped names stay blocked for the
  cluster's lifetime.

## Recommendation

Ship Option A first (4–6 days), reusing `fetchAndExtractArticle` unchanged. It delivers the
feature for the users who care about a specific article, with bounded cost and no ingest-path
risk. Revisit Option B once real teaser-feed volume is known and the robots/ToS question has
an answer.

## Open questions for the decision

1. On-demand only, or automatic at ingest?
2. If automatic: honor `robots.txt`? Per-feed opt-out? Global off by default?
3. Fetch once per URL (shared cache) or once per user?
4. Backfill existing teaser entries, or only apply going forward?
5. Image handling: reuse the existing feed image pipeline
   (`findArticleImage` + `media.attachSplash`, per doc 10's resolved decision 4) or the
   read-later remote-`og:image` approach?