# Local Development

Run the whole system on a laptop with no AWS account: plain Postgres in Docker instead
of DSQL (there is no emulator; parity is guaranteed by keeping all SQL extension-free,
see D1 in [00-overview](00-overview.md)).

## Setup (one-time)

Prereqs: Node 22, Docker, pnpm 10 via corepack.

```sh
corepack enable
pnpm install
cp .env.example .env
docker compose up -d         # DB, migrations, Floci, and media bucket initialization
```

All local configuration lives in the repo-root `.env` — the API and Vite both read it
(Vite's `envDir` is the repo root). `.env.example` documents every variable.

## Running

```sh
pnpm dev        # API on :8787, web on :5173 (proxies /api → :8787)
```

### Auth without Cognito

Two variables in `.env` work together:

- `VITE_AUTH_DISABLED=true` — the SPA skips Cognito entirely and presents a dev user.
- `ALLOW_INSECURE_DEV_AUTH=true` — the API accepts the `X-Dev-User` request header as
  the identity instead of a Cognito JWT.

The header value is the user name (the SPA sends `dev-user`); the user row is created
on first web-API request. Use a different value to simulate a different user. Never
deploy with either variable set.

### Feed ingestion without SQS

Production schedules fetches via EventBridge → SQS → Lambda workers. Locally nothing
schedules them, so after subscribing to a feed, run:

```sh
pnpm --filter @sparkle/api ingest    # fetch every due feed now
```

### Local article-image storage

Local ingestion can persist article images through [Floci](https://github.com/floci-io/floci),
a lightweight open-source AWS emulator with an S3-compatible endpoint. This keeps image
ingestion and `/api/v1/media/:id` testable without AWS credentials or access to the
production bucket.

Start the database, automatic migrations, emulator, and bucket initializer:

```sh
docker compose up -d
```

Set these values in the root `.env`:

```dotenv
MEDIA_BUCKET=sparkle-rss-media-local
S3_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

The `db-migrate` and `media-init` Compose services run once and exit successfully after
applying migrations and creating the bucket idempotently. The API and
ingest worker use the same S3 client configuration, including path-style addressing, so
locally persisted images can be fetched through the normal media endpoint. Removing
`.floci-data` clears the bucket; the next `docker compose up -d` recreates it.

### Pointing the local UI at the deployed API

```sh
API_TARGET=https://app.sparklerss.com pnpm dev
```

The Vite proxy then forwards `/api` to the deployed stack. The browser performs a real
Cognito login in this mode (leave `VITE_AUTH_DISABLED` unset): set
`VITE_COGNITO_ISSUER` and `VITE_COGNITO_CLIENT_ID` in `.env` from `terraform output`
(the prod env exposes both), and ensure the deployed API's `WEB_ORIGINS` includes
`http://localhost:5173`. The prod stack already allows `http://localhost:5173` as a
Cognito callback (`enable_local_dev_callbacks`).

## Using NetNewsWire locally

1. Pick a stable `GREADER_HMAC_KEY` in `.env` (any value; per-machine).
2. Mint an API token in the web UI (Settings → API tokens). It is the client
   "password": `ClientLogin` matches `sha256(passwd)` against the stored hash.
3. Add the account in NetNewsWire:
   - URL: `http://localhost:8787/api/greader.php`
   - Username: the dev user name (e.g. `dev-user`)
   - Password: the API token

From another device on your LAN, use the workstation's IP instead of `localhost`; if
the client refuses plain HTTP, tunnel it (SSH reverse tunnel or Tailscale).

## Database

- `pnpm db:migrate:local` — manually run drizzle's stock migrator against Docker Postgres
  when needed; normal `docker compose up -d` runs it automatically.
- `pnpm db:migrate` — DSQL only (IAM auth, requires `DSQL_ENDPOINT`); used by CI
  against the real cluster. Do not run it locally.
- Reset: `docker compose down -v && docker compose up -d db && pnpm db:migrate:local`.
  This mirrors the DSQL dev cycle (fresh cluster, forward-only migrations).

## Testing

`pnpm test` runs unit + integration suites. The integration tests and the greader
conformance suite need Docker Postgres and `TEST_DATABASE_URL` (default
`postgres://postgres:postgres@localhost:5432/sparkle_test`; create the database once
with `docker compose exec -T db psql -U postgres -c 'CREATE DATABASE sparkle_test'`).

`pnpm typecheck` and `pnpm lint` (Biome) must stay clean.

## Environment variables

Everything local lives in the root `.env` — see `.env.example` for the full annotated
list.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | API, db scripts | Docker Postgres connection string |
| `PORT` | API | Local API port (default 8787) |
| `ALLOW_INSECURE_DEV_AUTH` | API | Accept `X-Dev-User` instead of Cognito JWTs |
| `GREADER_HMAC_KEY` | API | HMAC key for greader credential derivation (local; prod uses Secrets Manager) |
| `VITE_AUTH_DISABLED` | web | Skip Cognito in the SPA |
| `VITE_COGNITO_ISSUER` / `VITE_COGNITO_CLIENT_ID` | web | Real Cognito login when testing the local UI against a deployed API |
| `API_TARGET` | Vite dev server | Proxy target override (default `http://localhost:8787`) |
| `WEB_ORIGINS` | API | CORS allowlist for the dev origin |
| `DSQL_ENDPOINT`, `AWS_REGION` | db spike scripts | DSQL spikes only |
| `MEDIA_BUCKET` | API/ingest | S3 bucket for article media; set to a local Floci bucket for image testing |
| `S3_ENDPOINT` | API/ingest | Optional S3-compatible endpoint, e.g. `http://localhost:4566` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | API/ingest | Local emulator credentials when `S3_ENDPOINT` is set |
