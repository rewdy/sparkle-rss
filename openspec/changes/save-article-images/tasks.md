# Tasks

## 1. Durable associations and lifecycle

- [x] 1.1 Extend `packages/db/src/schema.ts` and add a forward-only migration for saved-image source snapshots, dedupe keys, save time, and ascending indexes; verify local migration and `packages/db/test/schema.int.test.ts` coverage, including unchanged splash rows and nullable splash dedupe keys.
- [x] 1.2 Restrict media deletion in subscription unsubscribe and core ingest orphan-feed cleanup to automatic splashes; verify `packages/db/test/services.int.test.ts` and `ingest.int.test.ts` cover retained saves, missing sources, and unaffected shared objects.
- [x] 1.3 Update docs 03 and 08 with association ownership, provenance, and current orphan-byte retention; verify documented columns and cleanup rules match the migration and services.

## 2. Safe explicit image fetching and persistence

- [x] 2.1 Implement normalized source image extraction and source identity resolution for feed entries and read-later items; verify unit fixtures cover relative URLs, protocol-relative URLs, query strings, linked images, and duplicate identity through feed/read-later views.
- [x] 2.2 Add bounded binary fetching with per-hop public destination validation bound to transport resolution, credential rejection, streaming 5 MiB limit, total deadline, format validation, and pixel limits; verify injected transport tests cover redirects, rebinding, IPv4/mapped IPv6, wrong MIME, truncated images, missing length, small images, and all supported formats.
- [x] 2.3 Extend media persistence with source authorization, snapshot capture, immutable conditional uploads, dedupe conflict handling, source-state lookup, detail, and removal; verify integration tests cover concurrency, retry after failures, byte reuse, original save-time preservation, re-save after removal, and cross-user access.
- [x] 2.4 Grant API media-prefix S3 writes through `tf/modules/api/main.tf` and retain local S3 wiring; verify Terraform validation/plan scopes permissions to the private bucket and local Floci can store and retrieve a saved copy.
- [x] 2.5 Update docs 04, 07, 08, and 10 with permissions, local setup, explicit-save limits, read-later behavior, and unchanged automatic hero persistence; verify documented behavior against the implementation.

## 3. Mixed library service and web API

- [x] 3.1 Add the core saved-library service with a user-scoped ordered union, bounded global pagination, and a dedicated versioned cursor preserving database timestamp precision; verify integration tests cover both sort directions, equal timestamps, mixed numeric/UUID IDs, sub-millisecond article timestamps, invalid cursors, and user isolation at page boundaries.
- [x] 3.2 Wire `/api/v1/saved`, saved-image create/source-list/detail/delete routes, validation, errors, and authorized signed delivery in `apps/api/src/apps/web-api.ts` and services; verify API contract tests cover authentication, foreign IDs, URL/source mismatch, persistence failures, expiry fields, and independent article state.
- [x] 3.3 Document the web-only API and cursor contract in docs 03/05/08; verify example DTOs match actual responses and the existing starred entry service remains unchanged.

## 4. Reader image controls

- [x] 4.1 Add typed frontend API methods and React Query source-save-state/detail/library keys and image mutations; verify mutation tests cover pending/success/failure, duplicate clicks, invalidation, removal, and no successful item before server confirmation.
- [x] 4.2 Enhance `ReaderPane` sanitized content with accessible image controls and idempotent cleanup on content/entry changes; verify reader tests cover hover/focus, keyboard Enter/Space, touch visibility, linked images, figures/captions, rerenders, saved state, and retry.
- [x] 4.3 Update docs 05 and 08 with the reader behavior and query ownership; verify DOM/state behavior follows those contracts and article read/star/read-later actions remain independent.

## 5. Saved timeline and image preview

- [x] 5.1 Add the mixed virtualized Saved list, date groups and timestamps based on save time, lazy proportional thumbnails, existing article row actions, and ascending sort; verify list tests cover mixed grouping, empty/loading states, row identity, removal, and article-star query invalidation.
- [x] 5.2 Add saved-image route parsing, independent detail fetch, preview attribution/source links, expiry refresh, and remove navigation; verify routing/preview tests cover refresh, direct links, browser back/forward, list scroll restoration, missing sources, and deleted images.
- [x] 5.3 Adapt Shell/StreamInner/Topbar keyboard and presentation handling: article navigation skips image rows, image previews have no article actions, and Saved exposes the mixed list while normalizing Saved story routes; verify existing article routes and other streams' swipe behavior remain intact.
- [x] 5.4 Update docs 05 with Saved routes, mixed query keys, presentation and navigation; add the feature's actual state to docs 06 and decisions in the same implementation commit, verifying the roadmap does not mark work complete before its checks pass.

## 6. Integration acceptance

- [x] 6.1 Run repository lint/typecheck, affected unit/integration/API/web suites, unchanged Google Reader conformance suite, and web/Lambda builds; verify all pass and images do not leak into native-client fixtures.
- [x] 6.2 Exercise feed and URL-article image saving against local Postgres/Floci, then unsubscribe/delete source, remove a save, reload a preview, and navigate a paged mixed list with keyboard/touch; verify the two capability specs end to end and record outcomes/limitations in the implementation handoff.
- [ ] 6.3 Review additive DSQL migration/deploy ordering and Terraform plan through CI; verify rollback preserves saved data, bucket privacy remains enforced, and no manual production apply is required.
