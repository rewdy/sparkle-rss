# Spec Delta

## MODIFIED Requirements

### Requirement: Restore the originating browsing surface
Return SHALL preserve stream identity, filter, sort, and selected presentation. List and Saved SHALL retain their existing scroll restoration; Cards SHALL retain its existing behavior of bringing the last viewed article into view when still loaded. Missing or removed articles SHALL NOT prevent returning to a usable surface. A legacy numeric story URL for a recognized stream SHALL be replaced with its parent stream URL while preserving the applicable filter and sort. This SHALL also apply when browser history returns to a legacy story URL.

#### Scenario: Swipe origin
- **WHEN** a user opens `/feed/5/story/12?filter=unread&sort=asc`
- **THEN** the current URL is replaced with `/feed/5?filter=unread&sort=asc`
- **AND** the feed opens in the device's supported presentation

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
- **WHEN** a user reloads a reader opened from Cards and then closes it
- **THEN** the known originating stream route is restored

#### Scenario: Legacy reader origin
- **WHEN** a user reloads a reader opened before the update from a story URL and then uses reader Back or Escape
- **THEN** the browser returns through the existing history entry and replaces the story URL with its parent stream, preserving applicable filter and sort
- **AND** browser Forward reopens the last article in the session
