# Sparkle RSS

A serverless, FreshRSS-compatible RSS reader on AWS. Full documentation lives in
[`docs/`](./docs/); start with [docs/00-overview.md](./docs/00-overview.md).

- **Contract:** the Google Reader compatible API (`docs/02-greader-api.md`) consumed by
  NetNewsWire.
- **Agents:** read [`AGENTS.md`](./AGENTS.md) before making changes.

## Quick start (local)

```sh
corepack enable
pnpm install
cp .env.example .env
docker compose up -d db   # local Postgres (DSQL has no emulator)
pnpm test                 # unit tests
pnpm dev                  # api on :8787, web on :5173
```
