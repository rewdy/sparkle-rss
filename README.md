# Sparkle RSS

A serverless, FreshRSS-compatible RSS reader on AWS. Full documentation lives in
[`docs/`](./docs/); start with [docs/00-overview.md](./docs/00-overview.md).

- **Contract:** the Google Reader compatible API (`docs/02-greader-api.md`) consumed by
  NetNewsWire.
- **Agents:** read [`AGENTS.md`](./AGENTS.md) before making changes.

## Live deployment

- App: **https://app.sparklerss.com** (SPA + API behind the same CloudFront)
- Deploy: push to `main` → `deploy.yaml` (OIDC-assumed role; no static keys)
- Fork configuration: edit `tf/terraform.tfvars` (backed by `tf/variables.tf`, the
  single infra config: app_domain, deploy_site, site_domain, allow_signups,
  prefixes/repo) and, for your own state bucket, the inline S3 backend in
  `tf/main.tf`. No env vars or backend files needed. GitHub variables:
  `AWS_DEPLOY_ROLE_ARN` and `AWS_REGION`.

## Quick start (local)

Full workflow in [docs/07-local-development.md](./docs/07-local-development.md).

```sh
corepack enable
pnpm install
cp .env.example .env
docker compose up -d db     # local Postgres (DSQL has no emulator)
pnpm db:migrate:local
pnpm test                   # unit + integration tests
pnpm dev                    # api on :8787, web on :5173
pnpm --filter @sparkle/api ingest   # fetch due feeds (no SQS locally)
```
