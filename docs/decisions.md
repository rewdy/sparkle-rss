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
