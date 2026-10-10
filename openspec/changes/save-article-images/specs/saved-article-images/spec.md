# Spec Delta

## Purpose

Let readers keep private copies of individual article images with durable attribution, independent of the source article's lifecycle.

## ADDED Requirements

### Requirement: Accessible image saving in article content
The reader SHALL offer a labelled save control for each supported HTTP(S) image in owned feed and read-later article content. Controls SHALL appear on hover or keyboard focus and remain discoverable without hover on touch devices. Activation SHALL save that selected image without opening a surrounding image link or changing article read, star, or read-later state.

#### Scenario: Save a linked inline image
- **WHEN** the reader activates the save control on an image inside a link
- **THEN** the selected image is saved and the surrounding link is not followed
- **AND** article state remains unchanged

#### Scenario: Keyboard and touch access
- **WHEN** a reader navigates with a keyboard or uses a device without hover
- **THEN** the save control is reachable and activatable without a mouse hover

### Requirement: Private durable copies and provenance
A successful save SHALL persist validated image bytes in private application storage and record save time, image source URL, alt text, article title and URL, source type, and feed title/URL for feed articles or site name/URL for URL articles. Delivery SHALL use the stored copy. Explicit selection SHALL NOT be subject to automatic splash size or semantic exclusion rules.

#### Scenario: Original image disappears
- **WHEN** a previously saved image is removed from the publisher's site
- **THEN** its stored copy and captured attribution remain available to its owner

#### Scenario: Save a smaller illustration from read later
- **WHEN** a reader selects a valid supported image smaller than the automatic splash threshold in a URL article
- **THEN** it is saved with that article's title and URL

### Requirement: Bounded and source-validated saving
The service SHALL authenticate the caller, authorize the source article, and verify the image URL against that article's stored content or authorized media before outbound fetching. It SHALL accept JPEG, PNG, WebP, GIF, and AVIF with matching detected format, reject SVG and unsupported schemes, limit downloads to 5 MiB, use a 10-second total fetch deadline, cap redirects at five, reject non-public destinations at every hop, reject URL credentials, and enforce at most 40 megapixels and 16,384 pixels per dimension. It SHALL NOT forward caller credentials or cookies.

#### Scenario: Arbitrary URL or another user's source
- **WHEN** a caller submits an image absent from the authorized article or supplies another user's source identifier
- **THEN** the request is rejected without fetching the supplied image

#### Scenario: Invalid or oversized response
- **WHEN** an image exceeds a limit, redirects to a private address, or has invalid or unsupported image bytes
- **THEN** no successful saved item is created and the reader receives an actionable error

### Requirement: Idempotency and visible save state
Saving the same resolved image URL from the same source article for the same user SHALL return the existing save without changing its original save time. Concurrent duplicate saves SHALL produce one saved item. The reader SHALL display pending, saved, and retryable failure states; success SHALL be shown only after persistence succeeds.

#### Scenario: Repeated or concurrent save
- **WHEN** the same user saves the same source image repeatedly or concurrently
- **THEN** exactly one saved item appears with its original save time

#### Scenario: Storage failure
- **WHEN** fetching or persistence fails
- **THEN** the control offers retry and the Saved view does not show a completed save

### Requirement: Independent retention and removal
Saved images SHALL survive unsubscribe, orphan-feed cleanup, un-starring, and deletion of a source read-later item. The owner SHALL be able to remove a saved image independently; removal SHALL revoke that owner's association without deleting an object still used by another association. Existing issued delivery URLs SHALL expire within their configured short lifetime.

#### Scenario: Source is deleted
- **WHEN** the user unsubscribes or deletes the read-later source
- **THEN** the saved image and its snapshot attribution remain usable even if the source article cannot be opened internally

#### Scenario: Shared bytes are retained
- **WHEN** an owner removes a saved image whose bytes are also used by a splash or another user's save
- **THEN** the removed save disappears and the other uses remain available

### Requirement: Owner-only image access
Listing, detail, creation, removal, and delivery SHALL be scoped to the authenticated owner. Knowledge of a media or saved-image identifier SHALL NOT grant access.

#### Scenario: Foreign image identifier
- **WHEN** a user requests or deletes another user's saved image or requests its media without an owned association
- **THEN** the service returns not found and exposes no attribution or delivery URL
