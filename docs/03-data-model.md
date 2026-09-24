# 03 — Data Model (Aurora DSQL)

## Why this shape

The Google Reader API is relational-shaped: filtered keyset pagination over entries,
per-feed/per-folder aggregate counts, and set-based `mark-all-as-read`. Postgres maps to
these directly. We use **Aurora DSQL** — serverless, IAM-authenticated, no VPC.

**DSQL constraints that shape the schema** (full findings in
[decisions.md](./decisions.md)):

- **No FOREIGN KEY constraints.** Columns are logically related but declared without
  `.references()`. Referential integrity and cascade behavior live in `packages/core`
  repositories — every delete of a parent explicitly removes children.
- **No partial indexes, no DESC index keys.** State columns (`is_read`, `is_starred`) sit
  inside composite index keys instead; btree backward scans serve `ORDER BY … DESC`.
- **Identity columns need explicit `CACHE 1`** (= vanilla default semantics).
- **No `serial`/`bigserial`.**
- **IAM auth tokens expire every 15 min**; `admin` user requires
  `dsql:DbConnectAdmin` + `getDbConnectAdminAuthToken()` (pool factory caps client lifetime).
- **No local emulator.** Local dev/tests run vanilla Postgres 16 in Docker with identical
  migrations. The schema file is valid on both engines; only index DDL gets a runtime
  rewrite for DSQL (`CREATE INDEX ASYNC`).

## Migration pipeline

- Source of truth: Drizzle schema (`packages/db/src/schema.ts`).
- `pnpm db:generate` → drizzle-kit generate → codemod (`scripts/inline-fks.mjs`) that
  inlines any FK constraints and strips `USING btree` (both are guardrails; the current
  schema triggers neither).
- Apply:
  - local/docker & tests: drizzle's stock transactional migrator;
  - DSQL: custom runner `packages/db/src/dsql-migrator.ts` — statement-per-statement
    (DSQL rejects multi-DDL transactions), journal-compatible, tolerant of spurious
    "already exists" acknowledgments, rewrites index DDL to ASYNC at runtime.
- Forward-only. Dev cycle = fresh TF cluster, never drop/recreate (dropped names stay
  blocked on a cluster).

## Design choice: per-user entry rows

FreshRSS copies entries into per-user tables; we do the same (`user_entries`). Rationale:

- Listing queries become single-table scans with inline read/star flags — no joins on the
  hot path (every greader stream call).
- Per-user retention, unread counts, and mark-all-as-read are trivially scoped.
- Cost of duplication is negligible at personal scale (~few GB/yr).

Global `feeds` are shared/deduplicated (one fetch serves all subscribers), while article
content rows are materialized per subscriber by the ingest worker.

## Schema (as built — see `packages/db/src/schema.ts`)

Tables: `users`, `api_tokens`, `categories`, `feeds`, `subscriptions`, `user_entries`,
`read_later_items`, `user_settings`, `media_objects`, `user_media`. Key points where reality
differs from a vanilla-PG design:

- `user_settings` is a single `data` jsonb blob keyed by `user_id`; per-user preferences
  (currently `colorScheme` (`light`, `dark`, or `system`), `themeId`, `markReadOnOpen`, `sidebarOpen`) are
  plain keys merged by `packages/core/src/services/settings.ts`. Adding a preference is a
  new key, never a migration.

- `read_later_items` is the read-later queue ([10-read-later.md](10-read-later.md)). It is
  the one table the Google Reader surface never reads: off-feed saved articles have no feed
  and must not appear in entry streams or unread counts. `entry_id` is nullable — set when
  the item came from a feed article, in which case title/content/read state are resolved
  live from `user_entries` rather than copied. `is_read` is authoritative only for
  URL-sourced rows.
- All child tables carry bare `user_id` / `feed_id` / etc. columns (no FKs — A3).
- `user_entries.guid_hash` is **text** (hex sha256): bytea is not supported in unique keys
  on DSQL. `read_later_items.dedupe_hash` follows the same rule and the same reason: no
  partial indexes means "unique per user, only when `entry_id` is set" cannot be expressed,
  so the hash covers `entry:<id>` or `url:<normalized url>` and the unique key is plain.
- Indexes (all plain ASC btree, created ASYNC on DSQL):

| Index | Columns | Serves |
| --- | --- | --- |
| `feeds_due_idx` | `(next_fetch_after)` | orchestrator due-feed scan (error_count filtered in query) |
| `ue_stream_idx` | `(user_id, published_at, id)` | reading-list pagination (backward scan = newest first) |
| `ue_feed_idx` | `(user_id, feed_id, published_at, id)` | per-feed streams |
| `ue_unread_idx` | `(user_id, is_read, feed_id, published_at)` | unread listings + per-feed unread counts |
| `ue_starred_idx` | `(user_id, is_starred, starred_at)` | starred stream |
| `rl_user_saved_idx` | `(user_id, saved_at, id)` | read-later queue, newest save first |
| `rl_user_entry_idx` | `(user_id, entry_id)` | "is this entry in the queue?" + entry toggles |
| `api_tokens_user_idx`, `subscriptions_category_idx` | lookup helpers | token revocation, folder ops |

Unique keys: `users.cognito_sub`, `users.username`, `api_tokens.token_hash`,
`categories(user_id, name)`, `feeds.url`, `subscriptions(user_id, feed_id)`,
`user_entries(feed_id, guid_hash, user_id)`, `read_later_items(user_id, dedupe_hash)`.

## Access-pattern → query mapping

| Caller | Pattern | Query sketch |
| --- | --- | --- |
| greader `stream/items/ids` & `stream/contents` | Filtered, ordered, keyset-paged listing | Single-table scan on matching index; stream type (all/feed/folder/starred) + `xt`/`it` read-state + `ot`/`nt` time bounds; opaque base64url keyset cursor `(published_at, id)` |
| greader `unread-count` | Counts per feed, per folder, total | Grouped aggregates via `ue_unread_idx`; folder totals join through subscriptions. Live COUNT at personal scale — revisit with counters only if p95 degrades |
| greader `edit-tag` | Toggle read/star on N items | `UPDATE … WHERE user_id=$1 AND id = ANY($2)` (both ID forms decoded first) |
| greader `mark-all-as-read` | Bulk read older than ts, scoped to stream | One `UPDATE`: scope by stream (feed id / folder subquery / whole user), `published_at < ts_ns→ts AND NOT is_read` |
| greader `subscription/list` | Feeds + folders + counts | subscriptions ⋈ feeds (+categories); entry counts via grouped second query |
| web `/api/v1/*` | Same primitives, JSON wrappers | Shares `packages/core` services verbatim |
| read later list (`/api/v1/read-later`) | Queue, newest save first, keyset-paged | Scan `rl_user_saved_idx` with cursor `(saved_at, id)`; entry-sourced rows hydrate from `user_entries` by `entry_id` in one batched query |
| read later save (entry) | Add/remove N entries | `INSERT … ON CONFLICT (user_id, dedupe_hash) DO NOTHING` / `DELETE … WHERE entry_id = ANY($2)`, after a user-scoped ownership check on the entry ids |
| read later save (URL) | Upsert one saved article | `INSERT … ON CONFLICT (user_id, dedupe_hash) DO UPDATE` (re-saving bumps `saved_at`, so the item returns to the top) |
| read later count | Sidebar badge | `COUNT(*)` for the total, plus a `LEFT JOIN user_entries` count excluding orphaned and read items |
| ingest worker upsert | Dedupe insert | `INSERT … ON CONFLICT (feed_id, guid_hash, user_id) DO NOTHING` per subscriber |
| orchestrator due-feeds | Feeds needing refresh | `SELECT … WHERE next_fetch_after <= now() LIMIT $batch FOR UPDATE SKIP LOCKED` |

> Because there are no FKs, deletes cascade in code: deleting a subscription removes its
> `user_entries`; deleting a category nulls `subscriptions.category_id`; disabling a user
> blocks at the auth layer. These invariants get dedicated unit tests in Phase 2.

Feeds start due immediately (`next_fetch_after` defaults to `now()`); a successful
subscribe additionally enqueues an immediate refresh on the ingest queue (same
`{ feedId }` message the orchestrator sends), so a newly subscribed feed is fetched
within seconds instead of waiting for the next 5-minute orchestrator run.

When the last subscription is removed, the feed is marked `orphaned_at` and is excluded
from due-feed selection. The orchestrator removes orphaned feed rows after a 72-hour
grace period, rechecking that no subscription appeared; resubscribing clears the marker.
This is application-enforced because DSQL has no foreign keys. Removing a subscription
still deletes that user's entries immediately; shared feed metadata remains during the
grace period so a quick resubscribe can reuse it.

## Cursor format

GReader clients treat continuation tokens as opaque, so we use one canonical encoding for
both APIs: base64url of
`{"k":<sort_key>,"p":<primary_at_epoch_ms>,"i":<row_id>,"d":"asc|desc"}`. The sort key is
`published` (entry streams), `starred` (the starred stream), or `saved` (the read-later
queue); `i` is a decimal entry id for the entry lists and a uuid for saved items, so the
decoder accepts either. Keyset pagination stays correct under concurrent inserts.

> Raw `or` expressions inside a keyset condition must be **parenthesized**: drizzle does not
> wrap raw SQL chunks, so an unparenthesized `or` escapes the surrounding `user_id = …`
> condition and can page in another user's rows.

## ID conventions

- `feeds.id` / `user_entries.id`: `bigint identity (CACHE 1)` → greader numeric ids;
  short form = decimal string; long form =
  `tag:google.com,2005:reader/item/<to_hex(id) zero-padded to 16>`; parsers accept both.
- `read_later_items.id` is a plain `uuid`: saved items never reach a greader client, so they
  need no numeric form.
- Timestamps: store UTC `timestamptz`; convert to sec/msec/usec/nsec **at the codec layer**
  (`packages/core/greader/time.ts`) so unit tests pin every conversion once. Read-later
  `saved_at` is written by the application at **millisecond** precision so the cursor can
  round-trip it exactly (a DB `now()` default would carry microseconds the cursor cannot
  represent), with ties broken by row id.

## Retention (deferred but planned)

v1 keeps everything. Expected growth at personal scale (~100 feeds): ~700k entries/yr ≈
2–3 GB — well inside DSQL comfort. When needed: nightly job deleting `user_entries`
beyond per-feed caps or age, **excluding starred entries and anything referenced by
`read_later_items.entry_id`**, plus quarantine sweep for feeds with `error_count >= 50`.
No premature tooling.
