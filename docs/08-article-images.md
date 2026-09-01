# 08 — Article Images & Media Assets (Planning)

This document plans the ingestion and storage work needed to provide an optional
article splash image. It is intentionally a design document: the feature is not
implemented yet.

## Goal

During feed ingestion, identify the first credible article image whose intrinsic
width and height are both greater than 256 pixels, download a bounded copy into
private application storage, and associate it with the materialized entry. The web
reader can use that image later without fetching the publisher's page at read time.

The same storage model should support a future user action such as “save this image”
without creating a second, incompatible image API.

## Non-goals for the first slice

- Fetching the linked article page or scraping Open Graph metadata.
- Replacing the feed's article HTML or changing Google Reader response semantics.
- Saving every image in an article.
- User image-saving UI, galleries, deletion UI, or image search.
- Guaranteeing that a publisher's first qualifying image is editorially a hero image.
  RSS feeds do not expose enough consistent semantics for that guarantee.

## Recommended selection behavior

The implementation should select one image deterministically per entry. “First” means
the first eligible candidate in feed order after applying the exclusions below; it does
not mean the first `<img>` tag blindly.

### Candidate sources, in priority order

1. An image enclosure or `media:content` image supplied as part of the feed item.
2. Images in the selected item content, in document order. The selected content is
   already the existing `content:encoded` → `content` → `summary` fallback.
3. A feed-specific thumbnail only when it is clearly item-specific, not a feed icon.

The first implementation should extend the `rss-parser` custom fields only as needed
for item-level media. It must not treat channel `<image>`, Atom `<logo>`, or Atom
`<icon>` as article images; those remain feed-icon inputs.

### Eligibility

A candidate is eligible only if all of these hold:

- The URL is absolute after resolution against the feed's final URL and uses `http` or
  `https`.
- The response is an image with a supported, browser-displayable MIME type.
- Intrinsic width **and** intrinsic height are greater than 256 pixels. Declared HTML
  `width`/`height` attributes are useful as an early rejection, but are not trusted as
  the final dimensions because publishers often use them for layout rather than the
  source image's natural size.
- The image passes resource limits: request timeout, maximum download bytes, maximum
  pixel dimensions, and a safe image decode check.

Dimension discovery requires a bounded image fetch when trustworthy dimensions are not
already available. A `HEAD` request is not sufficient: it usually has no dimensions,
and a full response is needed if the candidate is accepted for storage anyway. The
fetcher should stop/deny oversized content and never let an image failure fail the feed
refresh as a whole.

### Exclusions and ordering heuristics

To avoid icons and avatars while retaining legitimate square article art:

- Reject candidates with strong semantic signals in `alt`, `title`, class/id, or URL
  tokens such as `avatar`, `profile`, `userpic`, `gravatar`, `favicon`, `icon`, `logo`,
  and `emoji`.
- Reject candidates explicitly declared at or below 256×256 without downloading them.
- Prefer item media/enclosures and images near the beginning of the content. Preserve
  source order among otherwise equal candidates.
- Do not reject all square images. A 512×512 album cover, comic, or illustration can
  be the intended article image; the semantic exclusion list is safer than an
  aspect-ratio ban.
- Do not infer an image from the publisher's article page, JavaScript, CSS background,
  or Open Graph tags in this phase.

This is deliberately conservative. If the first candidate is an obvious avatar/icon,
continue to the next candidate. If no candidate survives, store no image. Selection
should return an explanation (`selected`, `rejected-too-small`, `rejected-semantic`,
`rejected-invalid`, or `fetch-failed`) for tests and structured logs, without storing
publisher HTML or sensitive response bodies.

## Ingestion flow

The worker's proposed flow becomes:

```text
fetch feed (conditional GET)
  → parse item metadata/content
  → select first eligible image candidate
  → bounded image fetch + dimension/decode validation
  → upload accepted bytes to private object storage
  → upsert entry and asset association
  → record feed success
```

Image processing must be best effort. An image timeout, bad image, unsupported format,
or object upload failure should be recorded on the entry/asset attempt and should not
discard otherwise valid article content. Feed-level fetch/parse failures retain their
existing backoff behavior.

The worker should avoid retaining a remote image in memory more than necessary. The
initial implementation may buffer up to the configured byte limit for simple validation;
if real feeds make that expensive, move to a streaming temp-file/buffer pipeline in a
later optimization.

## Storage recommendation

Use a Terraform-managed private S3 bucket for binary objects and DSQL metadata for
ownership, association, and dimensions. Do not put image bytes in DSQL or in the
`user_entries` row.

### Reusable logical model

Use two tables rather than encoding future behavior in one article-specific column:

`media_objects` — one stored binary object and its immutable metadata:

- `id` (UUID)
- `object_key` (opaque S3 key)
- `sha256` (content hash; supports future deduplication)
- `mime_type`, `byte_size`, `width`, `height`
- `source_url` (for provenance/debugging; not used as the UI delivery URL)
- `created_at`

`user_media` — a user-scoped use of an object:

- `id` (UUID)
- `user_id`
- `media_object_id`
- `entry_id` (nullable for a future standalone saved image)
- `kind` text, initially `article_splash`, later `saved_article_image`
- `created_at`

The first migration should follow the repository's DSQL constraints: no foreign keys,
no enum dependency, forward-only DDL, plain ascending indexes, and explicit indexes
for `(user_id, entry_id)` and `(user_id, kind)`. Referential cleanup belongs in the
core service layer. If implementation experience shows that cross-user deduplication
adds too much complexity, keep the two-table shape but initially create one object per
association; the hash still preserves a path to deduplication later.

For the initial splash use, create one `user_media` association for each materialized
`user_entries` row. This preserves user isolation and means deleting a subscription can
remove its entry association without affecting another user's saved image. A later
deduplication pass can safely share immutable `media_objects`.

## Unsubscribe and lifecycle behavior

### Current feed behavior

Today, unsubscribe deletes the user's `user_entries` rows and their
`subscriptions` row. The shared `feeds` row is not deleted. Consequently, when the
last subscriber leaves, the scheduler can continue fetching that feed and the worker
will simply fan out to zero users. Feed metadata, validators, and any orphaned feed row
therefore remain until a future cleanup change.

### Recommended media behavior

Media should follow the ownership of the thing it is attached to:

- Automatically generated `article_splash` associations are deleted when the associated
  user's entry is deleted during unsubscribe.
- A future `saved_article_image` association must not be deleted merely because the
  user unsubscribed. If the user intentionally saved it, `entry_id` may become null or
  the saved record may retain the original entry reference as historical metadata.
- A shared `media_objects` row is retained while any `user_media` association points to
  it, including another user's splash or the user's saved image.
- Once an object has no associations, mark it orphaned and remove the S3 object and
  metadata through a scheduled garbage-collection job after a grace period (for example
  24–72 hours). Delayed cleanup handles retries, concurrent resubscribe flows, and
  transient association races more safely than deleting inline during unsubscribe.

The unsubscribe operation must delete media associations before deleting the entry rows,
or first collect the affected entry IDs. This matters because DSQL has no foreign keys
and the entry-to-media relationship is enforced by application code.

### Recommended feed cleanup follow-up

The image work should include a separate feed-lifecycle task: after removing a
subscription, check whether any subscriptions remain for that feed. If none remain,
stop scheduling it and eventually remove the shared `feeds` row and its validators.
This avoids perpetual no-op fetches and makes feed-level cleanup explicit. The check and
delete need to be designed for a concurrent resubscribe; a conservative first version
can mark an orphan feed and let a janitor delete it only after a grace period. Feed
cleanup must not delete a shared feed or any media still referenced by another user.

Resubscribing after cleanup is treated as a new subscription. Existing entries are not
restored automatically; the next refresh imports current feed contents, while content
addressing may allow an identical image object to be reused.

### S3 and delivery

- Add a private, blocked-public-access S3 bucket in the existing `tf/modules/ingest`
  module (or a small `media` module if the resource set grows).
- Give only the ingest worker `s3:PutObject` and the API Lambda `s3:GetObject` through
  narrowly scoped IAM policies. Add lifecycle rules for orphaned objects once cleanup
  exists; do not enable public ACLs.
- Serve images through an authenticated API route that checks `user_id` ownership and
  returns a short-lived presigned GET URL, or streams the object through the API if
  stable URLs are later required. Start with presigned URLs to avoid making the bucket
  public or coupling the SPA to S3 details.
- Keep object keys opaque and non-user-controlled, for example
  `media/<uuid>/<sha256>.<normalized-extension>`.
- Set stored `Content-Type`, conservative cache headers, and `Content-Disposition:
  inline`. Do not trust the source filename or source MIME type without validating the
  decoded image.

This API shape is reusable: a future “save image” action can create another
`user_media.kind` association pointing at an existing object or upload a new object,
without changing the browser's delivery mechanism.

## API and UI boundary

The first implementation should expose splash metadata through `/api/v1` entry DTOs,
for example:

```ts
articleImage: {
  id: string;
  url: string; // short-lived authenticated delivery URL, or an API image URL
  width: number;
  height: number;
  alt: string;
} | null
```

The service should resolve the asset only for an authorized user. The Google Reader
surface should remain unchanged unless a client-compatible extension is specifically
designed and tested; the splash is a first-party web-reader concern.

The later reader update can use the existing TanStack Query entry payload and render
the image in the list/reading pane. It should keep the current sanitized article HTML
path unchanged and use lazy loading for the image.

## Security, reliability, and cost guardrails

- Restrict image URLs to `http`/`https`; follow redirects with the fetch implementation and cap
  count. Reject localhost, loopback, link-local, private, and other non-public targets
  after DNS resolution if the runtime makes that practical.
- Cap response bytes, dimensions, decode time, and per-entry candidate attempts. A
  reasonable starting configuration is a small candidate cap (for example 5), a 5 MB
  stored-image limit, and a 10-second image request timeout; tune from metrics.
- Validate magic bytes/decode rather than trusting `Content-Type`. Normalize or reject
  formats the browser cannot safely display.
- Never render a remote source URL directly as the application's trusted image URL.
- Emit counts and reasons, not image bodies or full query strings: candidates seen,
  rejected by reason, selected, fetch/decode failures, bytes uploaded, and upload time.
- Add S3/DSQL storage estimates to the cost review. Image storage and egress can exceed
  feed-text costs if every subscriber gets a separate copy.

## Testing plan

- Pure parser tests for HTML image order, relative URL resolution, `srcset`, enclosure
  extraction, semantic exclusions, dimension thresholds, and “first eligible wins.”
- Fetcher tests for redirects, timeouts, wrong MIME/magic bytes, truncated responses,
  oversized responses, valid dimensions, and decode failures using injected fetchers.
- Service/integration tests against Docker Postgres for asset rows, user scoping,
  idempotent re-ingestion, duplicate GUIDs, subscription deletion, and partial image
  failure preserving the entry.
- Terraform validation plus IAM review for bucket public access, worker write scope,
  API read scope, lifecycle behavior, and deploy ordering.
- API contract tests proving unauthorized users cannot obtain another user's image URL.
- A small fixture corpus from real feed shapes (RSS `content:encoded`, Atom content,
  media enclosure, avatar-first content, relative URLs, and no-image entries).

## Suggested implementation slices

1. Define the candidate model and pure selector; add fixtures and threshold/exclusion
   tests. No AWS or schema changes.
2. Add item-level media parsing and pass the feed final URL into candidate resolution.
3. Add bounded image inspection/download with metrics and best-effort worker behavior.
4. Add DSQL `media_objects`/`user_media` migration and core asset service with idempotent
   association semantics.
5. Add Terraform S3 bucket, IAM permissions, environment wiring, and deployment checks.
6. Wire worker ingestion, backfill existing entries by reprocessing stored feed data only
   where possible; otherwise document that historical entries need a fresh feed fetch.
7. Add `/api/v1` splash metadata and authenticated delivery URLs.
8. Build the future-facing web presentation separately, then add user-saved images as a
   new `kind` using the same asset service.

## Resolved design direction

- Always copy accepted images into private S3; do not fall back to remote URLs.
- Support JPEG, PNG, WebP, GIF, and AVIF; reject SVG initially.
- Use the documented byte, pixel, candidate-count, timeout, and redirect limits, tuning
  them from metrics.
- Expose stable authenticated `/api/v1/media/{id}` URLs backed by short-lived S3
  presigned redirects.
- Share immutable binary objects across subscribers while keeping `user_media`
  associations user-scoped.
- Identify stored bytes by SHA-256 and never overwrite an existing object in place.
- Delete automatic splash associations on unsubscribe; preserve explicit saved-image
  associations and garbage-collect unreferenced objects after a grace period.
- Treat feed-row orphan cleanup as part of the lifecycle hardening slice, not as an
  implicit side effect of image ingestion.
