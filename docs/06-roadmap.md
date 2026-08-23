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
- [ ] **Spike B — auth split**: Cognito pool + hosted UI + PKCE SPA login against a
      hello-world JWT-authorizer route; separately, a stub `ClientLogin` route validating
      a hardcoded token.
- [ ] Record spike outcomes (gotchas, deviations) in `docs/decisions.md`.

**Exit:** both spikes demoed end-to-end; gotchas folded back into docs 03/04.

## Phase 1 — Infrastructure skeleton

**Goal:** empty-but-real deployment through the full pipeline.

- [ ] Terraform remote state (S3 + native locking), OIDC deploy role, `envs/prod`.
- [ ] Modules: dns, web, auth, api, ingest, db — deployed with hello-world handlers.
- [ ] CloudFront serves the SPA at the real domain; `/api/*` reaches the Lambda;
      Cognito login works in production.
- [ ] GH Actions: PR plan + main-branch apply pipeline, lambda zip packaging.

**Exit:** `https://<domain>` loads the SPA, logs in via Cognito, and calls a protected
`/api/v1/ping` returning `{ok:true}` — all deployed by CI from a clean checkout.

## Phase 2 — Domain core

**Goal:** real data model and the first-party API the web UI will consume.

- [ ] Drizzle schema + migrations (all tables from doc 03) applied to DSQL.
- [ ] `packages/core` services: subscriptions, folders, entries, streams, settings.
- [ ] `/api/v1`: me, folders CRUD, subscribe/unsubscribe (with URL discovery),
      rename/move, entry listing (keyset pagination), mark read/star, mark-all-read,
      settings, API-token mint/revoke.
- [ ] Integration tests against Dockerized Postgres (same migrations).

**Exit:** API contract test suite green against DSQL; curl walkthrough of every
`/api/v1` route documented in a test script.

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
