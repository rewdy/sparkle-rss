# Feed Presentation Specification

## Purpose

Provide an image-enhanced stream list that preserves consistent text alignment and the existing article reading workflow.

## Requirements

### Requirement: Device-local third presentation
The web reader SHALL offer List, Cards, and Swipe on Today, All, Unread, individual subscription, folder, and Read later streams. Selection SHALL persist on the current device without changing account settings. Existing List and Swipe preferences SHALL remain valid, stored legacy Feed (`feed`) preferences SHALL migrate to List (`list`), Cards (`cards`) SHALL be a valid selection, and missing or invalid preferences SHALL default to List. The former text-only List layout and separate Feed selection SHALL no longer be offered. Saved SHALL retain its dedicated mixed list without changing the stored preference.

#### Scenario: Reload selected List
- **WHEN** a user selects List and reloads an eligible stream
- **THEN** List remains selected on that device

#### Scenario: Reload selected Feed
- **WHEN** a user previously selected Feed and reloads an eligible stream after the update
- **THEN** List is selected with the former Feed layout and the separate Feed option is absent

#### Scenario: Reload selected Cards
- **WHEN** a user selects Cards and reloads an eligible stream
- **THEN** Cards remains selected on that device

#### Scenario: Visit Saved
- **WHEN** a user with List selected visits Saved and then returns to an eligible stream
- **THEN** Saved uses its dedicated layout and the eligible stream uses List

#### Scenario: Legacy Feed preference
- **WHEN** a user loads with a stored `feed` preference
- **THEN** List is selected with the former Feed layout and the normalized `list` preference is persisted without changing other local preferences

#### Scenario: Existing preference
- **WHEN** a user loads with an existing List or Swipe preference or an invalid preference
- **THEN** valid selections remain unchanged and invalid selections fall back to List

### Requirement: Consistent text alignment
List SHALL keep the headline and source metadata at the same left inset for every article at a given viewport width, whether an image is present, absent, loading, or failed. Thumbnails SHALL appear to the right of the text. Image-free rows SHALL use the available text width without an empty thumbnail placeholder. Headline wrapping SHALL remain readable without horizontal page overflow.

#### Scenario: Mixed imagery
- **WHEN** adjacent rows contain an image, no image, and a failed image
- **THEN** their headline and metadata blocks share the same left axis and no row is indented by thumbnail presence

#### Scenario: Narrow viewport
- **WHEN** List is viewed on a 320 CSS-pixel-wide screen
- **THEN** text and right-hand thumbnails fit without horizontal page overflow and the left text axis remains consistent

### Requirement: Existing article imagery and graceful fallback
List SHALL display a compact thumbnail only from existing authorized article-image metadata. It SHALL NOT extract images from article HTML, use remote source images as substitutes, or enlarge favicons into article thumbnails. Missing or failed imagery SHALL produce a usable text-only row with no broken-image artifact. Images SHALL reserve their display dimensions before loading and SHALL use lazy loading. Refreshed signed URLs SHALL be eligible to load after a previous URL failed.

#### Scenario: Stored image available
- **WHEN** an article has a usable stored article-image URL
- **THEN** List displays it as a right-hand thumbnail without delaying article text

#### Scenario: Image failure and refresh
- **WHEN** the thumbnail request fails and later the article receives a refreshed URL
- **THEN** the failed request falls back cleanly and the refreshed URL can be displayed

### Requirement: List workflow parity
List SHALL preserve the existing stream order, date groups and counts, filters, sort direction, pagination, source/author/time, read-state headline styling, and existing read-later notes. Activating an article or its thumbnail SHALL open the existing reader route and honor mark-on-open. Scrolling and switching presentations SHALL NOT mark articles read. Existing reader keyboard actions and browser Back/Escape behavior SHALL remain available. List SHALL remain responsive with long streams without mounting every loaded article image.

#### Scenario: Open article
- **WHEN** a user activates a List row or thumbnail
- **THEN** the existing article route opens with the current filters and sort, honoring mark-on-open

#### Scenario: Long stream
- **WHEN** a user scrolls through a stream with more than one page
- **THEN** more entries append in order, date groups remain correct, and only a bounded visible range of rows is mounted

#### Scenario: Read-later note
- **WHEN** a read-later article has a note and no article image
- **THEN** the note remains visible and the row remains text-only

### Requirement: Accessible controls and loading states
The presentation selector and List article activation SHALL support keyboard operation and visible focus. Thumbnails SHALL NOT introduce a duplicate focus target or repeat the headline as redundant accessible text. Initial loading SHALL show a List-appropriate skeleton with the same left text inset and reserved thumbnail dimensions. Empty and end-of-stream states SHALL remain available. The three-way selector SHALL fit narrow mobile headers while preserving navigation, refresh, and theme controls.

#### Scenario: Keyboard activation
- **WHEN** a keyboard user focuses a List article and activates it
- **THEN** the same reader route opens as for pointer activation

#### Scenario: Initial loading
- **WHEN** List is awaiting its first article page
- **THEN** an accessible loading status and aligned text/thumbnail skeleton appear

#### Scenario: End of stream
- **WHEN** the final nonempty List page has been reached
- **THEN** the end-of-stream indicator is shown
