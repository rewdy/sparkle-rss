# Spec Delta

## Purpose

Provide a unified web Saved timeline that combines existing starred articles and independently saved image thumbnails in the order readers saved them.

## ADDED Requirements

### Requirement: One chronological saved timeline
The web Saved view SHALL interleave starred feed articles and saved images by their save timestamps, newest first by default, with the existing ascending sort option supported. Date grouping and row timestamps SHALL use save time. Existing starred articles SHALL appear without re-saving or changing their timestamps. Read-later articles SHALL NOT enter Saved merely by being in read later.

#### Scenario: Mixed chronology
- **WHEN** a user stars an article, saves an image, and then stars another article
- **THEN** Saved shows the later article, image thumbnail, and earlier article in that order under save-date groups

### Requirement: Stable mixed pagination
The timeline SHALL provide bounded cursor pages with a deterministic total ordering for equal timestamps across item types. Cursors SHALL be bound to the saved timeline and selected sort direction; malformed or incompatible cursors SHALL be rejected. Paging unchanged data SHALL neither skip nor duplicate items and SHALL remain user-scoped.

#### Scenario: Equal timestamps across pages
- **WHEN** articles and images share a save timestamp at a page boundary
- **THEN** each item appears exactly once while paging the unchanged timeline

#### Scenario: Invalid cursor
- **WHEN** a caller supplies a cursor for a different stream or direction
- **THEN** the request is rejected rather than returning an incorrectly ordered page

### Requirement: Image thumbnails and route-backed previews
Saved image rows SHALL show a proportion-preserving thumbnail, article/source attribution, and save time without article body previews or article read controls. Selecting an image SHALL open a route-backed stored-image preview with source links and an independent remove action. Back/forward, refresh, and deep links SHALL restore the selected view. A missing source SHALL retain attribution and external source link while omitting unavailable internal article navigation.

#### Scenario: Open image and return
- **WHEN** the user opens a thumbnail and returns using browser Back
- **THEN** the mixed Saved list and its scroll position are restored

#### Scenario: Refresh retained image preview
- **WHEN** the user refreshes a saved-image preview after its source has been deleted
- **THEN** the stored image and attribution render independently of the source

### Requirement: Existing article actions and native-client compatibility
Starred article rows SHALL retain normal article reading and un-save actions. Saving or removing an image SHALL NOT change article starring, unread counts, or read-later membership. The Google Reader starred stream SHALL contain only its existing article items and retain its existing contract.

#### Scenario: Image save remains web-only
- **WHEN** a reader saves an image and a native client synchronizes starred items
- **THEN** the image is absent from Google Reader responses and article state is unchanged

#### Scenario: Unsave an article with saved images
- **WHEN** a reader un-stars an article
- **THEN** its article row leaves Saved while its separately saved images remain
