# Tasks

## 1. Discovery-only first-party API

- [x] 1.1 Add an injectable discovery-only subscription service method reusing `discoverFeed`; verify direct XML, HTML alternate links, first-valid-candidate selection, missing title, invalid HTTP(S) input/output, 422, and 502 with deterministic transport fixtures, asserting no feed/subscription inserts or refresh-hook calls.
- [x] 1.1a Add the web-only origin-root discovery wrapper with visited-URL deduplication and one 20-second deadline (ten-second per-request maximum); verify page success avoids root requests, no-feed/upstream failure triggers root discovery, exact origin preservation, redirected/already-checked root skipping, candidate deduplication, invalid/rejected URL behavior, deadline cancellation including body reads, and deterministic 422/502 outcomes. Verify the shared discovery default and Google Reader callers retain their existing behavior.
- [x] 1.2 Add authenticated `POST /api/v1/subscriptions/discover` with the design's request/response shape and mapped errors; add API contract coverage for success, invalid input, unauthenticated rejection before discovery, and unchanged database counts after preview. Verify the existing creation path still enforces foreign-folder rejection and duplicate 409 behavior.
- [x] 1.3 Document the discovery endpoint, page-then-origin-root order, deadline, and side-effect boundary in docs/01-architecture.md and docs/05-frontend.md; verify the documented route and DTO match the implementation and keep the Google Reader contract untouched.

## 2. Bookmarklet installation and RSSFinder recovery

- [x] 2.1 Add the Subscribe bookmarklet builder and draggable/copyable Settings card using the post-mount href pattern; verify tests execute the generated snippet with mocked page/window values to check deployment origin, named popup, source/title query round-trip, and retained Read later behavior.
- [x] 2.2 Add the fixed-origin RSSFinder URL helper and fallback link to SubscribeModal; verify reserved-character/Unicode query round-trips, no link on invalid/auth/409 states, error input retention, link clearing on URL edit, and retry success in helper/component tests.
- [x] 2.2a Update SubscribeModal submission to discover through the web endpoint before creating the resolved-feed subscription; verify homepage-only feed success with chosen title/folder, page-feed precedence, one-submit behavior, pending-click prevention, and RSSFinder using the original source after page/root failure. Verify final feed validation does not fall back to a different homepage feed.
- [x] 2.3 Document both bookmarklet installation and manual-dialog fallback in docs/05-frontend.md; verify instructions match Settings labels and the actual rssfinder.app destination with the requested RSSFinder.com label.

## 3. Authentication return flow

- [x] 3.1 Preserve `/subscribe` path/search through the guard's login redirect and add a shared narrow return-destination validator; verify same-origin `/subscribe` round-trips and rejection of external, protocol-relative, backslash, malformed, and unsupported destinations in focused tests.
- [x] 3.2 Resume the validated destination after successful Login and permanent-password completion, retaining it through password-reset screens; verify login tests cover popup resumption without auto-subscription and ordinary sign-in still navigating to `/`.
- [x] 3.3 Document the subscription return flow in docs/05-frontend.md's auth section; verify it describes the accepted internal destination and default landing behavior accurately.

## 4. Subscription popup

- [x] 4.1 Add typed API access and a React Query discovery query plus a lazy `/subscribe` surface in Shell; verify loading, bad/missing input, direct access, no reader chrome, discovery failure/retry, and stale result isolation when source parameters change in routing/component tests.
- [x] 4.2 Add the discovered-name heading and feed URL, optional title, owned-folder choices, Cancel and Subscribe, and disabled/pending states; verify no write before confirmation, Cancel without writes, fallback name order, and submission of the resolved feed URL plus selected title/folder.
- [x] 4.3 Reuse the subscription mutation for creation and add success/Close, duplicate, and failure/retry states with RSSFinder recovery; verify choices survive failure, repeat clicks are prevented, 409 does not overwrite existing settings, and cancellation still leaves a safe state when closing is unavailable.
- [x] 4.4 Document `/subscribe`, popup behavior, state ownership, and error recovery in docs/05-frontend.md; add the roadmap entry/current-state handoff and dated decision entry in docs/06-roadmap.md and docs/decisions.md with implementation and verification status accurate at landing.

## 5. Integrated acceptance

- [x] 5.1 Run the relevant core/service/API integration suites against disposable Docker Postgres, affected web tests including existing Read later/Login/SubscribeModal tests, `pnpm lint`, `pnpm typecheck`, `pnpm build:web`, and `pnpm build:lambdas`; verify all pass and the unchanged Google Reader conformance suite still runs and passes.
- [x] 5.2 Perform browser acceptance with deterministic discovery fixtures and the installed bookmarklet: confirm popup sizing/focus, keyboard operation, signed-out resumption, title/folder subscription and first-fetch hook, Cancel without side effects, already-subscribed state, page-feed precedence and homepage-only fallback in both web flows, RSSFinder after both stages fail, repeated bookmarklet activation, and responsive light/dark styling; record results and remaining browser limitations in the implementation handoff.
