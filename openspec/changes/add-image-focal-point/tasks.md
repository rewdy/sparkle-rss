# Tasks

## 1. Configuration Toggle

- [ ] 1.1 Add `IMAGE_FOCAL_POINT_ENABLED` environment-backed boolean constant to the API service configuration, defaulting to `false`, and verify it reads from env with a unit test covering enabled, disabled, and unset cases
- [ ] 1.2 Document the new constant in `.env.example` (or the project's equivalent env template) and verify the key appears with a comment describing its cost-implication purpose

## 2. Database Migration

- [ ] 2.1 Add nullable `focal_x` and `focal_y` real columns to the `media_objects` schema definition and generate the forward-only DDL migration; verify the migration applies cleanly against a local DSQL-compatible database and that existing rows are unaffected
- [ ] 2.2 Update the Drizzle schema types so focal columns are exposed as `number | null` on the `mediaObjects` type, and verify TypeScript compilation passes for packages/db

## 3. Focal Point Detection Pipeline

- [ ] 3.1 Add a focal-point detection adapter (AWS Rekognition `DetectFaces` client) in packages/core that accepts image bytes and returns a normalized focal point `{x, y}` or `null` when no confident face is found; verify with a unit test using a stubbed Rekognition client for face-found, no-face, error, and timeout cases
- [ ] 3.2 Wire the detection step into the ingest worker between the bounded image fetch and the S3/dedup persist step, gated on `IMAGE_FOCAL_POINT_ENABLED`, with a dedup guard that skips detection when `focal_x`/`focal_y` are already non-null for the image's sha256; verify via integration test that detection runs once for new bytes and zero times for re-ingested bytes
- [ ] 3.3 Persist detected focal point coordinates on the `media_objects` row during the persist step and ensure an analysis failure or timeout is logged and swallowed without failing the feed ingestion; verify via integration test that a throwing detector still results in a stored image and a successful feed record

## 4. Focal Point Delivery and Reader Crop Bias

- [ ] 4.1 Expose `focalX`/`focalY` in the media delivery DTO (list and single-item media responses) alongside existing width/height metadata, and verify via API test that the values appear when present and are absent/null when not
- [ ] 4.2 Update the three cropped display surfaces (card grid, feed thumbnail, story view) to apply `object-position: <focalX>% <focalY>%` when a focal point is present, falling back to current center behavior otherwise; verify with component/unit tests covering the focal-point-present and focal-point-absent cases for each surface

## 5. og:image Removal

- [ ] 5.1 Remove `meta[property="og:image"]` and `meta[name="twitter:image"]` parsing from `metaFallback()` in `packages/core/src/article/fetch-article.ts`; verify by running the article-fetch test suite and confirming the `og:image`-specific tests are deleted
- [ ] 5.2 Remove or update `og:image`-related tests in `packages/core/test/article-fetch.test.ts` (including the relative-resolution test) so the suite passes with og:image parsing gone
- [ ] 5.3 Update `docs/08-article-images.md` and `docs/10-read-later.md` to describe the new fallback behavior for read-later one-off URL images (content-image heuristics instead of Open Graph tags); verify by re-reading the updated docs and confirming no lingering `og:image` references

## 6. Integration Verification

- [ ] 6.1 Run the full test suite (all packages) and confirm no regressions; verify with `pnpm test` (or the project's equivalent) exiting cleanly
- [ ] 6.2 Run `openspec validate` and confirm the change passes validation
