# Proposal

## Why

Sparkle RSS opens All at the root even for readers who start every session in Unread or Today. An account-level home setting lets each reader choose their landing stream and puts it at the top of the sidebar for quick access.

## What Changes

- Add a Home view setting with All, Unread, and Today. All remains the default.
- Resolve `/` to the signed-in user's home stream and use `/` for app-wide home actions, including the topbar logo.
- Move the selected stream to the top of the sidebar while keeping the other links in their existing relative order.
- Keep explicit stream links and reader return actions tied to their original destinations.

## Capabilities

### New Capabilities

### Modified Capabilities

- `reader-navigation` gains account-level home selection, root routing, and sidebar ordering.

## Impact

Web Settings, the authenticated shell, route parsing, Topbar, Sidebar, and the existing `/api/v1/settings` contract. The preference uses the existing per-user JSON settings storage. Google Reader compatibility is outside this change's scope.
