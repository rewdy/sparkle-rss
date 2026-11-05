# Spec Delta

## MODIFIED Requirements

### Requirement: Private durable copies and provenance
A successful save SHALL persist validated image bytes in private application
storage and record save time, image source URL, alt text, article title and URL,
source type, and feed title/URL for feed articles or site name/URL for URL
articles. Delivery SHALL use the stored copy. Explicit selection SHALL NOT be
subject to automatic splash size or semantic exclusion rules.

#### Scenario: Original image disappears
- **WHEN** a previously saved image is removed from the publisher's site
- **THEN** its stored copy and captured attribution remain available to its owner

#### Scenario: Save a smaller illustration from read later
- **WHEN** a reader selects a valid supported image smaller than the automatic
  splash threshold in a URL article
- **THEN** it is saved with that article's title and URL

## REMOVED Requirements

### Requirement: og:image as a discovery fallback
**Reason**: The `og:image` Open Graph scraping path in article fetching is
scrapped. The image ingestion pipeline is the canonical source for article
images, and `og:image` metadata adds unbounded page-fetch cost and unreliable
signal quality relative to feed-supplied media.
**Migration**: Existing behavior that relied on `og:image` as a fallback for
hero image discovery now falls back to the ingestion pipeline's feed-order
selection; read-later one-off images store a remote URL discovered by the
extractor's remaining content-image heuristics instead of Open Graph tags.
