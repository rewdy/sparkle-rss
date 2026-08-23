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

- [ ] Orchestrator + SQS + worker with conditional GET, `rss-parser`, `sanitize-html`,
      per-subscriber upsert dedupe, backoff + redirect persistence.
- [ ] OPML import/export (web UI + `/api/v1`), including folder structure.
- [ ] Alarms: DLQ depth, error rates; structured logs queryable.

**Exit:** import a 100-feed OPML → all feeds fetch, entries appear with sanitized
content, unread counts correct; a deliberately broken feed backs off and lands in
`feeds.last_error` without noise.

## Phase 4 — Google Reader API parity

**Goal:** NetNewsWire syncs. This is the compatibility milestone.

- [ ] Implement every endpoint in doc 02 behind `/api/greader.php`, sharing `packages/core`
      services with `/api/v1`.
- [ ] **Conformance suite**: scripted curl/fixture tests per endpoint (golden JSON
      snapshots, ID-form round-trips, timestamp unit conversions, token quirks).
- [ ] NetNewsWire E2E checklist (doc 02) against a real device.

**Exit:** every checklist box ticked on iOS *and* macOS NetNewsWire; conformance suite in
CI.

## Phase 5 — Web reader MVP

**Goal:** the UI that makes this worth hosting.

- [ ] Minimal-reader layout per doc 05: sidebar + streams + focused reading pane,
      keyboard shortcuts, dark/light/system, date-grouped virtualized list.
- [ ] Settings: appearance, API tokens (mint/revoke), OPML import/export UI.
- [ ] Optimistic mutations, cursor-based infinite scroll, unread badge correctness.

**Exit:** daily-driveable reading loop entirely in the browser; Lighthouse ≥90 on
performance/a11y for the main view; all state-management contract rules (doc 05) hold in
review.

## Phase 6 — Hardening & polish

- [ ] Security headers/CSP verified, rate limits tuned, token revocation UX.
- [ ] PWA manifest + offline shell; image lazy-loading pass; feed favicon pipeline.
- [ ] Billing alarm + cost review against doc 04 table; log retention policies.
- [ ] Docs refresh: architecture diagrams vs reality, runbook additions from ops
      experience.
- [ ] Deferred-feature decision point: search, labels, WebSub — re-prioritize using
      real usage.

**Exit:** two weeks of daily use by the author across NetNewsWire + web with zero
manual interventions; cost within estimate.
