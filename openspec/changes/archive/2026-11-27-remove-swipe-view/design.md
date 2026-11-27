# Design

## Context

`Topbar` and `ui-state.ts` expose the presentation choice. `Shell` parses and writes story positions, and `StreamInner` mounts `StoryView` and requests pages near or beyond the loaded story position. Reader-history metadata stores the originating surface URL as a string, so an existing reader session can still point to a story URL after deployment. Saved already replaces old Saved story URLs.

## Goals / Non-Goals

**Goals**

- Remove story rendering, index state, and index-driven pagination while keeping old browser sessions usable.
- Preserve shared stream queries, List and Cards rendering and restoration, and authorized article media.

**Non-Goals**

- Changes to API contracts, data storage, image processing, or stream layout.

## Decisions

- Keep the existing device-local storage key. Normalize `swipe` alongside legacy `feed` through the existing patch helper so other preferences survive. Keeping the key also preserves List and Cards selections during deployment and rollback. Use stream presentation terminology for runtime types and atoms.
- Keep a narrow legacy URL resolver shared by the shell and reader history. Remove the story index from the normal route model. Match a terminal numeric story suffix and require the remaining path to resolve to a bare supported stream. Replace that location with its canonical parent using existing filter and sort helpers and the Saved filter rule. Hard rejection would strand bookmarks and browser history entries.
- Continue recognizing a validated legacy origin during a reader session. Keep the existing same-origin and matching-stream checks, and let browser Back reach the stored surface entry. Replace that entry in place and preserve its history state so Forward can reopen the last article. Treating every old origin as invalid would replace the reader entry and lose Forward behavior.
- Keep the existing sentinel-driven List and Cards pagination and the mounted-but-hidden stream during article reading. Removing the Swipe-only branch leaves the existing restoration mechanisms in place.

## Risks / Trade-offs

- A global story-suffix rewrite could catch unknown routes or alter article links. Limit compatibility to recognized bare streams and cover malformed and unrelated paths in routing tests.
- The active `add-image-focal-point` change explicitly includes StoryView in task 4.2. If Swipe removal lands first, reconcile that task in its own change before applying it. If focal-point support lands first, retain its List and Cards integration while deleting StoryView.

## Migration Plan

Ship through the normal web deployment. Each device migrates its local preference on load, and legacy URLs normalize when visited. Rolling back restores the renderer and selector. Devices that already migrated keep List, and users can select Swipe again on the rolled-back build.
