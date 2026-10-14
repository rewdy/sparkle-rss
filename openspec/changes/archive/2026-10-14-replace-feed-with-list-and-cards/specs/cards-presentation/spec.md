# Spec Delta

## Purpose

Provide a responsive visual grid for browsing article streams while preserving the existing ordering, reading workflow, and authorized media access.

## ADDED Requirements

### Requirement: Responsive date-grouped cards
Cards SHALL display each story as a separate card under its existing date group and count. At the application's viewport breakpoints, Cards SHALL use three equal columns at or above md, two at or above sm and below md, and one below sm. Stories SHALL retain stream order left-to-right then top-to-bottom within each group. Date headers SHALL span all columns. Long headlines and notes SHALL wrap without horizontal page overflow, including at 320 CSS pixels.

#### Scenario: Breakpoint transitions
- **WHEN** the viewport crosses md or sm in either direction
- **THEN** the grid changes between three, two, and one columns without losing, duplicating, or reordering stories

#### Scenario: Date groups
- **WHEN** articles span several date groups and another page appends
- **THEN** headers and counts remain correct and cards follow the current sort order within each group

### Requirement: Card imagery and placeholder
Each card SHALL reserve a consistent 16:9 media area above its text. Available authorized stored article imagery SHALL fill this area with cover cropping and lazy loading. Missing or failed images SHALL show a theme-colored decorative placeholder without broken-image artifacts or extra network requests. Placeholders SHALL remain the same size as imagery. Cards SHALL NOT extract article HTML images, substitute remote source images, or enlarge favicons. Source favicons SHALL remain small metadata marks. A refreshed signed URL SHALL be eligible to display after the previous URL failed.

#### Scenario: Mixed imagery
- **WHEN** adjacent cards have valid, missing, and failed images
- **THEN** their media areas retain matching proportions and readable text, with placeholders for missing and failed images

#### Scenario: Renewed image URL
- **WHEN** a failed image receives a refreshed authorized URL
- **THEN** the card can display the refreshed image in the reserved area

### Requirement: Card reading workflow
Cards SHALL support Today, All, Unread, subscription, folder, and Read later streams. Each card SHALL show headline, source, author when present, time, read-state headline styling, and existing read-later notes. Activation anywhere on the card SHALL open the existing article route with current filters and sort and honor mark-on-open. Scrolling, resizing, and switching presentations SHALL NOT mark stories read. Existing reader keyboard navigation and Back/Escape behavior SHALL remain available. Returning from the reader SHALL retain Cards selection and restore the opened card to view when its entry remains in the loaded stream. Saved SHALL retain its dedicated mixed library.

#### Scenario: Open and return
- **WHEN** a user opens a card and returns using Back or Escape
- **THEN** the existing reader honors mark-on-open and Cards returns with the opened article in view when still present

#### Scenario: Read-later URL
- **WHEN** a read-later URL item has a note but no article image or subscription
- **THEN** its card shows the note and available source metadata with a placeholder and remains openable

### Requirement: Accessible cards and stream states
Cards SHALL provide native keyboard activation, a meaningful article label, and visible focus for each card with no duplicate media focus target or redundant image announcement. Initial loading SHALL display card-shaped skeletons with one accessible loading status. Empty and end-of-stream states SHALL remain available. Cursor pagination SHALL append stories without resetting scroll. Long streams SHALL keep mounted cards and image elements bounded to the visible region plus overscan, and keyboard focus SHALL remain usable as the user moves through cards.

#### Scenario: Keyboard use
- **WHEN** a keyboard user tabs through cards and activates one with Enter or Space
- **THEN** focus is visible, follows story order, and opens the same reader route as pointer activation

#### Scenario: Loading and empty stream
- **WHEN** the first page is pending and then resolves with no stories
- **THEN** a responsive card skeleton and loading status give way to the existing empty state

#### Scenario: Long stream pagination
- **WHEN** a user scrolls a multi-page stream to the end
- **THEN** pages append in order with bounded mounted media, preserved scroll, and an end-of-stream indicator after the final nonempty page
