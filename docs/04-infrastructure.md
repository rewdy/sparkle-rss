# 04 — Infrastructure (Terraform) & Delivery

## Terraform layout

```
tf/
├─ modules/
│  ├─ dns/          # Route53 zone lookup, ACM certs (us-east-1 for edge): app hostname
│  │                # AND apex+www for the marketing site, DNS validation
│  ├─ web/          # S3 bucket + OAC, CloudFront distribution,
│  │                # CloudFront Function (SPA fallback), response-headers policy
│  ├─ site/         # Static S3 + CloudFront for apps/site at the apex (www redirect)
│  ├─ auth/         # Cognito user pool, app client, hosted-UI domain, groups
│  ├─ api/          # HTTP API v2 (routes, JWT authorizer), Lambda(s),
│  │                # execution roles, log groups, alarms
│  ├─ ingest/       # EventBridge Scheduler, SQS queue + DLQ + redrive,
│  │                # orchestrator & worker Lambdas, roles
│  ├─ db/           # Aurora DSQL cluster + IAM policy wiring
│  └─ github-oidc/  # OIDC provider lookup/creation + deploy role for CI
├─ variables.tf        # THE single fork config: app_domain, deploy_site,
│                      # site_domain, allow_signups, prefixes, repo
├─ main.tf             # module composition + inline S3 backend block
├─ terraform.tfvars    # committed defaults (no secrets)
```

Conventions:

- **State**: single state at the `sparkle-rss/prod/terraform.tfstate` key in the
  `drewmey--devops-tf-state` bucket, `use_lockfile = true` — no DynamoDB lock table.
  The S3 backend is configured inline in `tf/main.tf`, so `terraform plan`/`apply` just
  work with no flags, env vars, or backend files. Forks edit those backend fields to use
  their own bucket.
  One root module (`tf/`) is live; there is no separate dev environment — the ephemeral
  `tf/envs/dev` spike env from bring-up has been removed (its resources were destroyed).
  Gotcha from
  bring-up: keep the `terraform { backend "s3" {} }` block intact — losing it silently
  pins runs to local state (see decisions.md).
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
| dns | Route53 zone (or data-source an existing one), ACM certs + DNS validation for the app hostname, apex+www, and `auth.<root>` (all certs in us-east-1) |
| web | S3 bucket (private, OAC-only), CloudFront distribution (S3 + API GW origins, `/api/*` no-cache behavior, SPA rewrite function, security headers policy — CSP, HSTS 1y + includeSubDomains, X-Frame-Options DENY, nosniff, referrer-policy; verified live 2026-08-24, compression) |
| site | S3 bucket (private, OAC-only), CloudFront distribution (S3 origin only), security headers policy (CSP incl. Google Fonts, HSTS), CloudFront Function: www→apex 301 redirect + pretty-URL→index.html rewrite; A/AAAA alias at apex and www |
| auth | Cognito user pool (sign-up disabled), user pool client (PKCE, no secret, callback = site URL), hosted UI on custom domain `auth.<root_domain>` (us-east-1 ACM cert + Route53 alias to the Cognito-managed CloudFront distribution), managed-login branding for the SPA client styled to match the web theme (colors/radii in `tf/main.tf`; assets like logo/favicon are added via the console and don't conflict with IaC settings), admin-created users are ops, not IaC |
| api | HTTP API `{proxy+}` routes: `/api/greader.php/*` (no authorizer), `/api/v1/*` (Cognito JWT authorizer scoped by audience); `api` Lambda arm64 Node 22 (512 MB / 10 s), env `QUEUE_URL` + `sqs:SendMessage` on the ingest refresh queue — a successful subscribe (web, OPML import, or GReader client) enqueues the new feed immediately so it refreshes within seconds instead of waiting for the 5-minute schedule; default-route throttling 25/s rate / burst 50 (confirmed live 2026-08-24); structured access logs; 5xx/throttle alarms |
| ingest | EventBridge Scheduler `rate(5 minutes)` → orchestrator Lambda (256 MB / 60 s); SQS standard queue (visibility 120 s, redrive maxReceiveCount 5) → worker Lambda (512 MB / 60 s, reserved concurrency 10); exposes refresh queue URL/ARN outputs consumed by the api module; DLQ depth alarm; DLQ redrive console for ops |
| db | Aurora DSQL cluster; IAM policy granting `dsql:DbConnect` to each Lambda role |

## CI/CD (GitHub Actions)

OIDC role per repo (`gh-oidc/sparkle-rss-deploy`) with permissions limited to the
resources Terraform manages; no static AWS keys anywhere.

```
ci.yaml (pull_request + push to main — no deploy)
  pnpm install --frozen-lockfile
  pnpm lint && pnpm typecheck
  pnpm test                # vitest units + integration (service Postgres)
  pnpm build               # web + lambda bundles + static marketing site (uploaded as artifact)
  tf: terraform fmt -check -recursive && init -backend=false && validate
  plan job (pull_request only): OIDC-assumes the read-only `sparkle-rss-github-plan`
    role, runs `terraform plan` against live state, and publishes the diff to the
    job summary so every PR shows exactly what a merge will change. The plan role
    trusts `pull_request` refs and is strictly read-only; the deploy role stays
    pinned to `refs/heads/main`. (Bootstrap: the role is created by this same
    `github-oidc` module on the next normal deploy; until the repo variable
    `TF_PLAN_ROLE_ARN` is set the plan job logs and skips.)

deploy.yaml (push to main; `paths-ignore: docs/**, *.md` — docs-only pushes skip it)
  pnpm install --frozen-lockfile
  OIDC assume deploy role
  terraform init (S3 backend) → collect build-time outputs (Cognito config)
  quality gate: pnpm lint && pnpm typecheck && pnpm test
  pnpm build (web bundle gets VITE_COGNITO_ISSUER/CLIENT_ID from tf outputs; lambda zips; site)
  terraform plan -out=tfplan → terraform apply -auto-approve tfplan
  db migrations: pnpm --filter @sparkle/db exec tsx src/migrate.ts (DSQL IAM token)
  aws s3 sync apps/web/dist s3://$ASSETS_BUCKET --delete (+ CloudFront invalidation)
  aws s3 sync apps/site/dist s3://$SITE_BUCKET --delete (+ CloudFront invalidation), gated
     on the site module being enabled
```

Deploy order in the pipeline: `terraform apply` (Lambdas + everything else) → DB
migrations → web assets → site assets. Lambda-first is safe because migrations are
forward-only and additive; a schema change that the *old* Lambda must survive is not a
thing here (one deploy ships code + schema together).

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
