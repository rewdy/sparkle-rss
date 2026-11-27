# Tasks

## 1. Reader end view and navigation

- [x] 1.1 Parse the end route for Today, Unread, and All and integrate it into the shell and reader history helper. Extend `reader-navigation.test.ts` to verify session replacement, Back and Forward, reload, direct return, and rejection of end routes on other streams.
- [x] 1.2 Build the themed end pane with focus on its heading, a channel return link, and Previous support. Wire Escape and k, preserve the mounted stream surface, and keep article actions inactive. Verify through reader interaction tests that the channel return works after the previous article disappears, and that entering the end view causes no article mutations.
- [x] 1.3 Update the route and reader navigation sections of `docs/05-frontend.md` and check the documented end URL and keyboard behavior against the reader tests.

## 2. Forward stepping and pagination

- [x] 2.1 Wire Next and j to open the end view at confirmed exhaustion or continue through the existing stream query. Add shell interaction coverage for Today, Unread, and All, a real next page, an empty trailing page, existing empty states, and the other streams' boundary behavior.
- [x] 2.2 Keep the current article visible during a single pending advance, expose retry, and discard stale results after reader navigation. Verify failed-page retries, repeated input, and leaving while loading in stream interaction tests.
- [x] 2.3 Document reader-driven pagination in `docs/05-frontend.md` and verify the description matches the loading, retry, and exhaustion tests.

## 3. Integration acceptance

- [x] 3.1 Exercise Next and j, Previous and k, return link, Escape, Back, and Forward in List and Cards. Verify filter and sort restoration, scroll behavior, keyboard focus, and light and dark themes on desktop and narrow mobile. Include a channel with mark-on-open enabled.
- [x] 3.2 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` with local Postgres, and `pnpm build:web`. Record the verified outcome in the roadmap and the reader design decision in `docs/decisions.md`.
