# Tasks

## 1. Subscription persistence and API

- [x] 1.1 Add the nullable subscription boolean, separate true default, and Drizzle migration metadata; verify fresh/existing-row local migrations and review SQL against the documented DSQL migration/recovery checklist.
- [x] 1.2 Extend subscription DTO/list/edit, first-party PATCH validation, web types, and API client with optional `fetchFullArticles`. Add database/API tests for legacy NULL/new defaults, true/false, omitted fields, user isolation, foreign/missing IDs, invalid values, and preservation through OPML/GReader edits; verify against migrated test Postgres.
- [x] 1.3 Update docs/03-data-model.md with storage/default/API details and refresh roadmap/decision log in this chunk; verify the documented contract matches the schema and passing API cases.

## 2. Content policy and projection

- [x] 2.1 Batch owned subscription policy resolution in content get/decorate, add `fullContent.fetchEnabled`, combine preference with existing automatic eligibility, and project original bodies while disabled. Verify database/API coverage for entry list/detail, Saved, feed-backed Read Later, unchanged off-feed URLs, and unchanged native content.
- [x] 2.2 Guard both triggers before attempt/budget writes and cached/pending shortcuts; return the 200 disabled projection and reproject late completions using current policy. Add integration cases proving no outbound call or budget use while disabled, retained cached success, disable-during-fetch, re-enable reuse, and foreign-ID rejection; run content service/API suites.
- [x] 2.3 Update docs/11-full-content-fetch.md for opt-out precedence, metadata, API responses, cached retention, and admitted-request behavior; refresh roadmap/decision log alongside this chunk and verify descriptions against integration cases.

## 3. Feed editor and reader state

- [x] 3.1 Add the Fetch full articles toggle/helper text to Edit feed and save alongside title. Verify UI tests for stored values, preference-only edits, pending saves, reopen, and failed-save feedback preserving draft choices.
- [x] 3.2 Reconcile subscription, entry list/detail, Saved/Read Later aliases, and separate article-content caches after edits; apply current policy as a display/fetch guard and refresh authoritative projection before re-enabling extraction. Verify deferred-response hook/reader tests for immediate original display, hidden tabs/loading/retry, stale success suppression, re-enable reuse, deep links before subscription hydration, and preserved optimistic read/star flags.
- [x] 3.3 Update docs/05-frontend.md with editor behavior and server-state/cache ownership, plus roadmap/decision log in this chunk; verify documentation against the new UI/hook tests.

## 4. Short-body publisher button

- [x] 4.1 Add browser readable-text classification with parity fixtures for the core 500-character rule; verify empty/499/500/501 boundaries, Unicode, entities, whitespace, blocks, excluded nodes, and image-heavy HTML against core policy behavior.
- [x] 4.2 Add the centered filled primary-theme View full post… link below displayed content and before navigation. Verify ReaderPane tests for Original/Fetched selection, opted-out feeds, error fallback, off-feed saved URLs, loading suppression, URL validation, safe new-tab attributes, exact copy, and retention of the corner link.
- [x] 4.3 Update docs/05-frontend.md and docs/11-full-content-fetch.md for placement and displayed-body threshold; refresh roadmap/decision log in the same chunk and verify descriptions against reader tests.

## 5. Integrated acceptance

- [x] 5.1 Run relevant unit/integration suites against migrated Docker Postgres, unchanged GReader conformance, `pnpm lint`, `pnpm typecheck`, `pnpm build:web`, and `pnpm build:lambdas`; record results and resolve regressions.
- [x] 5.2 Perform fixture-backed browser acceptance on desktop/mobile, light/dark, and alternate accents: opt-out persists after reload, cached extraction stays hidden, re-enable works, Saved/Read Later/deep links agree, and the centered button supports keyboard/touch; record evidence and final roadmap/decision-log status without claiming deployment.
