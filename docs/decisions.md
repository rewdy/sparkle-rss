# Decisions & Spike Log

Append-only log. Architecture decisions D1–D8 live in
[00-overview.md](./00-overview.md); this file records Phase-0 spike outcomes and any
course corrections discovered during implementation.

## Process correction (2026-08-22)

During Spike A, AWS resources were initially created by hand before a policy was agreed.
Clarified policy, now encoded as AGENTS.md invariant #2:

- Terraform owns everything that persists (`tf apply` = complete, `tf destroy` = no trace).
- Manual resources are allowed only for short-lived spikes, must be tagged `sparkle=spike`,
  and MUST be deleted immediately after; created/destroyed logged below.

## Resource ledger (Spike A)

| Identifier | How | Purpose | End state |
| --- | --- | --- | --- |
| `3ruavvj6ydxabjru5d24v46aza` | manual CLI | initial connectivity probe | deleted |
| `unuavwd4dlkvf5my3gprugycku` | manual CLI (tagged `sparkle=spike-a`) | cache/tombstone probes | deleted |
| 10× TF-managed dev clusters (dbuavxnqga…, dzuavxnqga…, ozuavydua7…, 5juavyx4zg…, fzuavyx4zg…, vvuavyx4zg…, druavzp66se…, fjuavzp66sw…, vruavzp66sl…, +1) | `terraform apply` in `tf/envs/dev` | iterative migration validation | all destroyed via `terraform destroy` |

Final verification: `aws dsql list-clusters` → `[]`. **Zero residue.**

## Spike A — Aurora DSQL: findings (2026-08-22)

Setup validated end-to-end: laptop → `@aws-sdk/dsql-signer` (admin token) → `pg` →
full Drizzle migration applied → smoke write path (insert user/feed/subscription/entry,
unread count, mark-read) → idempotent re-migration via journal. Repeated
create/migrate/destroy cycles through Terraform.

### Engine constraints discovered (all encoded in code now)

| # | Constraint | Mitigation (where) |
| --- | --- | --- |
| A1 | Identity columns require explicit `CACHE` ≥ 65536 or `= 1`; default PG identity fails | `.generatedAlwaysAsIdentity({ cache: 1 })` everywhere (`schema.ts`) — identical semantics to vanilla default |
| A2 | No `serial`/`bigserial` pseudo-types; drizzle's built-in journal table uses `serial` | `ensureMigrationJournal()` pre-creates `drizzle.__drizzle_migrations` with compatible identity (`packages/db/src/dsql-journal.ts`) |
| A3 | **No FOREIGN KEY constraints at all** (inline or ALTER) | Schema has no `.references()`; integrity + cascade deletes enforced by repositories in `packages/core` (Phase 2). Decision recorded in doc 03 |
| A4 | Standalone `ALTER TABLE … ADD CONSTRAINT` rejected | FKs (if ever reintroduced) must be inline; guardrail codemod `packages/db/scripts/inline-fks.mjs` wired into `pnpm db:generate` |
| A5 | Index creation requires async mode: plain `CREATE INDEX` rejected with "please use CREATE INDEX ASYNC" | Runtime rewrite in `migrateDsql()` only — vanilla PG can't parse ASYNC, so generated files stay portable (`dsql-migrator.ts`) |
| A6 | Partial indexes (`WHERE …`) unsupported | Composite indexes carrying state columns instead (e.g. `(user_id, is_read, feed_id, published_at)`); same queries, fine at personal scale |
| A7 | Sort order (`DESC`) in index keys unsupported | Plain ASC keys; btree backward scans serve `ORDER BY … DESC` on both engines |
| A8 | Multiple DDL statements in one transaction rejected | drizzle's stock runtime migrator unusable → custom statement-per-statement migrator with drizzle-compatible journal (`dsql-migrator.ts`); local/docker keeps stock transactional migrator |
| A9 | Multi-target `DROP TABLE a, b, c` silently unreliable | Always issue single-target DDL statements (our generated SQL is single-statement throughout) |
| A10 | DDL acknowledgments are unreliable during early cluster life — CREATE may return "already exists" while the object materializes asynchronously; even same-connection catalog reads can lag | Migrator tolerates already-exists for CREATE statements and logs loudly; fresh-cluster-per-cycle workflow (cheap via TF) sidesteps the window entirely |
| A11 | Dropped table names stay blocked for the cluster's lifetime (verified: 20 retries over 5 min never freed `api_tokens`) | Never drop-and-recreate names on one cluster; use a fresh cluster per cycle |
| A12 | Connecting as DB user `admin` requires action `dsql:DbConnectAdmin` + `getDbConnectAdminAuthToken()` (plain `DbConnect` tokens map to fine-grained users, not admin) | Pool factory + migrations use admin token; cluster policy grants both actions to allowed principals |

### Terraform provider notes

- `aws_dsql_cluster` exposes no `endpoint` attribute — derived from identifier:
  `<identifier>.dsql.<region>.on.aws`.
- `aws_dsql_cluster_policy` takes `policy` (not `policy_document`); no `skip_destroy`.

### Operational consequences

- **Migrations**: forward-only, single-statement, applied via `pnpm db:migrate`
  (auto-selects DSQL runner when `DSQL_ENDPOINT` is set). Dev cycle = new cluster, not
  drop/recreate.
- **Schema source of truth stays one file** (`packages/db/src/schema.ts`) valid on both
  engines; only index-DDL syntax is rewritten at runtime for DSQL.
- **Latency from Lambda**: still pending — validates naturally in Phase 1 when the api
  Lambda deploys against the real cluster.

## Spike B — Auth split: findings (2026-08-22)

TF-managed Cognito stack (`tf/modules/auth`: invite-only pool, PKCE SPA client, hosted-UI
domain with random suffix) applied via `tf/envs/dev`, then verified against live AWS:

- Test user created via `admin-create-user` + `admin-set-user-password`; token minted via
  `ADMIN_USER_PASSWORD_AUTH`.
- `jose` JWKS signature verification against the live issuer: OK (~200 ms first fetch).
- Hosted UI `/oauth2/authorize` → 302 to sign-in page; JWKS endpoint → 200.
- **Bug caught before deploy**: Cognito ACCESS tokens carry **no `aud` claim** — the
  client is identified by `client_id`. jose's `audience` option would have rejected every
  valid access token. Production middleware now verifies signature + issuer via jose,
  then asserts `client_id` and `token_use === 'access'` manually
  (`apps/api/src/app.ts`). Same fix applied to the spike verifier.

### Resource ledger (Spike B)

| Identifier | How | Purpose | End state |
| --- | --- | --- | --- |
| `us-east-1_uC6VdGZhM` pool + client `5jrasi1qe3f28gaqemf1lhl42r` + domain `sparkle-dev-8413a8c4` | terraform apply (`tf/modules/auth`) | hosted-UI/PKCE/JWKS verification | destroyed |
| cluster `m5uawkls6lidkh633b5apngx7e` | same apply | re-verify migrate+smoke after schema changes | destroyed |

Final verification: `aws dsql list-clusters` → `[]`; `list-user-pools` → none. **Zero
residue.**

### Operational consequences

- Phase 1's `auth` module is ready for prod composition (custom domain + cert later).
- The web API middleware's Cognito verification logic is proven against real tokens;
  remaining auth work is plumbing (hosted UI in the SPA, API Gateway JWT authorizer
  config — which performs its own verification server-side).

## Phase 1 — production bring-up (2026-08-23)

- `tf/envs/prod` composes all modules; state in S3 (`drewmey--devops-tf-state`,
  native locking via `use_lockfile`). First apply bootstrapped from laptop because the
  GitHub OIDC role is itself Terraform-managed (chicken-and-egg); every later apply runs
  through `deploy.yaml`.
- Live endpoints verified: SPA 200, SPA-fallback route 200, `/api/greader.php` → OK,
  protected `/api/v1/ping` → `{ok:true}` with a Cognito access token, `/api/v1/me`
  returns the real `sub`. JWT authorizer correctly rejects anonymous calls.
- Config errors hit during first apply (all fixed in modules): DSQL policy needs explicit
  `Version`; HTTP API v2 access logs reject `$context.http.method/path`; Lambda reserves
  the `AWS_REGION` env var; CloudFront managed policy names carry a `Managed-` prefix.
- Prod user creation stays manual/ops (`admin-create-user`) per invite-only decision D2.
- Fork configuration surface: `tf/envs/prod/terraform.tfvars` (domain, prefixes, repo) +
  backend bucket via `-backend-config` / repo variable `TF_STATE_BUCKET` + GitHub
  variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`.

## Phase 1 — pipeline debugging (2026-08-23)

Three issues found and fixed while standing up the deploy pipeline:

1. **GitHub OIDC `sub` format**: this account mints tokens with embedded IDs
   (`repo:rewdy@412050/sparkle-rss@1343344919:ref:refs/heads/main`), so standard
   sub patterns never matched. AWS also *requires* trust policies to scope on
   `sub`/`job_workflow_ref` (dropping it is rejected). Final policy: `aud` equals,
   `repository` equals, `ref` equals, plus dual-shape scoped `sub` StringLike.
2. **Terraform removed from GitHub hosted runners** → `hashicorp/setup-terraform@v3`
   (`terraform_wrapper: false`) added to both workflows.
3. **Backend block lost**: a main.tf rewrite dropped `terraform { backend "s3" {} }`,
   silently pinning both laptop and CI to local state. Diagnosed via
   EntityAlreadyExists storms on CI; fixed by restoring the block and force-migrating
   the 67-resource state to S3. Lesson: after any backend-affecting refactor, run
   `terraform init -no-color` and read the warnings.

Deploy role IAM was widened incrementally (route53 tags/change, OIDC provider CRUD) —
each gap surfaced as an AccessDenied during plan/refresh.

**End state**: `deploy.yaml` runs green end-to-end on push to main: quality gate →
build → OIDC assume → tf init/plan/apply (S3 state + native locking) → DSQL migrations →
asset sync + CloudFront invalidation.

## Phase 3 — ingestion live (2026-08-24)

- End-to-end verified in production: orchestrator → SQS → worker → DSQL fanout →
  `/api/v1/entries`. hnrss.org returned no ETag (Last-Modified only) — conditional
  GET handles both validators.
- Deploy-role IAM expansions are chicken-and-egg: the pipeline cannot grant itself
  new permissions, so role changes must be laptop-applied once before the next push
  (bit us twice with SNS/cloudwatch alarm perms). Now standard practice.
- Worker swallows per-record fetch errors after recording backoff (SQS redrive is
  reserved for genuinely broken messages via ReportBatchItemFailures).
- Feed claiming bumps `next_fetch_after` before enqueue; overlapping orchestrator
  runs therefore never double-dispatch.

## Phase 4 — greader parity live (2026-08-24)

- Full Google Reader surface implemented over the shared service layer; conformance
  suite (15 tests) runs in CI against Docker Postgres.
- Live production walkthrough verified: ClientLogin → subscription/list (folder
  categories intact) → unread-count (per-feed/folder/reading-list rollups, usec
  strings) → items/ids (+xt=read exclusion) → stream/contents envelopes (long-form
  ids, sanitized summaries) → edit-tag read toggle reflected in counts.
- Gotchas encoded by tests: Hono parseBody drops repeated form keys (greader clients
  repeat i=/a=/r=) → raw URLSearchParams parsing; JS object literals cannot express
  duplicate keys in tests; GR item envelopes require title alongside summary.
- Auth model: ClientLogin verifies Email=username + srk_ token, returns stateless
  `<userId>/<HMAC(key, userId:tokenHash)>` credential; requests re-derive from stored
  token hashes. HMAC key lives in Secrets Manager (`sparkle/prod/greader-hmac-key`),
  generated by Terraform.

## Phase 5.1 — reader improvements + immediate ingest (2026-08-24)

Session batch (commits `70b9d30`, `c3308ff`, `6b73d2f`, `985fcf4`). Decisions worth keeping:

- **The article view is a route** (`<stream>/e/:id`, e.g. `/all/e/123`), not modal
  state. Select/j/k push a history entry each; close/Esc replaces back to the bare
  stream path; deep links render from the list cache or fetch via
  `GET /api/v1/entries/:id` (404 across users). Standing requirement in doc 05:
  every view change goes through a route.
- **`/today` and `/unread` are virtual streams**: API stream `all` plus `pubFrom`
  (local midnight, client-computed) or `filter=unread`. Distinct client query keys;
  **no** greader surface change (doc 02 untouched).
- **Immediate first fetch**: `onSubscribed` hook on the subscriptions service →
  api Lambda sends the same `{ feedId }` message to the refresh queue (best-effort —
  a failed enqueue never fails the subscribe; no-op under `NODE_ENV=test`;
  in-process `processFeed` in local dev where there is no SQS). One hook covers web
  subscribe, OPML import, and GReader subscribe. Api Lambda gained `QUEUE_URL` +
  `sqs:SendMessage` (tf modules `api`/`ingest`).
- **Feed icons**: extracted at discover (subscribe time — new feed rows only) and at
  ingest (`recordSuccess` writes a non-empty `icon_url` only, so a feed that drops
  its icon keeps the stored one). Sources: RSS `<image><url>`, Atom `<logo>`/`<icon>`
  (rss-parser 3.13 `customFields.feed` — a single shared `feed` key, not per-format).
  Web sidebar falls back to a domain favicon service. GReader `iconUrl` populates
  automatically (already in the doc 02 contract — no change).
- **Theme persistence fix**: jotai base atoms now initialize from localStorage
  pre-mount; server settings apply through `getDefaultStore()`. The previous
  "mutate `atom.init` after mount" hydration was a silent no-op — that's why
  light/dark never stuck (density and mark-on-open were affected too).

## CI red herring: terraform fmt (2026-08-24)

`ci.yaml`'s `terraform fmt -check` had been failing on **every** push since 2026-08-24
15:57 — a pre-existing misaligned `locals` block in `tf/envs/prod/main.tf` that landed
with the local-dev-workflow commit. Because `deploy.yaml` doesn't run fmt and was green,
the red `ci` went unnoticed until the next deploy batch. Fixed in `985fcf4`.
Lesson: watch both workflows — a green deploy is not a green repo.

## Phase 6 — security hardening pass (2026-08-24)

- **Prod response-headers verified by curl** (both the S3/SPA default behavior and the
  `/api/*` behavior, which 401s without a token but still carries the headers):
  `content-security-policy` (default/script 'self', img/media https:, connect-src +
  frame-src scoped to the Cognito origins, `frame-ancestors 'none'`, base-uri +
  form-action 'self'), `strict-transport-security: max-age=31536000; includeSubDomains`,
  `x-frame-options: DENY`, `x-content-type-options: nosniff`,
  `referrer-policy: strict-origin-when-cross-origin`. All four cache behaviors attach
  the same policy in `tf/modules/web`; nothing to fix.
- **API GW throttling confirmed live** via `aws apigatewayv2 get-stage` (us-east-1,
  `$default` stage of `sparkle-rss-api`): rate 25/s, burst 50 — exactly the
  `default_route_settings` declared in `tf/modules/api`. Chosen values: a real
  NetNewsWire sync burst is well under 50 concurrent requests; 25/s sustained is
  generous for 1–3 users. If syncs ever start seeing 429s, API GW's
  `ThrottledRequests` metric in CloudWatch will show it (note: doc 04's
  "5xx/throttle alarms" for the api module does not exist in tf yet — flagged for
  the docs-refresh chunk to reconcile). No per-route overrides.
- **Token revocation now confirms first** (settings UI): the revoke button opens a
  small modal naming the token by label and warning that the client is disconnected
  immediately, instead of firing the mutation on click. Follows the existing
  subscribe/shortcuts `Modal` convention (component-local state, no new atom —
  server state still flows through react-query).

## Phase 6 — virtualization + Lighthouse pass (2026-08-24)

- **Entry list is virtualized** (`@tanstack/react-virtual` 3.14, `directDomUpdates`):
  day-group headers + entries flatten into one flat virtualized row list; row heights
  are measured dynamically (titles wrap to variable height); overscan 15. With
  `directDomUpdates`, positions of already-mounted rows are written to the DOM
  directly while scrolling; React only re-renders when the visible range changes.
  Verified against a 1,065-entry local stream (61.8kpx scroll height): 29–46 rows in
  the DOM throughout, **0 frames >33ms**, p99 frame 21ms, reached "end of stream".
- **j/k and deep links now scroll the active entry into view** (`scrollToIndex`,
  align auto). Previously nothing scrolled the list at all; with virtualization the
  target row must exist in the DOM, so this became a requirement, not a nicety.
- **Skeletons replace the "loading…" row** on first load (12 fixed-height rows
  matching the real row footprint) — also removes the list-replacement layout shift
  (Lighthouse CLS was 0 with it).
- **Bug found + fixed**: the infinite-scroll sentinel's `IntersectionObserver` used
  the viewport as root, but the list is a *nested* scroller — with virtualized (tall)
  content the sentinel only becomes reachable relative to the container. Now
  `root: scrollRef.current`. (It happened to work before because 50 non-virtualized
  rows fit close to the viewport; the virtualized 60kpx box exposed it.)
- **Auth guard fast-paths in dev**: with `VITE_AUTH_DISABLED=true` the guard starts
  `authed` instead of flashing "checking session…" first (removes a loader→shell
  layout shift in local runs; prod Cognito flow untouched).
- **Code-split the heavy, non-essential UI**: `/settings`, the subscribe dialog
  (extracted to `components/SubscribeModal.tsx`), and the `?` shortcut sheet are
  `React.lazy` chunks loaded on first open; `openEntry` is a stable `useCallback` so
  memoized rows don't re-render on every Shell render. `vite preview` now proxies
  `/api` like the dev server, so the production build can be exercised locally.
- **Lighthouse pass (local): 75/100, and the score chase was stopped by user
  decision.** Measured against the prod build via `vite preview` with dev auth
  (standard for an auth-walled SPA — prod is behind Cognito), default desktop
  throttling (Slow-4G + 4x CPU): CLS 0, TBT 20ms, FCP/LCP ≈ 2.2s. The real
  (unthrottled) FCP is ~190ms; the simulated gap is mostly model floor (562ms
  simulated TTFB + 150ms RTT) plus ~150kB-gz critical JS (react-dom, Mantine,
  TanStack Query, floating-ui via tooltips/modals). Code-splitting cut the critical
  JS 162→150kB gz. User call (2026-08-24): personal-use app — no further bundle/CSS
  diet. Concretely reverted/abandoned for it: Mantine `Tooltip` in the topbar had
  been swapped for native `title` attrs (−20kB gz) — **reverted** because the styled
  tooltips look and function better; the planned theme color-scale CSS trim
  (~2–3kB gz, real risk of subtle visual regressions) — not done.
- **Doc/code discrepancy found, not fixed (needs a decision)**: the roadmap's landed
  item "web sidebar shows feed icons with a domain-favicon fallback" has no backing
  code — `Subscription.iconUrl` exists end-to-end (API, types) but the sidebar
  renders no icons at all. Flagged for a future chunk or a decision that the item
  was never actually shipped.

## Public marketing site at the apex (2026-08-25)

Added `apps/site` (Astro, static) served at `sparklerss.com`; `www.sparklerss.com`
301-redirects to the apex. Decisions:

- **Astro over the existing Vite/React stack.** The site is static marketing content, not
  an app; Astro ships zero-JS pages and a content-friendly authoring model. It joins the
  workspace via `pnpm -r --if-present build/typecheck`, so CI/CD picks it up with no
  workflow changes beyond the publish step.
- **New `tf/modules/site`, not a reuse of `web`.** The web module is tightly coupled to the
  SPA (SPA rewrite, `/api/*` origins, SPA-specialized CSP). The site is S3-only with its
  own CloudFront distribution, security-headers policy (CSP allows Google Fonts), and a
  single CloudFront Function that both redirects `www`→apex and maps pretty URLs
  (`/setup/`) to the `index.html` files Astro emitted — S3 REST origins don't auto-serve
  index.html for directory paths.
- **Second ACM cert in the dns module** for apex + `www` SAN (us-east-1, DNS validation),
  gated by `create_site_cert`; the site module is `count`-gated by `create_site` so a fork
  can disable it cleanly.
- **Design language matches the reader** (Space Mono + DM Sans, terminal-inspired
  dark/light, same neutral/accent palette) so the marketing site and app feel like one
  product. Landing page is intentionally "spiced up" relative to the app's calm reader.
- **Setup guide is a single hand-authored `/setup` page** for v1; may move to a content
  collection if it grows.

- **Deploy-role S3 scope widened for the site bucket.** The OIDC deploy role's
  `WebAssetsBucket` statement was scoped to `sparkle-rss-web-*` only; the new site bucket
  (`sparkle-rss-site-*`) would have failed both `terraform apply` and the site publish step.
  Added the site bucket ARNs to the same statement.

## Terraform → single "THE infra config" root (2026-08-25)

Collapsed the two env dirs into one root module to make fork-and-deploy a one-file edit.

- **`tf/envs/*` removed.** `prod` moved up to become `tf/` (root), so `tf/` is now the
  composition root and `tf/variables.tf` is the single fork-facing config. The ephemeral
  `dev` env (db + auth, localhost callbacks, local state, no CI) existed only for bring-up
  spikes (see Spike A/B) and was already fully destroyed; it is not part of the fork story.
- **New domain inputs are full FQDNs.** `app_domain` (e.g. `app.example.com`) replaces the
  old `root_domain` + `app_hostname` split; the hosted zone is derived as the parent of
  `app_domain`. `site_domain` is its own input, used only when `deploy_site = true`.
- **New site toggle.** `deploy_site` (default `false` — most forks run app-only) gates the
  site module and its apex+www edge cert. Our install sets it true at `sparklerss.com`.
- **New auth toggle.** `allow_signups` (default `false`, invite-only) drives Cognito's
  `admin_create_user_config.allow_admin_create_user_only` in the `auth` module.
- **Suggestion surfaced as var.** `alarm_email` was already wired null in the ingest module;
  it's now a root variable so forks enable infra alerts without touching the module.
- CI (`TF_DIR=tf`), `.gitignore` (`tf/backend.conf`), and all docs updated in this commit.
  State key is unchanged (`sparkle-rss/prod/terraform.tfstate`) so the existing state is
  preserved — no re-import needed.

## PR terraform plan via read-only role (2026-08-25)

Deploy role correctly trusts only `refs/heads/main` (it writes); PRs could never show
a real plan. Added a second, strictly read-only `sparkle-rss-github-plan` role to the
`github-oidc` module, trusting `pull_request` refs, with a policy limited to state
read + managed-service reads. `ci.yaml` gains a `plan` job (PR-only) that assumes it,
runs `terraform plan`, and prints the diff to the job summary.

No circular bootstrap: the plan role is created by the next normal deploy (which uses
the already-working deploy role), then surfaced via the `plan_role_arn` output. Until
the repo variable `TF_PLAN_ROLE_ARN` is set (one-time, after the role exists), the plan
job logs a notice and skips rather than failing — expected for the very PR that
introduces the role.

## Cognito hosted UI: custom domain + managed-login branding (2026-08-26)

The login screen was the default Cognito look on an `amazoncognito.com` prefix domain.
Two changes, all in Terraform:

1. **Custom domain** `auth.sparklerss.com` — us-east-1 ACM cert + validation records in
   the `dns` module, `aws_cognito_user_pool_domain` switched from prefix to FQDN, and a
   Route53 A-alias to the Cognito-managed CloudFront distribution. This replaces the
   prefix domain (one-time replacement; the old prefix name is freed). CSP
   connect-src/frame-src now reference the custom domain automatically via the existing
   `hosted_ui_domain` output.
2. **Managed login branding** (`aws_cognito_managed_login_branding` on the SPA client) —
   settings JSON in `tf/main.tf` mirrors the web app theme (accent indigo, neutral
   palette, small radii) with light+dark variants. Managed login does not accept raw CSS;
   assets (logo, favicon) are uploaded via the console and do not conflict with IaC
   settings. Known provider quirk: any change to branding *assets* forces resource
   replacement; settings-only edits update in place.

Rejection considered: classic hosted-UI CSS customization — unreliable on prefix domains,
no dark mode, deprecated direction vs managed login; skipped.

## Mobile styling pass (2026-08-26)

The reader had a "mobile collapse" that was unusable: the sidebar hid below `sm` but
nothing could re-open it. First small-screen pass:

- **Top-bar Burger toggles the sidebar as a full-screen drawer** below `sm`, auto-closing
  on navigation (Mantine AppShell `collapsed: { mobile }`; Mantine forces the mobile
  navbar to full width, so there is no tap-away backdrop — close via the Burger toggle or
  by selecting a list item).
- **Top bar de-crams on phones** via `visibleFrom="sm"`: stream title, the all/unread
  filter group, and "mark all read" become desktop-only; the Burger shows on mobile only
  (stream switching incl. All-unread vs All-items already lives in the sidebar drawer).
- **Reading pane goes full-bleed**: `100dvh` heights, `env(safe-area-inset-bottom)`
  insets on the reader and stream scroller (`viewport-fit=cover`), `≥40px` touch
  targets in header/reader, byline row hidden below `md`, iOS input auto-zoom
  suppressed with a `16px` floor, and `theme-color` meta follows light/dark.

## Deploy fix: Cognito managed-login branding settings schema (2026-08-26)

Since the auth branding PR, every `terraform apply` failed with
`InvalidParameterException: UnknownProperty` for `$.colorScheme`,
`$.componentClasses.containers`, and `$.componentClasses.inputs`. Those keys
are not part of the AWS managed-login `Settings` schema: the valid top-level
keys are `categories`, `componentClasses`, and `components`, and
`componentClasses` only accepts `buttons`/`input`/etc. (no `containers`/`inputs`).
Colors are not set via a `colorScheme` map.

`tf/main.tf` now emits schema-valid settings: `categories.global.colorSchemeMode`
(`AUTO`), `componentClasses.buttons/input.borderRadius`, and
`components.form.borderRadius`. Custom accent/background colors are intentionally
deferred — hand-coding them risks another rejected apply; the robust route is a
`DescribeManagedLoginBrandingByClient` read-modify-write round-trip.

Follow-up (same day): the first fix used `colorSchemeMode = "AUTO"`, which AWS
rejects as `InvalidValue` — the API only accepts `LIGHT` or `DARK` (the `AUTO`
option exists in the web console only). Set to `"DARK"` to match the app's
dark-first default.

## Feature: accent theme presets (2026-08-26)

Added five accent palettes (blue default, scarlet, steel, magenta, purple) selectable on
the settings appearance card as a swatch row (radios under each swatch). Chosen approach:
**a single Mantine `accent` color key whose values are swapped at runtime** rather than
per-theme CSS or per-component conditionals. All existing `--mantine-color-accent-*`
usages (component `color="accent"` props, `light-dark()` CSS vars for hover/active) adapt
automatically, and light/dark compatibility is free because they already use `light-dark()`.

- Persisted per-user as the `themeId` key in the existing `user_settings` jsonb blob
  (generic merge service / `GET|PUT /api/v1/settings` — no schema or API change). Restored
  cross-device by `applySettings()` beside `colorScheme`.
- Scaffolded as `ThemeDef` in `apps/web/src/themes.ts` (`buildTheme` composes each preset
  from the def; `THEMES[themeId]` selected in `MantineProvider`), so future style settings
  (e.g. fonts, density presets) extend `ThemeDef` without changing consumers.
- Three CSS accent-shade usages (entry-row hover/active, shadow) kept shared with shade
  indexes 0/1/6/9 per theme; user approved refining per-theme values later if needed.

## Feature: system color scheme preference (2026-08-29)

The web appearance preference now supports `light`, `dark`, and `system`. The stored
preference remains separate from the resolved scheme: when `system` is selected, the
frontend follows `prefers-color-scheme` and passes the resolved light/dark value to
Mantine, including browser `theme-color` metadata. The top-bar control cycles through
all three preferences and uses the sun-moon icon for `system`.

## Fix: token expiry / silent-renew root cause (2026-08-29)

Users repeatedly stalled on `/login` and hit errors on `auth.sparklerss.com`. The app client
requested scopes `openid profile email` on an `authorization_code` (PKCE) grant and renewal
failed during the boot guard's warm-up and the API client's 401 retry; when renew failed,
`renewToken()` fired a fire-and-forget full `logout()`, and `/login` had no error path —
hence the stuck spinner.

- **Renewal needs no new scope.** Cognito returns a refresh token automatically for the
  `authorization_code` grant (its token endpoint issues one only for that grant type), so
  the client already had a refresh token. `offline_access` is **not** a supported Cognito
  scope (a Terraform apply adding it was rejected with `ScopeDoesNotExistException`) and is
  not required. Refresh grants renew via a CORS `POST` to the token endpoint (no hidden
  iframe, no third-party cookies); the token endpoint returns
  `Access-Control-Allow-Origin: *`, and the Terraform provider exposes no origin field.
- **On-demand renewal**: `automaticSilentRenew` disabled; `accessToken()` and the API
  client's 401-retry are the single code path that owns token freshness (was three racing
  triggers across tabs).
- **Classify renewal failure**: a provider rejection (`ErrorResponse` with `error`, e.g.
  `invalid_grant`) clears local credentials and redirects to `/login`
  (`SessionExpiredError`); a network/timeout failure rethrows *without* clearing the
  session — transient blips no longer destroy it.
- **Boot guard re-checks expiry** after the warm-up renewal instead of mounting authed on
  a dead token, and **`/login` now surfaces redirect errors with a retry action**.

Deploy note: only the frontend changed behavior (the Cognito client keeps its existing
scopes), so the fix takes effect on the next web bundle release — no Terraform apply is
required and existing sessions are unaffected.

## Phase 6 — feed lifecycle cleanup (2026-08-29)

- Unsubscribing still deletes a user's materialized entries immediately, but now marks
  the shared feed `orphaned_at` when no subscriptions remain. Due-feed selection requires
  an active subscription, so orphaned feeds stop refreshing instead of being fetched and
  fanned out to nobody.
- Resubscribing clears `orphaned_at`, allowing a quick resubscribe to reuse shared feed
  metadata and validators.
- The orchestrator removes orphaned feed rows after a 72-hour grace period, rechecking
  for a concurrent resubscribe before deletion. This is application-enforced because
  DSQL has no foreign keys.
- Article media is not part of this migration. Its lifecycle contract is documented in
  `docs/08-article-images.md`: automatic splash associations are removed with entries,
  explicit saved images survive unsubscribe, and unreferenced binary objects are
  garbage-collected after a grace period.

## Phase 6 — article splash persistence (2026-08-29)

- The worker selects the first non-icon/avatar image candidate whose intrinsic width and
  height are both greater than 256 pixels, using bounded HTTP fetches and supported
  JPEG/PNG/WebP/GIF validation. Image failures remain best effort and do not fail feed
  ingestion.
- Accepted bytes are immutable objects in a private Terraform-managed S3 bucket,
  content-addressed by SHA-256. DSQL stores object metadata in `media_objects` and
  user-scoped entry associations in `user_media`; `/api/v1/media/:id` authorizes the
  association and redirects to a short-lived presigned S3 URL.
- User-initiated saved-image behavior and its UI remain deferred, but the `kind` field
  and media service are intentionally shaped to support it later.

## Phase 6 — article-image ingestion follow-up (2026-09-01)

- Image discovery runs against the raw feed HTML, while sanitized HTML remains the stored
  article content. This preserves lazy-loading attributes and `srcset` data without
  weakening the content-safety boundary.
- Candidate discovery accepts `img`/`source` markup, common lazy-loading attributes,
  `srcset`, image enclosures, and HTTP redirects. AVIF is accepted alongside JPEG, PNG,
  WebP, and GIF; the existing public-image, byte, dimension, timeout, and candidate-count
  limits remain in force.
- Worker logs now report whether media persistence is configured and how many image
  candidates were seen and selected. Image download or validation failures remain
  best-effort and do not fail feed ingestion.

## Phase 6 — swipe story presentation (2026-08-29)

- Added an optional full-screen story presentation selected by a device-local header
  toggle. The existing standard list remains the default and unchanged; the preference is
  not stored in account settings or encoded in routes.
- Swipe up/down and keyboard navigation move through the current stream order. `Read`
  reuses the existing route and mark-on-open behavior; merely swiping does not mark an
  entry read.
- Stories use stored article hero images when present. Without one, the view uses a theme
  background and may show the small feed favicon beside the source title; a favicon is
  never promoted to hero imagery.
- The active story position is route-backed: the first story uses the ordinary stream URL,
  later stories use `<stream>/story/<zero-based-index>`, and query view parameters remain
  in the URL. This preserves refresh and browser history position. Opening an article and
  using its back button follows the browser history stack to the story that opened it.
- The story surface uses native vertical scrolling with mandatory CSS scroll snapping and
  `IntersectionObserver` route synchronization. A custom pointer-drag or wheel handler
  was rejected because it interrupted smooth snap settling, especially for desktop mouse
  wheel input.
- Read stories remain actionable but use a gray Read button with a Lucide check icon and
  a slightly muted headline, while unread stories retain the normal emphasis.

## Phase 6 — local runtime configuration follow-up (2026-09-01)

- Stable local media settings should not be copied into the developer's `.env`; that file
  is reserved for true overrides, machine-specific values, and secrets.
- The current API and local ingest commands run as host processes, so Docker Compose
  environment variables cannot reach them. The next local-development change will move
  those runtimes into Compose (or an equivalent Compose-owned wrapper) so the Floci
  endpoint, bucket, and credentials have one local source of truth.
## 2026-09-02 — Deliver private article images through entry payloads

The web API now adds a five-minute presigned S3 URL and its absolute expiry timestamp
to each authorized `articleImage` in entry list and single-entry responses. The browser
renders that URL directly because an `<img>` request cannot carry the SPA's Cognito
`Authorization` header; the existing protected `/api/v1/media/:id` redirect remains as
a compatibility/fallback path. Entry queries garbage-collect inactive pages after four
minutes and refresh active pages 30 seconds before their earliest image URL expires.
The bucket remains private with worker write and API read IAM permissions only.

## 2026-09-15 — Read later, slice 1: storage and service

Plan and sign-off record: [10-read-later.md](10-read-later.md).

- Read later is a new `/api/v1`-only feature: a triage queue holding feed articles marked
  "read later" plus off-feed articles saved by URL. It is deliberately invisible to the
  Google Reader surface (greader has no such concept), so the compatibility contract and
  NetNewsWire behaviour are unchanged and the conformance suite remains the regression
  gate for that boundary.
- The starred stream keeps its existing "Saved" label for now. Renaming it is a separate
  workstream and is explicitly not part of this feature.
- Off-feed articles live in their own `read_later_items` table instead of being
  materialized as `user_entries`: that table is feed-shaped (NOT NULL `feed_id`, part of
  its dedupe key) and feeds "All items", unread counts, and the greader codecs, so a
  synthetic per-user feed would have leaked saved URLs into all of them.
- `entry_id` is nullable and set when an item came from a feed article. Entry content and
  read state are resolved from `user_entries` at read time rather than copied, so a
  re-published entry stays correct. `read_later_items.is_read` is authoritative only for
  URL-sourced items. Unsubscribing deletes the entry but leaves the saved item listable;
  such items report `status='error'` and are treated as read so the unread badge cannot
  stick forever.
- DSQL has no partial indexes, so idempotency reuses the `user_entries.guid_hash` trick: a
  plain unique key over `(user_id, dedupe_hash)` where the hash covers `entry:<id>` or
  `url:<normalized url>`. URL normalization lowercases the host, drops the fragment,
  strips `utm_*`/click-id params, and sorts the rest, so re-saving the same article
  updates the existing item and moves it back to the top of the queue.
- `saved_at` is written by the application at millisecond precision so the keyset cursor
  can round-trip it exactly; the DB `now()` default would carry microseconds the cursor
  cannot represent. The shared stream cursor gained a `saved` sort key, and its id field
  now accepts uuid row ids as well as decimal entry ids.
- Landing this slice: schema plus migration `0003`, the `packages/core` read-later service
  (list, save/remove entries, save URL, read state, count), cursor and normalization unit
  tests, and Docker-Postgres integration coverage including cross-user isolation. No API
  routes or UI yet — next slice is the `/api/v1` surface plus an `isReadLater` flag on
  entry payloads.

## 2026-09-15 — Read later, slices 2–5: API, queue UI, URL saving, bookmarklet

- `/api/v1` gained `GET /read-later`, `POST /read-later` (save a URL), `PATCH
  /read-later/entries` (add/remove feed entries), `PATCH /read-later/read`,
  `DELETE /read-later`, and `GET /read-later/count`. Entry and single-entry payloads now
  carry `isReadLater`, filled by the first-party API only: the flag is decorated in
  `apps/api` rather than in the shared entry service, because `/api/greader.php` shares
  that service and never reports it. The conformance suite stays green untouched, which is
  the evidence that read later did not leak into the compatibility contract.
- Read-later items are `Entry`-shaped and paged with the same cursor, so `EntryList`,
  `StreamInner`, and the reading pane render the queue without a second list
  implementation; the API client routes the `readLater` descriptor to `/api/v1/read-later`
  instead of the entry stream endpoint. Their ids are uuids, so `mark read` and `remove`
  address them directly while `star` and entry read-state still target the numeric entry id.
- URL saving runs inline in the request, as agreed: `POST /read-later` fetches the page,
  extracts a readable copy with `@mozilla/readability` on a `linkedom` DOM, and runs the
  result through the same `sanitizeEntryHtml` allowlist as ingested feed content.
  `linkedom` over `jsdom` for its lack of native dependencies. A body with less than ~250
  characters of prose is rejected so a nav bar or cookie notice cannot masquerade as an
  article; the item then degrades to title-plus-link (`status='ready'`, no body) rather than
  pretending to have content.
- The new outbound fetch is the only genuinely new attack surface, so it is guarded:
  http(s) only, hostname resolution checked against loopback, private, link-local, CGNAT,
  multicast, and cloud-metadata ranges, re-validated on **every** redirect hop, bounded at
  2 MB read and a 10 s timeout, and never forwarding credentials. A blocked or malformed
  address fails with 400 (the user's mistake); any other fetch failure still saves the link
  with `status='error'` so an article is never silently lost. `feed/fetch-feed.ts` and
  `feed/discover.ts` still lack these protections — adopting the shared guard is a roadmap
  item, not a silent omission.
- The bookmarklet is shipped as a Settings card (`lib/bookmarklet.ts`), not a server
  feature: it gathers the page URL, title, and selected text, then opens
  `/read-later/new?url=&title=&excerpt=&auto=1` in a small window. A bookmarklet runs in the
  article's origin and cannot read our session, so the app must own the request.
- UI decisions: the read-later stream is excluded from the unread filter and
  mark-all-read controls (it is a queue, not a subscription stream); `l` toggles the queue
  and removes the item when the pane was opened from it; saved URLs hide the star action;
  the saved item's date falls back to `saved_at` when the source page has no publish time.

## 2026-09-15 — Two pre-existing defects found while building read later

Both were found by, and are now covered by, tests written for read later.

- **Cross-user leak in keyset pagination (fixed).** The cursor tie-break branch is raw SQL,
  and drizzle does not parenthesize raw SQL chunks inside `and(...)`. Both `entries.list`
  and `read-later.list` were assembling `user_id = $1 and a < x or (a = x and id < y)`,
  which SQL parses as `(user_id AND a < x) OR (a = x AND id < y)` — so a page could include
  another user's row whenever its sort timestamp equalled the cursor's. The branch is now
  explicitly parenthesized in both services, with regression tests that page with a cursor
  aimed at a foreign row.
- **The API test suites were not running (fixed).** `vitest.config.ts` included
  `apps/*/test/**/*.test.tsx` but not `*.test.ts`, so `apps/api/test/api.int.test.ts` and
  `apps/api/test/greader.conformance.test.ts` — the HTTP contract and the greader
  conformance suite — were silently skipped by `pnpm test` in CI. The include now matches
  both extensions, and the API suites' pre-test `DROP TABLE` lists were completed (media and
  read-later tables were missing) so they pass regardless of which suite ran first. The
  conformance suite is now genuinely part of CI.

## 2026-09-15 — Read later UI pass: sidebar sections and the bookmarklet

- The sidebar grew a third section. **Streams**, **Folders**, and **Feeds** each get an
  uppercase heading, and there is exactly one divider per section boundary: one closing
  Streams, and one closing Folders. The Folders section (heading, rows, and its divider) is
  omitted entirely when the user has no folders, which is what previously produced two
  rules back to back. Feeds carries no trailing divider because it already ends the list.
- The `+ add` menu moved from the **Feeds** heading to the **Streams** heading, since
  adding is a global action rather than a feeds property, and gained an "add article…"
  entry. The `+ add article` button that briefly lived in the top bar was removed with it.
  The feed-list options menu (the "unread only" toggle) stayed on the **Feeds** heading,
  where it belongs.
- A collapsed section under the add-article form offers the bookmarklet, using a shared
  `BookmarkletLink` component so the settings card and the form cannot drift apart.
- **React 19 blocks `javascript:` hrefs.** It replaces the attribute with a throw-stub, so
  a bookmarklet rendered as a normal `href` prop is a dead drag target (the copy-code
  button still worked, which is how this could have shipped unnoticed). The URL is now
  written onto the anchor node in an effect; dragging reads the DOM attribute, so the drag
  affordance survives. There is a test asserting the rendered href, because the failure is
  invisible in the component source.

## 2026-09-23 — Future-dated feed entries are clamped at parse time

- A feed entry whose `<updated>`/`pubDate` is in the future was stored verbatim, so it sorted
  to the top of every date-ordered stream and, because the web UI buckets anything at or
  after local midnight as "today" (`apps/web/src/lib/date-grouping.ts`), it appeared pinned
  under **Today** while showing its own future date. This was observed live: the Allen Pike
  feed declared `2026-09-30`, a week ahead of the crawl.
- Decision: a future publish time is almost always a source bug, and our ingest runs on a
  short cadence, so `parseFeed` now clamps any future `publishedAt` to the parse time
  (`packages/core/src/feed/parse.ts`). The missing-date and unparseable-date fallbacks already
  used "now", so this is the same fallback applied to a third case. No UI change is needed
  once the data is clean.
- Note: entries are insert-only (`onConflictDoNothing`), so this does **not** repair rows
  already stored with a future date, and a later correction in the source feed will not
  propagate either. Existing bad rows need a one-off data fix; a self-healing upsert remains
  an open option if source corrections turn out to be common.

## 2026-09-23 — The bookmarklet shows the form and confirms in place

- The bookmarklet opened `/read-later/new?…&auto=1`, which submitted the prefilled form
  immediately and then navigated the popup to the saved item. That read as "it saved and
  threw me at the article": the user never got to review or edit the prefill, and the popup
  ended up showing the reading pane instead of a result.
- Decision: the bookmarklet no longer auto-submits. It passes `popup=1`, and the form waits
  for an explicit save. In that popup variant, a successful save replaces the form in place
  with a short "saved" confirmation and a close button, rather than navigating; saving from
  inside the app still opens the saved item as before. Popup detection also falls back to
  `window.opener` so windows opened before this change still confirm in place.
- The `auto` parameter is gone, so a stale bookmarklet from an earlier copy still prefills
  correctly and simply waits for the user instead of failing.
- Follow-up tweaks the same day: the bookmarklet popup settles at 530x460 (it was briefly
  widened to 650x530, but the form fits better when it stays narrow), and the collapsed
  "save articles with one click" section was removed from the save-article form. Bookmarklet
  setup now lives only in the settings card, so the form is only ever the form;
  `BookmarkletLink`'s rendered `javascript:` href — the React 19 workaround that previously
  had no test of its own — gained one in `apps/web/test/bookmarklet-link.test.tsx`.

## 2026-09-23 — One save form, two variants

- The form was split from `SaveArticlePage` into `components/SaveArticleForm.tsx` with a
  `variant` prop, because the bookmarklet's window and the in-app page need the same fields
  and the same save call but different dressing.
- `variant="page"` is the in-app form (explanatory copy, field hints, and it opens the saved
  item after saving). `variant="popup"` drops the intro paragraph and the `optional; …`
  descriptions, and confirms in place with a close button.
- The variant is chosen in `Shell` from `?popup=1` / `window.opener`, not by the form, and
  the popup branch returns before the `AppShell` wrapper — that is what removes the topbar
  and sidebar. We kept one route (`/read-later/new`) rather than adding
  `/read-later/bookmarklet`: the popup is the same operation with different chrome, and an
  existing bookmarklet keeps working unchanged. If the two ever need genuinely different
  routes (e.g. the popup grows its own data loading), a dedicated path is the next step.
- `SaveArticlePage.tsx` is gone; `Shell` lazy-imports the form component for both variants,
  so the code-splitting intent (keep the form off first paint) is preserved.
