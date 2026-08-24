# 01 — System Architecture

## High-level diagram

```
                        ┌──────────────────────────── AWS ────────────────────────────┐
 Browser ── HTTPS ──▶   │ CloudFront                                                  │
 NetNewsWire ── HTTPS ─▶│  ├─ /api/*        ──▶ API Gateway (HTTP API v2)             │
                        │  │                     ├─ /api/greader.php/{proxy+} ─┐        │
                        │  │                     │      (no authorizer — token │        │
                        │  │                     │       auth inside Lambda)   │        │
                        │  │                     └─ /api/v1/{proxy+} ──────────┤        │
                        │  │                            (Cognito JWT authorizer)│       │
                        │  │                                    ▼                ▼       │
                        │  │                             ┌──────────────────────────┐    │
                        │  └─ /* (SPA)  ──▶ S3 (OAC)    │  api Lambda (Hono, arm64)│    │
                        │                               └──────────┬───────────────┘    │
                        │                                          │ IAM               │
                        │                                          ▼                   │
                        │                              ┌────────────────────┐          │
                        │   EventBridge Scheduler      │  Aurora DSQL       │          │
                        │     rate(5 min) ──▶ orchestrator Lambda ──▶ cluster         │
                        │                          │      └────────────────────┘     │
                        │                          ▼                                 │
                        │                    SQS feed-refresh queue                  │
                        │                       │            ──▶ DLQ                 │
                        │                       ▼                                    │
                        │                 worker Lambda (fetch, parse, upsert)       │
                        │                       │  outbound HTTPS to feeds           │
                        └───────────────────────────────────────────────────────────┘
```

**No VPC anywhere.** Lambdas run in the public runtime and reach the internet natively;
Aurora DSQL is reached over its public endpoint with IAM auth. This is the single biggest
simplification vs. a classic RDS design (no NAT gateway, no subnets, no security groups).

## Components

### Edge & web

| Component | Notes |
| --- | --- |
| Route53 | Public hosted zone; A-alias records → CloudFront. |
| ACM certificate | Must live in **us-east-1** for CloudFront (+ Cognito custom domain if added later). |
| CloudFront | Two origins: S3 (static SPA via OAC) and API Gateway regional domain (`/api/*` behavior, caching disabled, viewer + origin request policies for query strings/headers passthrough). Response headers policy adds CSP/HSTS/security headers. |
| CloudFront Function | Rewrites SPA routes (`/all`, `/feed/3`, …) to `/index.html`; never rewrites `/api/*`. |
| S3 bucket | Private; CloudFront OAC is the only reader. Versioned off (cost), public access blocked. |

### Auth

| Component | Notes |
| --- | --- |
| Cognito User Pool | Sign-up **disabled** (invite-only: `aws cognito-idp admin-create-user`). Password policy enforced; MFA optional later. Hosted UI on the default `*.auth.<region>.amazoncognito.com` domain initially (custom domain possible later, cert in us-east-1). |
| App client | Public client (no secret), PKCE + authorization-code flow for the SPA. Access token JWTs carry `sub` = our `users.cognito_sub`. |
| API Gateway JWT authorizer | Bound only to `/api/v1/*` routes. Validates issuer + audience. The greader routes deliberately have **no** authorizer (see auth model below). |

The SPA uses `oidc-client-ts` against the hosted UI. Tokens live in memory +
`sessionStorage`; silent renew via refresh token.

### Service layer

One codebase (`apps/api`, Hono) packaged into **three Lambda functions**, all Node 22 arm64:

| Function | Trigger | Purpose |
| --- | --- | --- |
| `api` | API Gateway `/api/{proxy+}` | Mounts two Hono apps: `greaderApp` (Google Reader compat, self-authenticating) and `webApiApp` (Cognito JWT, `/api/v1`). Also serves OPML import/export under `/api/v1`. |
| `ingest-orchestrator` | EventBridge Scheduler `rate(5 minutes)` | Queries DSQL for feeds where `next_fetch_after <= now()`, applies max-batch cap, enqueues one SQS message per due feed. Idempotent by construction (re-running just re-enqueues; workers dedupe writes). |
| `ingest-worker` | SQS event source mapping (batch ~5, reserved concurrency ~10) | Fetches one feed per message with conditional GET (`ETag`/`If-Modified-Since`), parses RSS/Atom/JSON Feed (`rss-parser`), sanitizes HTML (`sanitize-html`), upserts entries per subscriber, updates feed sync metadata and backoff state. Failures retry per SQS redrive policy → DLQ. |

Shared domain logic lives in `packages/core` (feed discovery, parsing pipeline, entry
upsert, greader codec/mappers); `packages/db` owns schema, migrations, and the connection
factory.

**DSQL connections:** every new PG client needs a fresh IAM auth token
(`@aws-sdk/dsql-signer`, TTL 15 min). The pool factory generates tokens on client creation
and caps client lifetime below that TTL. No secrets in Secrets Manager for the database —
IAM *is* the secret. The only stored secret is the HMAC signing key used for greader auth
derivation (Secrets Manager, read at cold start).

### Data layer

Amazon Aurora DSQL cluster (single region), Postgres wire-compatible, accessed with
`pg`/Drizzle over TLS. Schema and access patterns: [03-data-model.md](03-data-model.md).

### Observability

- Structured JSON logs (console JSON, one log group per function).
- Alarms: DLQ depth > 0, worker/orchestrator error rate, API 5xx rate, API GW throttles.
- AWS Billing budget alert (~$20/mo threshold) as the cost tripwire — planned (Phase 6),
  not yet in Terraform.
- X-Ray deferred; add if latency debugging demands it.

## Request flows

### 1. Web app reading path

```
Browser ──OIDC PKCE──▶ Cognito hosted UI ──code+tokens──▶ SPA
SPA ──GET /api/v1/entries?stream=all&unread=true&cursor=…──▶ JWT authorizer ──▶ api Lambda
api Lambda ──keyset SELECT──▶ DSQL ──▶ JSON page {items, nextCursor}
SPA renders list; mark-read/star are PATCH mutations with optimistic UI
```

### 2. NetNewsWire sync path (compatibility-critical)

```
NNW ──POST /api/greader.php/accounts/ClientLogin (Email + API token)──▶ api Lambda
       ◀── SID=…\nAuth=<user>/<hmac>\nLSID=null\n
NNW ──Authorization: GoogleLogin auth=<user>/<hmac>──▶ stream/items/ids?xt=read&ot=lastSync
     ──▶ stream/items/contents (batched i= ids)
     ──▶ unread-count, tag/list, subscription/list
Mutations: edit-tag (read/starred), subscription/edit (sub/unsub/rename/move),
mark-all-as-read — each requires the write token from GET /reader/api/0/token
```

Full endpoint contract: [02-greader-api.md](02-greader-api.md).

### 3. Feed refresh path

```
Scheduler ─rate(5m)─▶ orchestrator Lambda
  orchestrator: UPDATE-due-feeds SELECT → SendMessage ×N → done (sub-second, cheap)
SQS ─batch≤5─▶ worker Lambda ×(concurrency ≤10)
  worker: conditional GET → parse → sanitize → INSERT … ON CONFLICT DO NOTHING (dedupe)
          → UPDATE feeds SET etag,last_fetched,next_fetch_after,error_count…
poison messages ─maxReceive→ DLQ (alarm fires)
```

Immediate first fetch: subscribing to a new feed (web UI, OPML import, or GReader
client) makes the api Lambda enqueue the same `{ feedId }` message on the refresh queue
(`QUEUE_URL` env, `sqs:SendMessage`). Best-effort — an enqueue failure never fails the
subscribe; the 5-minute scheduler picks the feed up regardless. Local dev (no SQS) runs
the fetch in-process.

Backoff policy: success → `next_fetch_after = now() + ttl_minutes`; fetch error → double
the delay up to 24 h and record `last_error`; HTTP 301/308 → persist permanent redirect.

## Security model

| Concern | Control |
| --- | --- |
| Human auth | Cognito (invite-only pool, PKCE SPA client, JWT authorizer on `/api/v1/*`) |
| Client (NetNewsWire) auth | Per-user random API token (32 bytes, base64url). Stored **SHA-256 hashed**. `ClientLogin` verifies token, returns stateless HMAC credential derived from `(server HMAC key, user id, token hash)` so request validation is one DB read (or cacheable). Revocation = delete token row. |
| Write-token replay | Google Reader's `T` token is implemented as a deterministic per-user value (FreshRSS parity) — it exists because clients require fetching one; it is not a CSRF defense in our threat model. Mutations still require the valid `GoogleLogin auth` header. |
| DB auth | DSQL IAM tokens, auto-rotated per connection. Zero stored DB credentials. |
| Least privilege | One execution role per function. `api` role: DSQL connect + read/write + its secret + SQS send on the refresh queue (immediate first fetch). Worker roles: DSQL connect + write only. Orchestrator: DSQL read + SQS send. |
| Transport/content | TLS everywhere (ACM), CSP + HSTS + frame-deny at CloudFront response policy, sanitized HTML stored server-side (script-free allowlist), `<img>` hotlinking allowed (RSS norm). |
| Abuse surface | API Gateway throttling (steady/burst tuned low), per-route quotas later; WAF deferred until public exposure matters. |
| Data at rest | All services encrypt by default (S3-SSE, EBS-backed Lambda /tmp ephemeral, DSQL encrypted). |

## Scaling posture

Everything scales horizontally out of the box. Practical ceilings at personal scale:
DSQL request throughput (irrelevant here), SQS-driven worker concurrency (capped ~10 to be
polite to feed hosts), and API Gateway account throttles. The design comfortably covers
tens of users × hundreds of feeds.
