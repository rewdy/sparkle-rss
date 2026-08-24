# 06 — Roadmap

Phases are ordered by dependency and risk retirement, not by calendar. Each phase has
explicit exit criteria — do not start the next phase until they pass.

## Phase 0 — Foundations & risk spikes

**Goal:** prove the two riskiest assumptions before any real code: Aurora DSQL
connectivity from Lambda, and the auth split.

- [x] Repo scaffold: pnpm workspace, `apps/{api,web}`, `packages/{core,db,tooling}`,
      Biome, Vitest, TS strict, CI workflow running green on a trivial commit.
- [ ] **Spike A — DSQL**: create a short-lived scratch DSQL cluster (tagged
      `sparkle=spike`, deleted immediately after; logged in `docs/decisions.md`); connect
      from laptop (`@aws-sdk/dsql-signer` + `pg`) and from a scratch Lambda. Verify:
      `gen_random_uuid()` availability, Drizzle Kit push/migrate against DSQL, token
      recycling pattern, latency from Lambda.
  - [x] Laptop connectivity, `gen_random_uuid()`, Drizzle migration against DSQL,
        write-path smoke test, idempotent journal re-run — all green (findings A1–A12 in
        `docs/decisions.md`).
  - [ ] Lambda-side latency check (lands naturally with the Phase 1 api function).
- [x] **Spike B — auth split**: Cognito pool + hosted UI verified live via TF-managed
      stack (token mint, jose JWKS verification, hosted-UI reachability); stub
      `ClientLogin` covered by unit tests. Caught the missing-`aud` access-token gotcha
      pre-deploy (decisions.md).
- [x] Record spike outcomes (gotchas, deviations) in `docs/decisions.md`.

**Exit:** both spikes demoed end-to-end; gotchas folded back into docs 03/04. ✅
(Lambda-side DSQL latency check deferred to Phase 1 where a Lambda exists.)

## Phase 1 — Infrastructure skeleton

**Goal:** empty-but-real deployment through the full pipeline.

- [x] Terraform remote state (S3 + native locking via `use_lockfile`), OIDC deploy role
      (`sparkle-rss-github-deploy`), `envs/prod` composed from modules.
- [x] Modules: dns, web, auth, api, ingest, db — deployed; ingest runs stub handlers on a
      5-minute schedule with SQS+DLQ wired.
- [x] CloudFront serves the SPA at the real domain; `/api/*` reaches the Lambda;
      Cognito login works in production (admin-created user verified end-to-end).
- [x] GH Actions: main-branch apply pipeline (`deploy.yaml`, OIDC, no static keys);
      lambda zip packaging. PR-level terraform plan deferred (solo-maintainer repo).

**Exit:** ✅ `https://app.sparklerss.com` loads the SPA, Cognito tokens authenticate
through the API Gateway JWT authorizer, and a protected `/api/v1/ping` returns
`{ok:true}` — deployed by CI from a clean checkout.
(First apply was bootstrapped from laptop before the OIDC role existed; logged in
decisions.md. Lambda↔DSQL latency measurement still open for Phase 2.)

## Phase 2 — Domain core

**Goal:** real data model and the first-party API the web UI will consume.

- [x] Drizzle schema + migrations (all tables from doc 03) applied to DSQL.
- [x] `packages/core` services: users, folders, subscriptions (+ URL discovery),
      entries (keyset pagination / unread / starred / mark-all-read), settings,
      api tokens, opml import/export.
- [x] `/api/v1`: me, folders CRUD, subscribe/unsubscribe, rename/move,
      entry listing with cursors, read/star toggles, mark-all-read, unread-counts,
      settings, OPML, API-token mint/revoke. Zod-validated, AppError-mapped.
- [x] Integration suites: service layer (`packages/db/test`) + HTTP contract
      (`apps/api/test/api.int.test.ts`) against Dockerized Postgres; migrations
      verified on DSQL (spike + pipeline migrate step).

**Exit:** ✅ contract suite green (62 tests) and live curl walkthrough of every
`/api/v1` route against production — including real-feed discovery
(hnrss.org → "Hacker News: Front Page"), folder move, OPML round-trip, token mint.
Remaining Phase-2+ follow-up: first-fetch backfill of entries lands with Phase 3 ingest.

## Phase 3 — Ingestion pipeline

**Goal:** feeds refresh themselves; OPML in/out works.

- [x] Orchestrator + SQS + worker: conditional GET (ETag/Last-Modified, manual
      redirects w/ permanent-hop persistence), `rss-parser`, `sanitize-html`
      allowlist, per-subscriber `ON CONFLICT` dedupe, exponential backoff capped
      at 24 h, partial-batch failure reporting.
- [x] OPML import/export over `/api/v1` incl. folder structure (shipped with
      Phase 2; web UI lands with Phase 5).
- [x] Alarms: DLQ depth, worker/orchestrator errors → SNS topic
      (`sparkle-rss-alerts`; subscribe an email to receive notifications).
      Structured JSON logs on every handler.

**Exit:** ✅ live verification 2026-08-24: orchestrator dispatch → worker fetched
hnrss.org → 20 sanitized unread entries served via `/api/v1/entries`;
failure path covered by integration test (404 feed → error_count/backoff recorded,
feed excluded from due set). OPML 100-feed scale test deferred to real usage —
mechanics identical to the verified single-feed path.

## Phase 4 — Google Reader API parity

**Goal:** NetNewsWire syncs. This is the compatibility milestone.

- [x] Every endpoint from doc 02 implemented behind `/api/greader.php`, sharing
      `packages/core` services with `/api/v1` (ClientLogin via DB-backed API tokens +
      stateless HMAC credentials; HMAC key in Secrets Manager).
- [x] **Conformance suite** (`apps/api/test/greader.conformance.test.ts`): 15 contract
      tests covering auth guard, discovery subscribe, dual id forms, timestamp units
      (sec/msec/usec strings), continuation pagination, xt filters, write-token quirks
      (empty/x tolerated, forged rejected), folder lifecycle through tags, OPML
      round-trip, mark-all-as-read ns bounds.
- [ ] NetNewsWire E2E checklist (doc 02) against a real device — **manual, pending**.
      Server URL `https://app.sparklerss.com/api/greader.php`; username `andrew`;
      password = an `srk_…` API token minted in settings.

**Exit:** conformance suite green in CI ✅ and live-verified 2026-08-24 (auth → list →
streams → edit-tag → unread-count against production data). Device E2E remains the final
gate before calling the milestone fully done.

## Phase 5 — Web reader MVP

**Goal:** the UI that makes this worth hosting.

- [x] Minimal-reader layout: collapsible sidebar (folders/feeds + unread badges),
      date-grouped infinite entry list, focused reading pane overlay,
      dark/light schemes, Space Mono chrome + sans reading surface
      (terminal-inspired theme from hn-tok).
- [x] Settings page: color scheme, density, mark-on-open, API token mint/revoke
      (shown once + copy), OPML import/export, sign out.
- [x] PKCE auth against Cognito hosted UI with silent renew; guarded shell;
      optimistic read/star mutations; cursor-based infinite scroll;
      unread badge correctness via single counts query invalidation.
- [x] Keyboard-first: j/k navigate, m read, s star, Esc close, Shift+A mark stream
      read, ? shortcut sheet.
- [ ] Lighthouse pass + virtualization for very long lists → Phase 6 polish.

**Exit:** ✅ deployed and live at app.sparklerss.com (bundle carries Cognito config
injected from tf outputs). Daily-driveable loop verified by author during Phase 6
usage window; design direction: terminal-inspired, colors adjustable.

## Phase 6 — Hardening & polish

- [ ] Security headers/CSP verified, rate limits tuned, token revocation UX.
- [ ] PWA manifest + offline shell; image lazy-loading pass.
- [x] Feed favicon pipeline: icon extracted at ingest (RSS `<image>`, Atom `<logo>`/`<icon>`)
      into `feeds.icon_url` (GReader `iconUrl` populates automatically); web sidebar shows
      feed icons with a domain-favicon fallback.
- [x] Immediate first fetch: subscribing (web UI, OPML import, or GReader client) enqueues
      the new feed on the refresh queue — fetched within seconds instead of the next
      5-minute orchestrator run.
- [x] Route-driven views: article view is `<stream>/e/:id` so back/forward work (deep links
      fetch via `GET /api/v1/entries/:id`); `/today` and `/unread` streams added; standing
      requirement that all view changes go through routes (doc 05).
- [ ] Billing alarm + cost review against doc 04 table; log retention policies.
- [ ] Docs refresh: architecture diagrams vs reality, runbook additions from ops
      experience.
- [ ] Deferred-feature decision point: search, labels, WebSub — re-prioritize using
      real usage.

**Exit:** two weeks of daily use by the author across NetNewsWire + web with zero
manual interventions; cost within estimate.
