# Tasks

## 1. Local selection and stream integration

- [x] 1.1 Extend the existing presentation union and local-storage validator to List/Feed/Swipe while retaining the storage key; add ui-state tests proving reload initialization, invalid fallback, existing-value compatibility, persistence, and immunity to server settings.
- [x] 1.2 Add Feed to Topbar and pass the shared presentation type through StreamInner; route Feed through EntryList and show the end marker for both list modes. Add focused component tests for selector changes, Saved exclusion, Feed rendering, and end-state behavior; verify existing List/Swipe selection still works.
- [x] 1.3 Fit the three-way selector into narrow headers with responsive spacing/brand treatment and accessible names; verify at 320 and 390 CSS pixels that navigation, selector, refresh, and theme remain reachable with no horizontal overflow. Update docs/05-frontend.md and docs/09-swipe-story-view.md to describe three device-local modes and Saved's exception.

## 2. Feed rows and measured layout

- [x] 2.1 Add the Feed variant to EntryList/EntryRow with text on the existing left inset and optional right-hand thumbnails, initial desktop/mobile sizes from design.md, existing notes and read typography, and scoped styles; extend entry-list tests for image/no-image rows, metadata, notes, and unchanged List imagery behavior.
- [x] 2.2 Add lazy loading, reserved image dimensions, URL-specific error fallback, and retry after URL renewal; verify component tests cover failure, refreshed URL, no remote-HTML fallback, and thumbnail activation using the existing article callback.
- [x] 2.3 Make Feed rows keyboard activatable with visible focus and decorative thumbnails, and add the Feed loading skeleton; verify keyboard/pointer equivalence, no duplicate image focus target, accessible loading status, and retained empty state through component tests.
- [x] 2.4 Preserve dynamic virtual measurement for Feed, update estimates and re-measure on mode changes, and verify in a browser that mixed-height rows, wrapped headlines, notes, image completion/failure, and List/Feed switches leave no gaps or overlaps. Document image sizing, fallback, shared query ownership, and original-image bandwidth trade-off in docs/05-frontend.md.

## 3. Integrated visual and behavior acceptance

- [x] 3.1 Review light/dark browser screenshots at 320, 390, 768, and 1440 CSS pixels using landscape/portrait/square/wide images, long source names/headlines, read/unread entries, no images, and failed images. Compare actual headline and metadata bounding-box left coordinates across mixed rows; verify equal coordinates, no horizontal overflow, and refine thumbnail sizing/spacing within the agreed right-hand layout.
- [x] 3.2 Exercise Feed across Today, All, Unread, folder, subscription, and Read later; verify filters/sort, date groups, pagination, reader keyboard shortcuts, mark-on-open on/off, browser Back/Escape, and existing story deep links. Verify scrolling and mode switching do not mark read, Saved preserves its dedicated layout/preference, and renewed image URLs render during an extended session.
- [x] 3.3 Check a 1,000+ entry stream in the browser for bounded mounted rows/images, smooth scrolling, and correct pagination; run targeted web tests, pnpm lint, pnpm typecheck, and pnpm build:web, recording results and any remaining limitations.
- [x] 3.4 Record the accepted layout and verification outcome in docs/decisions.md and add/check off the Feed roadmap item with the refreshed Current-state date in docs/06-roadmap.md in the implementation commit; verify the handoff accurately states what landed.
