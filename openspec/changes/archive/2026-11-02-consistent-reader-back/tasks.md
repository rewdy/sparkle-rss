# Tasks

## 1. Reader session navigation

- [x] 1.1 Add a shell-owned typed navigation helper using wouter state support, with namespaced versioned origin metadata and safe parent fallback; verify tests cover absent/malformed/legacy metadata, preservation of unrelated state, and rejecting external or incompatible origin paths.
- [x] 1.2 Wire article opening, j/k, next/previous, and close through push-on-open/replace-on-step behavior, including no-op boundary steps; replace the history-walking assertion in cards-reader-navigation.test.tsx and verify all three return actions plus Forward reopening the last article and keyboard opening from a surface.
- [x] 1.3 Update docs/05-frontend.md to describe reading sessions, native history, and direct-link behavior; verify no push-per-step or history-length origin guidance remains.

## 2. Surface restoration and preview consistency

- [x] 2.1 Preserve complete origin routes including Swipe position, guard hidden Swipe route writes, and retain existing List/Cards restoration; verify nonzero story return after multiple reader steps, filter/sort retention, and missing last-viewed entry handling with navigation integration tests.
- [x] 2.2 Route Saved image openings and close through the shared policy without enabling article shortcuts; verify Saved article stepping skips images, preview return retains sort/scroll, and image removal/article 404 land on a usable stream without stale metadata.
- [x] 2.3 Add integration coverage for reload with known origin, external/direct entry with unrelated history, browser Forward then close, and sidebar/Settings navigation followed by a new reading session; verify returns use the correct origin or parent fallback and mark-on-open/read-later behavior remains intact.
- [x] 2.4 Update relevant docs/09-swipe-story-view.md return guidance and append the navigation decision to docs/decisions.md; refresh docs/06-roadmap.md Current state/date and record completion with the implementation. Verify documentation agrees with the spec and tested restoration behavior.

## 3. Integration acceptance

- [x] 3.1 Run the web Vitest suite, pnpm lint, pnpm typecheck, and pnpm build:web; verify all pass and address navigation-related failures.
- [x] 3.2 Walk through real-browser Back/Forward, reader Back, Escape, and reload on List, Cards, Swipe, Read later, and mixed Saved, including a direct link; record observed results against the reader-navigation scenarios before declaring completion.
