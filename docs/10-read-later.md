# 10 — Read Later (Planning)

Design document for a **Read Later** queue: a triage list for articles the user wants to
read (or finish) later. It shipped on 2026-09-15; the sections below are the plan as
written, and the Status block records what actually landed and what remains.

## Goal

One list, in the Streams block at the top of the sidebar, holding two kinds of items:

1. **Feed articles** already in `user_entries`, marked "read later" with a button beside
   the existing save (star) button.
2. **Off-feed articles** the user pastes or pushes in from a bookmarklet: a URL, plus a
   readable copy of the article content when we can fetch one.

The list must be reachable, sortable by save time, and independent of subscription state:
unsubscribing from a feed must not silently delete something the user chose to read later.

## Status (2026-09-15): implemented

All six planned slices are built and tested; the sections below are the plan as written, and
this block records where reality landed.

| Area | Where it lives |
| --- | --- |
| Table + migration | `read_later_items`, `packages/db/drizzle/0003_*.sql` |
| Service | `packages/core/src/services/read-later.ts` |
| Article fetch + extraction | `packages/core/src/article/fetch-article.ts` |
| API | `apps/api/src/apps/web-api.ts` (`/read-later…`), `isReadLater` on entry payloads |
| Queue UI | `Sidebar` row (Streams section), `ReaderPane` clock action, `l` shortcut, read-later stream |
| URL form | `apps/web/src/components/SaveArticlePage.tsx` (`/read-later/new`) |
| Bookmarklet | `apps/web/src/lib/bookmarklet.ts` + `components/BookmarkletLink.tsx` (Settings card and the collapsed block on the form) |

Delivered as planned, with these deviations worth knowing:

- Extraction runs inline in `POST /read-later` (agreed up front). The queue/worker path
  remains the documented growth option; `createReadLaterService` already takes an injectable
  `articleFetcher`, so moving extraction into the ingest worker is a wiring change.
- A page whose extracted prose is under ~250 characters is not accepted as an article body,
  so a nav bar or cookie notice cannot masquerade as content; the item keeps its title and
  link instead.
- Items are ordered and grouped by `saved_at`, falling back to it when the source page has
  no publish date, so a saved URL always appears at the moment it was saved.
- Entry points are the sidebar's `+ add` menu on the **Streams** heading ("add article…")
  and the bookmarklet. An earlier `+ add article` button in the top bar was removed once the
  sidebar gained its own sections (Streams / Folders / Feeds).

Remaining, deliberately not in this slice:

- Persisted hero images for saved URLs (`og:image` is stored as a remote URL today; doc 08's
  `saved_article_image` path plus a `read_later_item_id` on `user_media` is the upgrade).
- Notes beyond the excerpt field, full-text search over saved copies, and retaining
  read-later rows through any future entry-retention sweep (they must be excluded, like
  starred rows).
- Extending the shared outbound-fetch guard to feed fetching (roadmap item).

## Relationship to the existing "Saved" (starred) stream

`/starred` is already labelled "Saved" in the sidebar and top bar, and the star button is
the current save affordance. Read Later must not read as a second name for the same thing,
so the recommended split is:

| | Starred (today's "Saved") | Read Later (new) |
| --- | --- | --- |
| Meaning | Keep permanently, reference later | Triage queue: read soon, then clear |
| Source | Feed entries only | Feed entries **and** arbitrary URLs |
| Syncs to NetNewsWire | Yes (greader `starred`) | **No** — deliberately invisible to greader |

Rationale: greader has no read-later concept, and `/api/greader.php` is the hard
compatibility contract. Anything we invent for read later stays inside `/api/v1`, so the
conformance suite and NetNewsWire behaviour are untouched by construction.

**Resolved (2026-09-15):** the starred stream keeps its "Saved" label. Renaming it is a
separate workstream and is explicitly not part of this feature; the new section is labelled
"Read later" and uses its own icon and keyboard binding.

## Non-goals for the first slice

- Full-text extraction for paywalled or JS-rendered pages. Best-effort only; the saved URL
  is never lost when extraction fails.
- Reader-mode polish (font controls, highlights, per-article notes beyond an excerpt).
- Greader/NetNewsWire exposure of any kind.
- Offline/PWA caching of saved articles.
- Feeds synthesized from scraped pages — doc 00 defers "XPath/web-scraping feed
  synthesis" and this feature does not change that. Single-article extraction is a
  different capability, but it **does** need a `docs/decisions.md` entry when it lands,
  because it introduces a new outbound-fetch surface.
- Offline sync of read-later state to native clients.

## Data model

### Recommendation: a dedicated `read_later_items` table

Do **not** materialize off-feed articles as `user_entries`. That table is feed-shaped
(`feed_id` is NOT NULL and part of the dedupe key) and it feeds `/api/v1/entries` streams,
unread counts, and the greader codecs. A synthetic per-user feed would leak those rows into
"All items", unread badges, `subscription/list`, and NetNewsWire unless every query learned
to exclude a magic feed id — a large, permanently risky surface.

```
read_later_items
  id             uuid      pk
  user_id        uuid      not null
  entry_id       bigint    null      -- user_entries.id when saved from a feed article
  url            text      not null
  title          text      not null default ''
  author         text      not null default ''
  site_name      text      not null default ''
  excerpt        text      not null default ''
  content_html   text      not null default ''   -- sanitized, off-feed items only
  image_url      text      not null default ''   -- remote hero URL, best effort
  status         text      not null default 'ready'  -- pending | ready | error
  error          text      null
  saved_at       timestamptz not null default now()
  dedupe_hash    text      not null              -- sha256(entry_id ?? normalized url)
  published_at   timestamptz null                -- source publish time when known
  created_at     timestamptz not null default now()
```

DSQL constraints that shape this (doc 03):

- **No partial indexes**, so "unique per user when `entry_id` is not null" cannot be
  expressed directly. Use the existing `guid_hash` trick: `unique(user_id, dedupe_hash)`,
  with `dedupe_hash = sha256("entry:<id>")` or `sha256("url:<normalized-url>")`. This also
  makes re-saving the same URL idempotent, and matches `user_entries.guid_hash` being
  `text` because bytea cannot be a unique key on DSQL.
- **No FK constraints**: deleting a read-later item is a single-row delete in the service
  layer. Unsubscribing from a feed must *not* delete read-later rows; `entry_id` simply
  becomes a dangling reference, so the list query must tolerate a missing entry (reuse the
  stored column values in that case and mark the item as `status='error'` on next read).
- Indexes (plain ASC btree, created ASYNC on DSQL):
  - `read_later_user_saved_idx` on `(user_id, saved_at)` — the stream listing (backward
    scan = newest saved first).
  - `read_later_user_entry_idx` on `(user_id, entry_id)` — "is this entry in read later?"
    for the reader-pane toggle state, and the entry-id toggle path.

### Entry-sourced items

For a feed article, the only stored facts are `entry_id`, `dedupe_hash`, `saved_at`, and a
snapshot of `url`/`title`. The list DTO resolves live content from `user_entries` (the same
`EntryDto` shape, so title/content/media URLs stay correct if the feed re-publishes).
Storage cost is one small row per save.

## Service layer & API

New `packages/core/src/services/read-later.ts`:

```ts
createReadLaterService({ db, extract? }): {
  list(userId, { cursor?, limit?, status? }): Promise<{ items: ReadLaterItemDto[]; nextCursor }>
  saveEntry(userId, entryIds: number[], save: boolean): Promise<number>   // toggle from reader
  saveUrl(userId, { url, title?, excerpt? }): Promise<ReadLaterItemDto>   // fetch + extract
  setReadLaterState(userId, ids: string[], read: boolean): Promise<number>
  remove(userId, ids: string[]): Promise<number>
  count(userId): Promise<number>
}
```

`ReadLaterItemDto` is **`Entry`-shaped** so the existing list and reading-pane components
work unchanged, with extra fields the UI can branch on:

```ts
{
  id: string;            // read_later_items.id (uuid)
  source: "entry" | "url";
  entryId: string | null;// present for source === "entry" (numeric user_entries id)
  savedAtMs: number;
  status: "pending" | "ready" | "error";
  url, title, author, contentHtml, publishedAtMs, enclosures, isRead, isStarred,
  articleImage: ... | null
}
```

`/api/v1` routes (zod-validated, `AppError`-mapped, `userIdOf` scoped — mirroring the
existing entries routes in `apps/api/src/apps/web-api.ts:299-342`):

| Route | Purpose |
| --- | --- |
| `GET /read-later` | Cursor-paged list, newest saved first |
| `POST /read-later` | Body `{url, title?, excerpt?}` → fetch, extract, persist; returns the item |
| `PATCH /read-later/entries` | Body `{ids: number[], save: boolean}` → toggle feed entries (used by the reader button) |
| `PATCH /read-later/read` | Body `{ids: string[], read: boolean}` → clear an item from the queue without deleting |
| `DELETE /read-later` | Body `{ids: string[]}` → remove items |
| `GET /read-later/count` | Sidebar badge |

`GET /entries` responses gain `isReadLater: boolean` (a cheap lookup keyed on entry id, or
one extra `EXISTS` in the existing `toEntryDtos` pass) so the reader button renders the
right state without a second request.

## Scraping: fetch and extract a single article

This is the piece with the most unknowns, so it gets a bounded, defensive design.

**Recommended: server-side fetch plus Readability extraction.**

- New `packages/core/src/article/fetch-article.ts`, modelled on
  `packages/core/src/feed/fetch-feed.ts:25-101` (same user agent, 20 s timeout, manual
  redirect loop capped at 5 hops) with two additions that do not exist anywhere today:
  - **SSRF guard.** Accept only `http`/`https`; resolve the hostname and reject loopback,
    private, link-local, CGNAT, and cloud metadata addresses (`169.254.169.254`); re-apply
    the check on **every redirect hop**; never forward cookies or auth headers.
  - **Body cap.** 2 MB streamed/truncated read, plus a cap on the extracted HTML length.
    `fetch-feed.ts:86` currently calls `response.text()` unbounded; that is pre-existing and
    out of scope here, but the guard should live in a shared module so feed fetching can
    adopt it in a follow-up (worth its own roadmap line).
- New `packages/core/src/article/extract.ts` using `@mozilla/readability` on a `linkedom`
  DOM. `linkedom` over `jsdom` because it has no native dependencies and keeps the Lambda
  bundle small — a new dependency in `packages/core`, which is allowed (TypeScript-only
  invariant untouched). Output is run through the existing `sanitizeEntryHtml`
  (`packages/core/src/feed/sanitize.ts:78`) so saved content passes exactly the same
  allowlist as ingested feed content.
- Fallback chain when Readability returns nothing usable: Open Graph / `<title>` /
  meta description → a title-plus-link item with `status='ready'` and empty content. The
  save always succeeds; extraction quality is never a failure mode for the user.
- **Image**: v1 stores a remote `image_url` discovered from `og:image` (CSP already allows
  `img-src https:`), and renders nothing when absent. A follow-up slice can reuse
  `media.attachSplash`-style storage: doc 08 already anticipates `user_media.kind =
  'saved_article_image'` with a nullable `entry_id` (docs/08-article-images.md:133-169),
  but associating a standalone image needs a `read_later_item_id` column on `user_media`.
  Not needed for v1.
- **Sync vs queue**: the first slice performs fetch + extract **inline** in the request
  (bounded by the timeout and byte caps) so the form gives immediate feedback. The growth
  path is the existing ingest queue: the worker message body is loosely typed
  (`apps/api/src/entries/worker-lambda.ts:102-123` currently assumes `{feedId}`) and could
  take a discriminated `{type:"read-later-url", itemId}` to fill content asynchronously
  with `status='pending'` in the meantime. Only build that if real pages start timing out.

**Alternative considered and rejected for v1:** doing extraction in the bookmarklet and
posting the HTML. It is cheap server-side but unreliable (paywalls, SPA rendering, no
`og:` data integrity) and leaves the in-app form unable to save a URL on its own.

## Frontend

### Routes (routing is view state — doc 05)

| Path | View |
| --- | --- |
| `/read-later` | The list |
| `/read-later/e/:id` | Reading pane for an item |
| `/read-later/new` | Add-an-article form; `?url=&title=&excerpt=&auto=1` prefills and auto-submits (bookmarklet target) |

Touch points, all small:

- `apps/web/src/lib/types.ts:61-85` — add `{ kind: "readLater" }` to `StreamDescriptor`;
  it uses its own endpoint, so `streamParam` is not the path (the read-later list does not
  go through `api.entries.list`).
- `apps/web/src/lib/keys.ts:36,53,107` — `streamKey`, `streamPath`, `parseRoute`.
- `apps/web/src/components/Sidebar.tsx:175-186` — a new `NavLink` in the **Streams** block
  beside "Saved", e.g. `LuClock` icon plus a count badge.
- `apps/web/src/pages/Shell.tsx:47-68` — `streamTitle` case; the active-stream query
  (`:138`) must call a new `api.readLater.list` infinite query instead of `api.entries.list`;
  the reader's mark-read/star mutation ids are numeric (`api.ts:141,149`), so for
  `source === "entry"` items the reader keeps targeting `entryId` and for `source === "url"`
  items those actions are hidden.
- `apps/web/src/components/ReaderPane.tsx:157-183` — a second `ActionIcon` beside the
  bookmark: clock/"read later" for feed entries, "remove from read later" when open from the
  read-later stream.
- `apps/web/src/components/Topbar.tsx:104,118` — exclude `readLater` from the
  unread-filter and mark-all-read controls, like `starred` is today.
- `apps/web/src/lib/mutations.ts` — `useToggleReadLater`, `useSaveReadLater` (form),
  `useRemoveReadLater`, all optimistic with rollback, mirroring `useToggleStar`
  (`:62-116`).
- Form: follow the `SubscribeModal` precedent (Mantine form hooks, `React.lazy` chunk,
  `useState`-driven open state) so it stays off the first-paint critical path.
- Keyboard: `l` toggles read later in the reader (currently unused; `s` is star), and the
  `?` sheet plus doc 05 get the new binding.
- The list reuses `EntryList`/`StreamInner` untouched, since items are `Entry`-shaped, but
  the reader-scroll/media-expiry logic only applies to entry-sourced images.

### Bookmarklet

Ship it as a **snippet, not a server feature**: a "Read later bookmarklet" card in
Settings with a drag-to-bookmarks-bar link.

```js
javascript:(()=>{const s=window.getSelection();const q=new URLSearchParams({url:location.href,title:document.title,excerpt:s?String(s).slice(0,500):'',auto:'1'});window.open('https://app.sparklerss.com/read-later/new?'+q,'sparkle-read-later','width=460,height=460');})()
```

Why a popup and not a direct POST: a bookmarklet runs in the *third party's* origin, where
it cannot read the SPA's Cognito token, and we should not expose a cross-origin write
endpoint to arbitrary pages. Opening a same-origin window means the app fetches and saves
with its own session, and the excerpt/title we already have in the page context seed the
form so the user can confirm quickly. `form-action`/`frame-ancestors` in the CloudFront CSP
(`tf/modules/web/main.tf:78-80`) are unaffected by a popup to our own origin.

## Security

The only genuinely new attack surface is the URL fetcher, and it is user-triggered outbound
HTTP. Required before shipping:

- Scheme allowlist, private/link-local/metadata address rejection, redirect-hop
  re-validation, no credential or cookie forwarding, per-user rate limiting (e.g. 30
  saves/hour) and a bounded response size and extraction time.
- Stored content is sanitized with the existing `sanitizeEntryHtml` allowlist; the reader
  renders it with the same `dangerouslySetInnerHTML` path already used for ingested
  articles (`ReaderPane.tsx:150-155`).
- Cross-user isolation tests: a read-later item is only ever returned to its owner
  (mirroring the media authorization tests in doc 08).

## Testing

- **Pure/unit** (`packages/core/test`): extractor fixtures (typical blog, no-`og:` page,
  empty body, huge body, malformed HTML, redirect chain), URL normalization + dedupe hash,
  SSRF guard cases (localhost, `10.0.0.0/8`, `169.254.169.254`, redirect to a private
  address, `file:`/`ftp:` schemes), byte-cap truncation.
- **Integration** (`packages/db/test`, Docker Postgres): save/remove/toggle idempotency,
  ordering by `saved_at`, dangling `entry_id` after unsubscribe, user scoping.
- **API contract** (`apps/api/test/api.int.test.ts`): each new route, validation failures,
  authentication, and that a removed item disappears from the list and count.
- **Web** (`apps/web/test`): route parsing for `/read-later` and `/read-later/new`, sidebar
  entry, reader button state, and the form's prefill/auto-submit path.
- **Regression gate:** `apps/api/test/greader.conformance.test.ts` must stay green with no
  edits — that is the proof that read later did not leak into the compatibility contract.

## Planned slices (all landed 2026-09-15)

1. **Schema + service.** `read_later_items` migration (DSQL-safe dedupe hash and indexes),
   `read-later.ts` service, unit + integration tests. No UI, no fetching.
2. **API + entry flag.** `/read-later` routes, `isReadLater` on entry payloads, count
   endpoint, contract tests.
3. **Feed-article read later, end to end.** Reader-pane button, optimistic mutation, sidebar
   section, `/read-later` stream, route parsing, keyboard `l`, topbar exclusions. Shippable
   on its own without any scraping.
4. **URL save (scrape).** SSRF-guarded fetcher + Readability extractor + sanitization,
   `POST /read-later`, `/read-later/new` form, fixture tests.
5. **Bookmarklet.** Settings card + snippet, popup flow, manual verification checklist.
6. **Polish (only if needed).** Persisted images via `user_media` + `read_later_item_id`,
   async extraction through the ingest queue, excerpt/notes, retention policy (read-later
   rows must be excluded from any future entry-retention sweep, like starred rows).

## Resolved decisions (2026-09-15)

1. **Naming** — leave the starred/"Saved" stream untouched (no cross-workstream rename).
   Read later is its own section with its own icon and keyboard binding.
2. **Scraping** — server-side extraction is approved, including the
   `@mozilla/readability` + `linkedom` dependencies in `packages/core`.
3. **Timing** — start with **inline fetch** in the `POST /read-later` request. The queue
   path (`status='pending'` + worker extraction) stays a documented growth option to be
   revisited after a period of real use.
4. **One-off images** — use `og:image` as a remote URL for now. If extraction later moves
   into the ingest worker, that slice should reuse the existing feed image pipeline
   (`findArticleImage` + `media.attachSplash`) rather than introduce a parallel one.