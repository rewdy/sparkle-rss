# Design

## Context

Ingestion stores original image bytes content-addressed at `media/{sha256}` in S3
and serves originals via a presigned-URL redirect. All cropping happens in the
browser with `object-fit: cover`, which always centers the crop window. `og:image`
Open Graph parsing exists in `fetch-article.ts` as a metadata fallback but is
being scrapped: the feed ingestion pipeline is the canonical source of article
images and Open Graph scraping adds unbounded page-fetch cost for unreliable
signal. See `proposal.md` for motivation and `specs/` for requirements.

## Goals / Non-Goals

**Goals:**
- Persist a normalized focal point per unique media object, computed once.
- Gate the entire analysis pipeline behind a single configuration constant so it
  can be flipped off without a code change or redeploy logic change.
- Deliver the focal point to the reader so CSS `object-position` can bias crops.
- Remove the `og:image` scraping path cleanly, including tests and docs.

**Non-Goals:**
- Server-side crop variants or re-encoding of image bytes (a later change).
- Real-time or on-demand focal point detection at read time.
- Detecting multiple subjects or non-facial salient regions beyond the chosen
  detection strategy.

## Decisions

### 1. Focal point representation: normalized ratios on `media_objects`

Store `focal_x` and `focal_y` as nullable real columns (0..1) on the existing
`media_objects` table, matching the same normalized-ratio convention used by
AWS Rekognition bounding boxes. Null means "no focal point, use center."

*Why not pixel coordinates?* Normalized ratios survive rescaling, are directly
usable in CSS `object-position` percentages, and match the API's native output.

*Why nullable columns rather than a separate table?* A focal point is intrinsic
to the image bytes (content-addressed dedup means one row per unique image), so
a second table adds joins for no benefit.

### 2. Detection strategy: AWS Rekognition `DetectFaces`, with fallback

The stack is already AWS-native (S3, SQS, Lambda, DSQL). Rekognition returns
bounding boxes as dimension ratios for ~$0.001/image with a single network call,
requiring no model hosting, no Lambda cold-start penalty, and no native binary
bundling.

*Alternatives considered:*
- **sharp `strategy.attention`**: free and fast, but a skin-tone/luminance
  heuristic, not face detection; would fix some crops but not guarantee subject
  alignment. Deferred as a potential cheap enhancement if Rekognition cost
  becomes a concern.
- **@vladmandic/human (WASM)**: self-contained but adds ~620 KB of model loading,
  significant cold-start time, and native-complexity risk on Lambda. Rejected for
  the first iteration.
- **opencv4nodejs**: unmaintained or requires painful native OpenCV builds.
  Rejected.

If Rekognition finds no confident face above a minimum score threshold, we store
no focal point (fall back to center) rather than guessing. This keeps the feature
strictly better than current behavior or not worse.

### 3. Configuration constant

Expose `IMAGE_FOCAL_POINT_ENABLED` as an environment-backed boolean constant in
the API service configuration, defaulting to `false` so the cost is opt-in. When
disabled, the ingest worker skips the Rekognition call entirely; images persist
with null focal columns and the reader falls back to center cropping. The check
lives in the ingest worker, not in the media service, so the persisted-schema and
reader-side code remain identical either way.

### 4. Where detection runs: ingest worker, post-fetch, pre-persist

Detection runs in the ingest worker between the bounded image fetch and the
S3/dedup persist step. Dedup guard: only run detection when the `media_objects`
row's `focal_x`/`focal_y` are both null for the sha256, so re-ingesting the same
bytes never re-bills Rekognition.

### 5. `og:image` removal scope

Remove `meta[property="og:image"]` and `meta[name="twitter:image"]` parsing from
`fetch-article.ts` `metaFallback()`, drop the corresponding tests in
`article-fetch.test.ts`, and update `docs/08-article-images.md` and
`docs/10-read-later.md` to describe the new (removal) behavior. Read-later one-off
URL images fall back to the extractor's content-image heuristics instead of
Open Graph tags.

## Risks / Trade-offs

- [Rekognition cost scales with unique new images] → Dedup guard via sha256 +
  null-focal check limits calls to genuinely new bytes; the config constant
  provides a one-flag kill switch.
- [Rekognition latency (~100-300 ms/image) adds to feed ingestion] → Detection
  is best-effort with a short timeout; failures log and continue without
  blocking the feed.
- [Faces aren't the only salient subject (charts, food, products)] → No focal
  point is stored when no face is confidently found; center crop remains. A
  later change could add label/entropy-based fallbacks.
- [Removing `og:image` may reduce image coverage for read-later URL articles
  that have no content images] → Accepted trade-off per the proposal; the
  extractor's content-image heuristics remain as fallback.

## Migration Plan

1. Add `focal_x`/`focal_y` nullable columns to `media_objects` (forward-only DDL,
   no foreign keys, consistent with repo DSQL constraints).
2. Deploy the config constant and gated detection code with the toggle defaulting
   to `false` (no behavior change on deploy).
3. Remove `og:image` parsing and tests.
4. Flip the toggle to `true` when ready to incur cost; flip back to `false` at any
   time to stop incurring it (existing stored focal points remain valid and are
   still delivered).

## Open Questions

- None currently; the config constant makes the cost/benefit trade-off reversible
  at runtime, deferring the "is it worth it" judgment until after implementation.
