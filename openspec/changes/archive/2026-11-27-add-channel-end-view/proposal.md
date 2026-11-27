# Proposal

## Why

In Today, Unread, and All, stepping forward from the last article appears to do nothing. A friendly end view gives readers a clear finish and a way back to the channel.

## What Changes

- Open a dedicated reader view when Next or `j` advances past the final article in Today, Unread, or All. Suggested copy is **You’re at the end!** followed by **That’s the last story in this view. Thanks for reading!**
- Offer a channel-specific return link that restores the originating List or Cards surface. Previous or `k` returns to the last article.
- Continue through available pages before showing the end view, with visible loading and retry feedback when needed.

## Capabilities

### New Capabilities

### Modified Capabilities

- `reader-navigation` adds a terminal view to the existing article reading session.

## Impact

The web reader shell, route parsing, reader navigation, and article pagination are affected. This change requires frontend documentation and tests.
