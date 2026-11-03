# Design

## Context

Shell.tsx owns route parsing, openEntry, move, closeReader, and Saved image navigation. Both opening and stepping push routes; closeReader uses history.length > 1 as a proxy for an app origin. This is unsafe for external referrers and causes the behavior in proposal.md. Cards' existing navigation test explicitly asserts history walking. Doc 05 explicitly describes push-per-article and must change with implementation.

StreamInner already retains List/Cards scroll surfaces while the reader is open, remembers the last active entry, and delegates Swipe position to the route. Saved has its own mounted list. URL-derived selection and existing query caches remain authoritative.

## Goals / Non-Goals

**Goals:** Make reader navigation an explicit shell-owned policy with native browser history implementing return and Forward. Preserve refreshable URLs and existing restoration semantics.

**Non-Goals:** A global back-handler registry, replacing wouter, interception of browser popstate to redirect users, changing history policy for Swipe scrolling itself, universal Settings/form back controls, and cross-reload pixel-perfect list restoration.

## Decisions

### Use a shell-owned navigation hook

Add a small typed helper/hook under apps/web/src/lib for open detail, replace detail, and close detail. Shell supplies route and navigation information; ReaderPane and SavedImagePane retain callbacks. A context with handlers registered on mount adds ordering, stale closures, and cleanup complexity to a route tree already controlled by one owner. Introduce context later only if multiple independent consumers need these actions.

No selected article atom or second navigation stack is needed. Browser history metadata belongs to its history entry, rather than React context or global ephemeral state. Any added non-history UI state must follow Jotai ownership.

### Push at entry, replace while reading

Opening from a valid surface pushes the detail route. j/k from a surface also opens a session; while a reader is active j/k and next/previous replace the detail URL and retain its origin metadata. A boundary step is a no-op. Forward naturally returns to the final replaced article. Returning with the reader button/Escape traverses back only for a validated app-created origin; otherwise replace with the route-derived parent stream. Do not use history.length for origin inference.

Merely navigating to the parent stream on every close would create duplicate surfaces and allow Back to reopen the reader. Maintaining every article in history and skipping N entries would require a fragile custom stack. Push/replace gives native behavior without those mechanisms.

### Store minimal versioned metadata on history entries

Use a namespaced, runtime-validated history.state payload for the reader session containing the origin surface URL and a surface entry identity, with an app-created marker on the originating surface. Store only same-app recognized surface paths and their filter/sort queries, never content or credentials. Retain unrelated history state fields and use wouter's supported navigation state API. Reader replacements preserve the original payload; current route selection always comes from the URL. Validate stream compatibility and metadata version before using an origin. Metadata survives refresh and native Forward, unlike mount-local refs. Unknown, malformed, or pre-upgrade entries fall back safely; they do not trigger guessed multi-entry jumps.

Capture the complete current surface route before opening, including /story/:index. Keep presentation preference in the existing device-local atom. Existing StreamInner/SavedList restoration remains responsible for layout and scroll; do not promise persistent pixel offsets on reload. Suspend hidden Swipe route writes so observers cannot replace the active reader or overwrite its origin.

### Cover all existing shell detail entry points

Route pointer and keyboard article openings and Saved image openings through the policy. The Saved image source-article link is currently a normal internal route; without an explicit surface origin it uses the parent-stream fallback rather than inventing a preview stack. Sidebar/filter/Settings navigation creates or replaces routes as before, without copying reader metadata. Missing article 404 and image removal continue to replace with a usable parent stream; they must not propagate stale session metadata. Direct links do not synthesize a hidden parent history entry: native Back can leave the app, while reader close stays within it.

## Risks / Trade-offs

- Browser Back no longer walks article history → intentional behavior change; document and replace the old assertion with return/Forward tests.
- Hidden Swipe observers can issue navigation → guard route writes while hidden and test a nonzero origin through multiple article steps.
- History state can be absent or stale → version and validate it; safe replacement fallback, no external return targets or length heuristic.
- Filtered items may disappear after mark-on-open → preserve existing stream caches/restoration and tolerate missing last-viewed anchors.
- JSDOM history timing can obscure defects → use awaited route assertions plus a real browser Back/Forward and reload walkthrough.

## Migration Plan

Frontend-only deployment through the usual pipeline; no storage migrations. Existing tabs/history entries without recognized metadata use the parent-stream fallback until a new session is opened. Update frontend documentation and the dated decision/roadmap handoff in the implementation commit. Rollback restores the previous bundle; namespaced metadata is ignored by older code.
