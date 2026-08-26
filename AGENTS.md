# AGENTS.md

Guidance for AI agents (and humans) working in this repository. Read this before making
changes; keep it current.

## What this is

Sparkle RSS — a serverless FreshRSS-compatible RSS reader on AWS. TypeScript everywhere.
The hard external contract is the **Google Reader compatible API** consumed by NetNewsWire;
breaking it silently is the worst class of bug in this repo.

## Read order

1. `docs/00-overview.md` — goals, non-goals, decision log
2. `docs/01-architecture.md` — AWS system design & security model
3. `docs/02-greader-api.md` — **the compatibility contract**
4. `docs/03-data-model.md` — schema & access patterns
5. `docs/04-infrastructure.md` — Terraform & CI/CD
6. `docs/05-frontend.md` — web app architecture
7. `docs/06-roadmap.md` — phases & exit criteria
8. `docs/07-local-development.md` — local dev workflow (Docker Postgres, dev auth, ingest)

## Repo layout

```
apps/api/        Hono apps + Lambda entry points (api, ingest-orchestrator, ingest-worker)
apps/web/        Vite React SPA (Mantine, wouter, react-query, jotai)
packages/core/   Domain services shared by all entry points; greader codecs; time utils
packages/db/     Drizzle schema, migrations, DSQL/local client factory
packages/tooling/ Shared tsconfig / biome presets
tf/              Terraform root (tf/variables.tf = THE infra config, tf/main.tf) + modules/*
docs/            Source of truth for design
```

## Toolchain

- Node 22, pnpm 10 (`corepack enable`), Terraform >= 1.10, AWS CLI v2, Docker (for local
  Postgres).
- Biome for lint+format (`pnpm lint` / `pnpm lint:fix`), Vitest for tests
  (`pnpm test`, `pnpm test:watch`), `pnpm typecheck` runs `tsc -b` across the workspace.
- Build: `pnpm build:web` → static bundle; `pnpm build:lambdas` → esbuild zips in `dist/`.
- Local dev: `pnpm dev` runs web + API via node adapters against Dockerized Postgres
  (`docker compose up -d db`, then `pnpm db:migrate:local`); full workflow in
  `docs/07-local-development.md`. DSQL has no emulator — production parity comes from
  keeping all SQL extension-free.
- Terraform root is `tf/`; `tf/variables.tf` is the single fork-facing config
  (app_domain, deploy_site, site_domain, allow_signups, prefixes/repo). The S3 state
  backend is configured inline in `tf/main.tf` (no flags/env vars), so a local
  `terraform -chdir=tf plan` just works. Deploys happen by pushing to main;
  hand-applies are for breakage only.

## Architecture invariants (do not break without a decision-log entry)

1. **GReader compatibility**: anything under `/api/greader.php` must match
   `docs/02-greader-api.md`. Changes require updating that doc AND the conformance suite
   in the same PR.
2. **Terraform owns everything that persists.** `tf apply` creates everything the app
   needs; `tf destroy` leaves no trace. Manual AWS resources are allowed only for short-
   lived spikes, must be tagged `sparkle=spike`, and MUST be deleted immediately after —
   log created/destroyed in `docs/decisions.md`. Anything that survives a spike goes into
   Terraform before it's used by real code.
3. **No VPC resources** unless a documented decision says otherwise. Lambdas stay public;
   DSQL is IAM-authenticated over its public endpoint.
4. **No database extensions** — DSQL lacks them; vanilla Postgres locally must behave
   identically.
5. **Single language**: TypeScript only across apps/packages/infra tooling scripts.
6. **Server state lives in react-query; ephemeral UI state in jotai** (see doc 05). No
   exceptions without updating doc 05.
7. **Every row is user-scoped from day one** even though deployment is invite-only.
8. Timestamps are stored UTC `timestamptz`; unit conversions (sec/msec/usec/nsec) happen
   only in `packages/core/greader/time.ts` and are unit-tested there.

## Testing expectations

- Unit tests for codecs/time/parsers (pure functions) — fast, no I/O.
- Integration tests run against Dockerized Postgres with real migrations.
- The greader conformance suite is part of CI; golden fixtures updated only alongside doc 02.
- NetNewsWire E2E (doc 02 checklist) is manual and required before any release that touches
  the greader surface.

## Infra workflow

- Never `terraform apply` by hand against prod unless CI is broken; prefer the pipeline.
- Plan output appears on PRs; review it like code.
- Forks edit `tf/terraform.tfvars`; don't fork-paste modules or env dirs — one root
  (`tf/`) composes the shared `tf/modules/*`. Edge certs (CloudFront/Cognito custom domains) must be in us-east-1 regardless of app region.

## Gotchas learned so far

- DSQL IAM tokens expire in 15 minutes — connection pool must regenerate per client and cap
  client lifetime (see `packages/db` factory once implemented).
- GReader timestamp units differ per field (`ts` param = ns, `timestampUsec` = usec string,
  `crawlTimeMsec` = msec string, `published` = sec int). One bug here desyncs every client.
- Item IDs have two forms (short decimal / long `tag:google.com,…` hex); accept both
  everywhere IDs enter the API.
- FreshRSS tolerates empty/`x` write-tokens (client quirks) — we replicate tolerance.
- Cognito hosted UI default domain needs no cert; custom domains do (us-east-1).

### Aurora DSQL engine quirks (full list in docs/decisions.md)

- No FOREIGN KEY constraints, no partial indexes, no DESC index keys, no `serial`,
  identity needs `CACHE 1`, indexes need `CREATE INDEX ASYNC`, no multi-DDL transactions,
  multi-target DROP unreliable, dropped names stay blocked for the cluster's lifetime.
- Consequence: migrations are forward-only via the custom runner in
  `packages/db/src/dsql-migrator.ts`; dev cycle = fresh TF cluster, never drop/recreate.
- Schema stays valid on both engines; only index syntax is rewritten at runtime for DSQL.
- `admin` DB user requires `getDbConnectAdminAuthToken()` + `dsql:DbConnectAdmin`.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore(infra):`, …).
- Strict TypeScript, no `any` leaks past package boundaries; ESM everywhere.
- Docs live in `docs/` and are updated in the same PR as the change they describe.
  If you change architecture, data model, or any API surface, the matching doc edit is part
  of "done".
- Work happens in session-sized chunks: `docs/06-roadmap.md` ("Current state" + the
  Phase-6 backlog) is the handoff — start every session there. When a chunk lands, check
  off the roadmap item, append decisions to `docs/decisions.md`, and refresh the
  Current-state date **in the same commit as the code**, so a failed session never loses
  meaningful context.
