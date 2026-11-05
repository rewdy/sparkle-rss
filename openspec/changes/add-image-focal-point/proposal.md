# Proposal

## Why

Readers frequently see article hero images cropped by center-based layout rules
(e.g. `object-fit: cover`), cutting off the photo's actual subject. We want the
system to identify a *focal point* — the most salient region of an image — so
the UI can crop toward what matters instead of the geometric center.

This is a compute-heavy operation (image analysis) that adds per-image cost and
latency, so the capability must be opt-in via configuration and easily disabled
without code changes.

Separately, we are scrapping the `og:image` scraping path. The existing
Open Graph fallback in `fetch-article.ts` (line 248) is superseded by the
current image ingestion pipeline and will be removed.

## What Changes

- **Remove `og:image` handling**: Delete the Open Graph `og:image` meta-tag
  parsing from the article fetch logic (`fetch-article.ts`) and any related
  tests or documentation references. The image ingestion pipeline is the
  canonical source of article images.
- **Add `image_focal_point` capability**: Introduce a new capability to
  detect and persist a focal point (coordinates) for ingested images. This
  allows the UI to anchor image crops (e.g. thumbnails, hero cards) to the
  subject of the image rather than the center.
- **Introduce configuration toggle**: Expose a dedicated configuration
  constant (e.g. `IMAGE_FOCAL_POINT_ENABLED`) in the settings or environment
  config. When disabled, the system must skip focal point analysis entirely —
  no cost, no latency impact — and fall back to current behavior.

## Capabilities

### New Capabilities
- `image-focal-point`: Covers the detection, persistence, and delivery of
  image focal points, gated behind a configuration toggle.

### Modified Capabilities
- `saved-article-images`: Requirement updates to stop referencing `og:image`
  metadata as a discovery source for one-off images, replacing that reference
  with the ingestion pipeline's focal-point-aware metadata.

## Impact

- **Code**: `packages/core/src/article/fetch-article.ts` (remove `og:image`
  parsing), `packages/core/test/article-fetch.test.ts` (remove related tests),
  and documentation (`docs/08-article-images.md`, `docs/10-read-later.md`).
- **Configuration**: New toggle constant in the environment/config system.
- **Database**: `media_objects` (or equivalent) likely needs a new column to
  persist focal point coordinates.
- **Cost/Latency**: When enabled, focal point detection adds an analysis step
  per image. When disabled, zero overhead.
