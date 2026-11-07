# Proposal

## Why

Subscribing while browsing a blog currently requires copying its URL into Sparkle. A bookmarklet should discover its feed, ask for confirmation, and offer the user's preferred RSSFinder fallback when Sparkle cannot find or add it.

## What Changes

- Add a separate Subscribe bookmarklet in Settings, opening a small authenticated Sparkle popup for the current page.
- Discover a feed without creating a subscription, then show “Subscribe to <name>?” with optional custom title and folder fields and Cancel / Subscribe actions.
- For web subscriptions, try the supplied page first, then its origin root if discovery fails; preserve scheme, subdomain, and port, skip an already-checked root, and bound the complete attempt.
- Subscribe only after explicit confirmation; show success, duplicate-subscription, loading, and retry states.
- Add “Use RSSFinder.com” linking to `https://rssfinder.app/?q=<encoded source URL>` in both the popup and existing Subscribe dialog when feed discovery/subscription fails.
- Preserve the bookmarklet destination through sign-in.

## Capabilities

### New Capabilities

- `feed-subscription`: Bookmarklet installation, discovery-before-confirmation, subscription choices, and RSSFinder error recovery in both subscription surfaces.

### Modified Capabilities

- `user-auth`: Resume an interrupted subscription popup after sign-in using a validated internal return destination.

## Impact

- Web: bookmarklet builder/link, Settings, popup route, Shell routing, API client/query mutations, SubscribeModal, guard, and Login.
- API/core: authenticated discovery-only `/api/v1` endpoint reusing `discoverFeed`; final creation reuses the existing subscription service and refresh hook.
- Documentation: frontend route/API behavior, architecture's first-party API inventory, roadmap, and decision log during implementation.
- No schema, Terraform, new dependency, or Google Reader contract changes. Origin-root fallback is opt-in for web flows; shared discovery defaults remain unchanged.
