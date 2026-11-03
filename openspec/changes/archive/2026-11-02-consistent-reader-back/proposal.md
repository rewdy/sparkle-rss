# Proposal

## Why

The article Back button and Escape currently traverse one history entry, so j/k browsing requires backing through articles instead of returning to browsing. A reading session should occupy one history entry so browser Back and reader close agree.

## What Changes

- Opening a reader from a browsing surface pushes one entry; subsequent article steps replace it.
- Browser Back, reader Back, and Escape return to the originating surface with filters, sort, presentation, and Swipe position intact.
- Browser Forward reopens the last article of that session.
- Reader close from a direct link safely replaces the route with its parent stream; native browser Back remains native when no in-app origin exists.
- Apply the same close policy to Saved image previews, preserving their image-specific keyboard behavior.
- Centralize reader navigation policy in a shell-owned helper rather than component-registered back handlers.

## Capabilities

### New Capabilities

- `reader-navigation`: Session-based reader history, origin restoration, and safe direct-link fallback across presentations and Saved previews.

### Modified Capabilities

None. Presentation specs keep their existing opening, keyboard availability, and restoration requirements; the new shared capability defines the history policy. Doc 05 and the existing history-walking test explicitly require updates.

## Impact

Frontend only: Shell navigation, shared navigation helper, Saved preview entry points, Cards navigation tests, and reader integration coverage. Update docs/05-frontend.md, relevant Swipe guidance, roadmap, and decisions during implementation. No server, Google Reader API, database, infrastructure, or dependency changes.
