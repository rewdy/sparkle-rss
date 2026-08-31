FROM node:22-bookworm-slim

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/tooling/package.json packages/tooling/package.json

RUN pnpm install --frozen-lockfile --filter @sparkle/db...

COPY packages/db packages/db
COPY packages/tooling packages/tooling
