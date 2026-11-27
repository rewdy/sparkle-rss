# Proposal

## Why

Swipe is an unused browsing mode that adds a second navigation model and its own rendering and pagination paths. Removing it simplifies stream browsing around List and Cards.

## What Changes

- **BREAKING** Remove the Swipe selector option and full-screen story renderer from the web reader.
- Convert existing device-local Swipe selections to List. Preserve existing List and Cards selections and the legacy Feed-to-List migration.
- Redirect old story URLs to their parent streams, preserving filter and sort. Apply the same redirect when browser history returns to an old story URL.

## Capabilities

### New Capabilities

### Modified Capabilities

- `feed-presentation` covers the two-option selector and legacy preference migration.
- `reader-navigation` replaces story-position restoration with parent-stream compatibility.
- `full-article-content` updates the stream-browsing requirement to cover the supported presentations.

## Impact

The change affects the web shell, stream and header components, local preferences, route parsing and history, tests, and current documentation. List and Cards continue using shared article media and reader logic. Saved retains its dedicated library. No API, database, infrastructure, or account-settings migration is required.
