# Sparkle RSS — Project Overview

Sparkle RSS is a self-hostable RSS/Atom reader in the spirit of [FreshRSS](https://freshrss.org),
rebuilt from scratch as a fully serverless AWS application. The defining constraint: **full
wire compatibility with the FreshRSS implementation of the Google Reader API**, so existing
native clients — primarily [NetNewsWire](https://ranchero.com/netnewswire/) on iOS/macOS —
sync against it unmodified.

## Goals

1. **Serverless-only AWS architecture.** No servers to patch. Idle cost near zero.
2. **Drop-in sync target for NetNewsWire** (and any Google Reader-compatible client:
   Reeder Classic, Capy Reader, Vienna, Newsboat, …).
3. **A modern, fast web UI** — a calm, typography-first reading experience that FreshRSS
   lacks.
4. **Single language.** TypeScript everywhere: frontend, service layer, tooling.
5. **Infrastructure as code.** Everything reproducible via Terraform; deployed via GitHub
   Actions with OIDC (no long-lived AWS keys).

## Non-goals (v1)

Explicitly out of scope for launch. Recorded so they are *deferred*, not forgotten:

| Feature | Why deferred |
| --- | --- |
| Public multi-tenant signup | Personal/family deployment; Cognito invites only |
| Full-text article search | No strong day-to-day need yet; revisit if added |
| Article-level labels (tags beyond starred) | NetNewsWire doesn't sync them; UI value unclear |
| XPath/web-scraping feed synthesis | Large parser surface, niche need |
| WebSub (push) real-time updates | Polling scheduler is sufficient at this scale |
| Fever API | Legacy; Google Reader API is the strategic surface |
| Sharing services, saved user queries, themes/extensions engine | FreshRSS power-user features |
| Multi-region / HA posturing | Single-region, single-AZ-equivalent serverless is already resilient |

## Product shape

- **Web app** (`apps/web`): React SPA served from CloudFront/S3. Login via Cognito.
- **Sync API** (`/api/greader.php/*`): Google Reader-compatible surface for native clients.
  Authenticates with a per-user **API token** generated in the web UI (same model as
  FreshRSS — the web login and the client-API credential are separate secrets).
- **Service API** (`/api/v1/*`): first-party JSON API consumed by the web app. Authenticates
  with Cognito JWTs.
- **Ingestion pipeline**: scheduled feed refresh (EventBridge Scheduler → SQS → Lambda
  workers) with conditional GETs, HTML sanitization, and per-feed error backoff.
- **Database**: Amazon Aurora DSQL (serverless Postgres). No VPC, no passwords — IAM auth.

## Key decisions log

Decisions are dated and reversible; changing one means updating the linked doc.

| # | Decision | Choice | Rationale | Doc |
| --- | --- | --- | --- | --- |
| D1 | Database | **Aurora DSQL** | True serverless Postgres: relational queries map 1:1 onto Google Reader API access patterns (keyset pagination, `UPDATE`-based mark-all-as-read, per-feed counts), zero idle cost, **no VPC/NAT gateway** (Lambdas stay public, feed fetching needs internet anyway). Trade-offs accepted (spike-verified, see decisions.md): no extensions, no FKs (integrity in app layer), no partial/DESC indexes, explicit identity CACHE, 15-minute IAM auth tokens with pool recycling, no local emulator (dev runs plain Postgres in Docker). | [03-data-model](03-data-model.md), [04-infrastructure](04-infrastructure.md) |
| D2 | Tenancy | Invite-only, few users | Cognito sign-up disabled; users created via console/CLI. Data model still multi-user from day one (every row carries `user_id`). | [03-data-model](03-data-model.md) |
| D3 | Service framework | **Hono** on Lambda | First-class Lambda adapter, tiny, TypeScript-native, familiar middleware model. One deployed Lambda exposes three logical apps (web API, greader API, ingestion worker entry points). | [01-architecture](01-architecture.md) |
| D4 | Frontend stack | React + TypeScript + **wouter** + TanStack Query + jotai + **Mantine** | User-mandated libraries. Mantine chosen over Chakra for richer out-of-box components and dark-mode story. | [05-frontend](05-frontend.md) |
| D5 | Reading layout | Minimal reader (not 3-pane) | Collapsible sidebar + focused single-column reading. Keyboard-first. | [05-frontend](05-frontend.md) |
| D6 | Auth | Cognito (humans) + per-user API tokens (clients) | Google Reader `ClientLogin` predates OAuth; native clients send username + password. We mint long-lived random API tokens (stored hashed) issued from the settings UI under a Cognito session. Mirrors FreshRSS "API password". | [01-architecture](01-architecture.md), [02-greader-api](02-greader-api.md) |
| D7 | IaC & delivery | Terraform ≥1.10, S3 remote state w/ native locking, GitHub Actions + OIDC | User mandate. No TF Cloud dependency. | [04-infrastructure](04-infrastructure.md) |
| D8 | Language/tooling | Node 22 (LTS), pnpm workspaces, TypeScript strict, Biome (lint+format), Vitest | One language across the stack; Biome for a single fast toolchain. | AGENTS.md |

## Repository layout

```
sparkle-rss/
├─ AGENTS.md              # operational guide for humans + agents
├─ docs/                  # this documentation set (source of truth)
├─ apps/
│  ├─ api/                # Hono apps + Lambda entry points (api, ingest orchestrator, worker)
│  ├─ web/                # Vite + React SPA (the reader)
│  └─ site/               # Astro static marketing site + setup guide (served at the apex)
├─ packages/
│  ├─ core/               # domain services shared by all entry points (feed parsing, greader codecs)
│  ├─ db/                 # Drizzle schema, migrations, DSQL/local client factories
│  └─ tooling/            # shared tsconfig / biome presets
├─ tf/
│  ├─ modules/            # web, api, ingest, db, auth, dns terraform modules
│  └─ envs/prod/          # environment compositions
└─ .github/workflows/     # ci.yaml, deploy.yaml
```

## Documentation map

| Doc | Contents |
| --- | --- |
| [01-architecture.md](01-architecture.md) | AWS system design, component inventory, request flows, security model |
| [02-greader-api.md](02-greader-api.md) | **Google Reader compatibility spec** — the contract with NetNewsWire |
| [03-data-model.md](03-data-model.md) | Aurora DSQL schema, access patterns, pagination/dedupe rules |
| [04-infrastructure.md](04-infrastructure.md) | Terraform structure, CI/CD, environments, cost model |
| [05-frontend.md](05-frontend.md) | Web app architecture, state management, UX specification |
| [06-roadmap.md](06-roadmap.md) | Build phases with exit criteria |
