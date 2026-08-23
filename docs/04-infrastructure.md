# 04 — Infrastructure (Terraform) & Delivery

## Terraform layout

```
tf/
├─ modules/
│  ├─ dns/          # Route53 zone lookup/records, ACM cert (us-east-1 for edge)
│  ├─ web/          # S3 bucket + OAC, CloudFront distribution,
│  │                # CloudFront Function (SPA fallback), response-headers policy
│  ├─ auth/         # Cognito user pool, app client, hosted-UI domain, groups
│  ├─ api/          # HTTP API v2 (routes, JWT authorizer), Lambda(s),
│  │                # execution roles, log groups, alarms
│  ├─ ingest/       # EventBridge Scheduler, SQS queue + DLQ + redrive,
│  │                # orchestrator & worker Lambdas, roles
│  └─ db/           # Aurora DSQL cluster + IAM policy wiring
└─ envs/
   └─ prod/
      ├─ main.tf        # module composition, providers, shared tags
      ├─ backend.tf     # S3 remote state + native locking (TF >= 1.10)
      └─ terraform.tfvars   # domain name, alert emails, sizing knobs
```

Conventions:

- **State**: single state per environment in S3 (`sparkle-rss-tfstate-<acct>` bucket,
  `use_lockfile = true` — no DynamoDB lock table). One environment (`prod`) to start;
  adding `staging` is a new directory under `envs/`, not a fork of modules.
- **Provider pinning**: `aws ~> 6.x`, pinned per-module via `.terraform.lock.hcl`.
- **Region**: app region configurable (default `us-east-1` to keep edge certs simple).
- **Lambda packaging**: CI runs `pnpm build:lambdas` (esbuild →
  `dist/api.zip`, `dist/orchestrator.zip`, `dist/worker.zip`, arm64, Node 22 runtime);
  Terraform references the zips with `source_code_hash` for change detection. No
  `archive_file` magic — explicit artifacts.
- **Secrets**: one Secrets Manager secret (`sparkle/prod/hmac-key`) read only by the
  `api` function. DSQL needs none (IAM auth).

## Resource inventory

| Module | Resources |
| --- | --- |
| dns | Route53 zone (or data-source an existing one), A/AAAA alias → CloudFront, ACM cert + DNS validation (certs in us-east-1) |
| web | S3 bucket (private, OAC-only), CloudFront distribution (S3 + API GW origins, `/api/*` no-cache behavior, SPA rewrite function, security headers policy, compression) |
| auth | Cognito user pool (sign-up disabled), user pool client (PKCE, no secret, callback = site URL), hosted UI domain prefix, admin-created users are ops, not IaC |
| api | HTTP API `{proxy+}` routes: `/api/greader.php/*` (no authorizer), `/api/v1/*` (Cognito JWT authorizer scoped by audience); `api` Lambda arm64 Node 22 (512 MB / 10 s); structured access logs; 5xx/throttle alarms |
| ingest | EventBridge Scheduler `rate(5 minutes)` → orchestrator Lambda (256 MB / 60 s); SQS standard queue (visibility 120 s, redrive maxReceiveCount 5) → worker Lambda (512 MB / 60 s, reserved concurrency 10); DLQ depth alarm; DLQ redrive console for ops |
| db | Aurora DSQL cluster; IAM policy granting `dsql:DbConnect` to each Lambda role |

## CI/CD (GitHub Actions)

OIDC role per repo (`gh-oidc/sparkle-rss-deploy`) with permissions limited to the
resources Terraform manages; no static AWS keys anywhere.

```
ci.yaml (PRs)
  pnpm install --frozen-lockfile
  biome check .            # lint + format
  pnpm typecheck           # tsc -b across workspace
  pnpm test                # vitest units + integration (docker Postgres)
  pnpm build               # web + lambda bundles
  tf: terraform fmt -check && terraform init && terraform validate && terraform plan
  → plan output posted to PR

deploy.yaml (push to main, environment: prod, requires OIDC role)
  same build steps
  pnpm build:lambdas && pnpm build:web
  terraform apply -auto-approve=false (manual review via GH environments if desired)
  aws s3 sync apps/web/dist s3://$WEB_BUCKET --delete (+ CloudFront invalidation)
  db migrations step: run drizzle-kit migrate from a short-lived job w/ IAM token
```

Deploy order matters: DB migration → Lambda update → web assets. The pipeline encodes it.

## Operational runbook essentials

| Task | How |
| --- | --- |
| Create a user | `aws cognito-idp admin-create-user --user-pool-id … --username <email>` then share temp password; user sets API token in settings UI |
| Revoke a NetNewsWire device | Settings UI → delete token row |
| Inspect failed feed refreshes | `feeds.last_error`, DLQ + alarm; replay via SQS console redrive |
| Rotate HMAC key | Rotate secret value; forces all clients through ClientLogin again (tokens derive from token hashes, so API tokens stay valid — document exact semantics at implementation time) |
| Destroy everything | `terraform destroy` (DSQL cluster deletion protection off first) — full teardown possible since no VPC residue |

## Cost model (personal scale, monthly)

Assumptions: 1–3 users, ~100 feeds refreshed hourly-ish, ~50k API requests/mo, ~2 GB data.

| Service | Est. cost |
| --- | --- |
| Route53 zone + queries | ~$0.90 |
| ACM | $0 |
| CloudFront (~20 GB egress) | ~$2 |
| S3 (static assets) | <$0.50 |
| Cognito (Lite tier ≤10k MAU) | $0 |
| API Gateway HTTP API | ~$0.05 |
| Lambda (arm64, free tier mostly covers) | ~$0–1 |
| EventBridge Scheduler | $0 (free tier) |
| SQS | <$0.01 |
| **Aurora DSQL** (storage + requests, zero idle compute) | ~$1–5 |
| CloudWatch logs + alarms | ~$1–3 |
| **Total** | **≈ $5–12/mo**, near-$0 when idle |

Compare: cheapest FreshRSS-capable VPS ≈ $4–7/mo but requires server upkeep. The premium
here buys zero maintenance, not scale.
