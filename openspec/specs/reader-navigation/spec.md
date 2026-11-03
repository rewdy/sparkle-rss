# Reader Navigation Specification

## Purpose

Provide predictable return navigation from a reading session to its originating browsing surface across stream presentations.

## Requirements

### Requirement: One history entry per reading session
Opening an article from a stream surface SHALL create one browser history entry. Article changes through j/k or reader next/previous controls SHALL update the article URL within that entry. Browser Back, reader Back, and Escape SHALL return directly to the originating surface. Forward SHALL reopen the session's last article. Navigation at an article boundary SHALL NOT create additional history entries. Keyboard opening from a surface SHALL follow the same policy as pointer opening.

#### Scenario: Several articles then return
- **WHEN** a user opens A from Unread, moves to B and C, and uses any of the three return actions
- **THEN** Unread is shown immediately without visiting B or A
- **AND** browser Forward reopens C

#### Scenario: Keyboard entry and boundaries
- **WHEN** j opens an article from a stream and subsequent steps reach a boundary
- **THEN** Back returns directly to the originating stream with no duplicate reader entries

### Requirement: Restore the originating browsing surface
Return SHALL preserve stream identity, filter, sort, and selected presentation. Swipe SHALL return to the story position from which the session was opened, even after article steps. List and Saved SHALL retain their existing scroll restoration; Cards SHALL retain its existing behavior of bringing the last viewed article into view when still loaded. Missing or removed articles SHALL NOT prevent returning to a usable surface.

#### Scenario: Swipe origin
- **WHEN** a user opens an article at story 12 in a feed with ascending sort, steps through articles, and returns
- **THEN** the same feed, sort, and Swipe presentation show story 12

#### Scenario: Cards and changing membership
- **WHEN** a user returns to Cards after reading several articles
- **THEN** Cards remains selected with filters and sort intact and brings the last viewed article into view if still loaded
- **AND** if it has left the stream the stream remains usable without reopening a reader

### Requirement: Safe return without an app origin
For a directly opened article or image preview without a known in-app surface origin, reader Back and Escape SHALL replace the current route with its parent stream preserving filter and sort. History length alone SHALL NOT qualify as a known origin. Native browser Back SHALL retain browser behavior in this case. Reloading an app-created reader history entry SHALL preserve its known origin. Invalid or legacy navigation metadata SHALL use the safe fallback.

#### Scenario: External referrer
- **WHEN** an article is opened from another website and the user activates reader Back or Escape
- **THEN** its parent stream replaces the article route without navigating to the external website

#### Scenario: Refresh during a session
- **WHEN** a user reloads a reader opened from Swipe and then closes it
- **THEN** the known originating story route is restored

### Requirement: Shared preview policy and navigation isolation
Saved image previews SHALL use the same origin-aware close behavior. Article stepping SHALL continue to skip image rows; image previews SHALL NOT acquire article shortcuts or mark-on-open behavior. Leaving a reader for another stream or Settings SHALL NOT carry its origin into a newly opened reader. Existing read/star/read-later actions and mark-on-open SHALL remain unchanged.

#### Scenario: Saved preview
- **WHEN** a user opens an image from ascending Saved and uses browser Back, reader Back, or Escape
- **THEN** ascending Saved returns with its existing scroll restoration and no article read mutation

#### Scenario: New surface after leaving reader
- **WHEN** a user leaves a reader via the sidebar, opens an article from another stream, and returns
- **THEN** the new stream returns without using the former reader's origin
