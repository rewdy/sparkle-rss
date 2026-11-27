# Tasks

## 1. Web presentation and local preferences

- [x] 1.1 Limit `ui-state.ts` and `Topbar` to List and Cards. Keep the existing storage key and normalize legacy Swipe and Feed to List. Verify in `presentation-state.test.ts` and `feed-presentation.test.tsx` that supported preferences persist, legacy values are rewritten without touching other settings, and Saved hides the selector.
- [x] 1.2 Remove `StoryView.tsx`, story-only shell and stream props, scroll-snap rendering, and index-triggered pagination. Keep the List and Cards sentinel and hidden-stream restoration. Update `feed-presentation.test.tsx` to exercise the surviving renderers and stream states. Verify that scrolling and pagination do not initiate full-content extraction or mark articles read.
- [x] 1.3 Update the presentation and content-fetch sections in `docs/05-frontend.md` and `docs/11-full-content-fetch.md`. Retire `docs/09-swipe-story-view.md` from current guidance and update its references in the overview, roadmap, and repository instructions. Verify current guidance describes List and Cards and dated decisions retain their historical context.

## 2. Routes and reader history

- [x] 2.1 Remove the story index from normal route parsing and Shell navigation. Add the bounded compatibility resolver and replace old story locations with canonical parent streams. Verify recognized stream paths, filter and sort, the Saved filter rule, malformed and unrelated paths, and ordinary article and image routes in `routing.test.ts` and shell coverage.
- [x] 2.2 Preserve valid legacy origins in `reader-navigation.ts`. Update `reader-navigation.test.ts` and `cards-reader-navigation.test.tsx` to verify reload, Back, Escape, and Forward with legacy origins, direct-link fallback, and normal List, Cards, and Saved restoration. Document replacement behavior in `docs/05-frontend.md`.
- [x] 2.3 Record the removal and compatibility decisions in `docs/decisions.md`, and add the completed work to the roadmap with its current-state date. Verify the open focal-point plan's StoryView task is accounted for if it is still pending.

## 3. Integrated verification

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` against local Postgres including Google Reader conformance, and `pnpm build:web`. Verify migration and old-link replacement in a browser, including a legacy reader history stack. Check the two-option selector at a narrow viewport and verify List and Cards pagination and reader return.
