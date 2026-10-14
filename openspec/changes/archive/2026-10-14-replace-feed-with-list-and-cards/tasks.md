# Tasks

## 1. Consolidate the row layout

- [x] 1.1 Make today's Feed rendering the sole `EntryList`/`EntryRow` layout and remove the text-only presentation branch; update entry-list tests to verify right-hand stored thumbnails, aligned image-free rows, notes, renewed URLs, native activation, and thumbnail skeletons.
- [x] 1.2 Update the List layout description in `docs/05-frontend.md` and the replaced List assumptions in `docs/09-swipe-story-view.md`; verify they describe the retained thumbnail sizes, missing-image fallback, and unchanged reader workflow.

## 2. Build responsive cards

- [x] 2.1 Add a sibling `CardsView` with native button cards, `EntryMeta`, headline/read typography, time, notes, 16:9 authorized imagery, URL-specific failure recovery, and themed decorative placeholders; add component tests verifying content, image restrictions, placeholder behavior, renewed URLs, pointer/keyboard activation, and loading/empty states.
- [x] 2.2 Add grouped virtual grid rows using active-theme sm/md breakpoints, dynamic measurements, width-change remeasurement, stable row keys, and active-entry lookup; verify grouping/order/counts and entry-to-row mapping with focused tests at one/two/three columns, including page appends and incomplete final rows.
- [x] 2.3 Preserve a visible article anchor during regrouping and pin focused rows; support Tab/Shift+Tab traversal across mounted boundaries and scrolling the active entry into view. Verify focused-card behavior with component coverage and real-browser traversal across more than the overscan range.
- [x] 2.4 Document Cards layout, viewport breakpoint semantics, placeholder behavior, virtualized rendering, and original-image bandwidth trade-off in `docs/05-frontend.md`; verify the description matches the new component and existing query ownership.

## 3. Integrate presentation selection and migration

- [x] 3.1 Change the presentation type/validator and atom initialization to `list | cards | swipe`, normalize/persist legacy `feed` to `list`, and preserve unrelated storage keys; update presentation-state tests for all valid values, invalid/missing values, unavailable storage, legacy migration, reload, and exclusion from account settings.
- [x] 3.2 Replace the Feed selector choice with Cards and dispatch Cards to `CardsView` in `StreamInner`, sharing queries, media refresh, selection callbacks, sentinel, and footer; update presentation tests for every eligible stream, both sort directions, cursor appends, filters, no read mutation on switching/scrolling, and image URL refresh.
- [x] 3.3 Verify reader navigation, mark-on-open enabled/disabled, j/k order, Back/Escape restoration, Swipe story routes, and Saved's dedicated layout/preference preservation using existing routing/Saved tests plus focused integration coverage for Cards.
- [x] 3.4 Finish `docs/05-frontend.md` and `docs/09-swipe-story-view.md` selector/state examples; record the mode consolidation and placeholder decision in `docs/decisions.md`, and update `docs/06-roadmap.md` Current state and relevant backlog with verified progress in the same implementation commit.

## 4. Integration verification

- [x] 4.1 Run the web Vitest suites, `pnpm typecheck`, `pnpm lint`, and `pnpm build:web`; verify all pass and address failures attributable to the change.
- [x] 4.2 Review a real browser in light/dark themes at 320px, just below/at sm, just below/at md, and a wide desktop, including sidebar and reader open/closed; verify 1/2/3 columns, readable full titles/notes, no overflow or overlap, selector fit, stable resize behavior, and usable focus.
- [x] 4.3 Exercise a long multi-page stream with valid/missing/failed imagery, renewed signatures, card open/return, read-later URL notes, mode reload/migration, Swipe, and Saved; verify bounded mounted cards/images, pagination/end states, scroll restoration where entries remain, and no unintended read-state changes. Record verification results in the implementation handoff.
