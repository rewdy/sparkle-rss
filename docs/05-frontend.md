# 05 — Frontend (`apps/web`)

## Stack

| Concern | Choice |
| --- | --- |
| Build | Vite (React, TypeScript strict) |
| UI kit | **Mantine** (v9) — components + hooks (`@mantine/hooks`), light/dark/system color scheme built in |
| Routing | **wouter** — tiny, hook-first; matches our shallow route tree |
| Server state | TanStack Query v5 — all API data lives here, never in atoms |
| Client/UI state | jotai — view preferences, selection, sidebar, modals |
| Auth | `oidc-client-ts` against Cognito Hosted UI (PKCE, silent renew) |
| Styling | Mantine theme tokens + CSS modules for layout specifics; PostCSS preset from Mantine |
| Forms | Mantine form hooks (settings/subscribe dialogs only) |

## Routes

| Path | View |
| --- | --- |
| `/login` | Redirect to Cognito hosted UI (+ callback handler route) |
| `/all` | Reading list (all subscriptions) |
| `/starred` | Saved items |
| `/read-later` | Read later queue (feed entries marked for later plus saved URLs) |
| `/read-later/new` | Add-an-article form; the bookmarklet target (`?url=&title=&excerpt=&auto=1`) |
| `/today` | Items published since local midnight |
| `/unread` | All unread items (API stream `all`, filter forced to unread) |
| `/folder/:id` | Folder stream |
| `/feed/:id` | Feed stream |
| `<stream>/story/:index` | Swipe presentation position (zero-based story index) |
| `<stream>/e/:id` | Reading pane for entry `:id` (e.g. `/all/e/123`, `/feed/5/e/123`) |
| `/settings` | Profile, appearance, API tokens (revocation requires a confirmation modal), OPML import/export |

All stream routes share one component parameterized by stream descriptor
(`{kind: 'all'|'starred'|'readLater'|'today'|'unread'|'folder'|'feed', id?}`), mirroring greader
stream semantics. `today` and `unread` are the API stream `all` plus extra params
(`pubFrom` = local midnight / `filter=unread`); they keep distinct query keys. `readLater`
is not an entry stream: the API client routes it to `/api/v1/read-later`, whose items are
`Entry`-shaped so the same list and reading-pane components render them. Unknown routes →
redirect `/all`.

**Routing is the view state (standing requirement).** Every view change in the SPA —
opening/closing the reading pane, switching streams, stepping between entries — must be
implemented as a URL route change via wouter `navigate`, so browser back/forward always
works: selecting an entry pushes `<stream>/e/:id`, `j`/`k` inside the reader push the
sibling entry's route (back walks them), and closing the reader (back button/Esc) follows
browser history to the route that opened the reader. Deep links to an entry id render from the loaded list cache or
fetch it via `GET /api/v1/entries/:id`; a 404 closes back to the stream. View preferences
(`filter`, `sort`) live in the query string (`?filter=unread&sort=asc`) as of a later
cleanup, so views are shareable deep links and back/forward restores them; the reader URL
carries the same params so they survive opening and closing an article.

## Layout: "minimal reader"

```
┌───────────────────────────────────────────────────────┐
│ ✦ Sparkle RSS │ All items (340)          [all|unread] │ top bar
├──────┬────────────────────────────────────────────────┤
│STREAM│  ── Today ─────────────────────────────────    │
│ ▣ All│  ┃ Feed Name            2h   title line        │
│ ★    │  ┃ preview text two lines…                     │ card list,
│ ◷    │  ── Yesterday ────────────────────────────     │ date-grouped
│──────│                                                │
│FOLDER│   (select → focused reading pane, /e/:id)      │
│ Tech │   Title                                        │
│──────│   Byline · timestamp · open-original ↗         │
│ FEEDS│   sanitized article content, ~68ch measure     │
│  News│                                                │
│ +add │                                                │
└──────┴────────────────────────────────────────────────┘
      (Streams +add · Folders hides when empty · footer: settings, sign out)
```

- Sidebar has three uppercase-headed sections separated by exactly one divider each:
  **Streams** (the smart groupings Today / All unread / Saved / Read later / All items),
  **Folders**, and **Feeds** (the loose subscriptions). The Folders section — heading,
  rows, and its divider — is omitted entirely when the user has no folders, so no empty
  band or doubled rule appears. The `+ add` button sits beside the **Streams** heading
  (adding is a global action, not a feeds property) and opens a menu with "add feed…" /
  "add folder…" / "add article…", each opening its dialog or the save-article form. The
  **Feeds** heading carries the feed-list options menu (ellipsis) that holds the
  "unread only" toggle, persisted per user like the other reading prefs; it hides feeds and
  folders with no unread items. Each folder is bold with an open/closed folder glyph that
  collapses its feeds (state is device-local in `collapsedFoldersAtom`, default open).
  Selecting a folder navigates to its stream and selecting a feed opens the feed stream;
  unread badges show per feed/folder. Fixed footer (settings, sign out). At `< sm` the
  sidebar becomes a full-screen drawer toggled by a Burger in the top bar, auto-closing on
  navigation. A desktop icon rail is deferred (`sidebarOpenAtom` reserved).
- Entry metadata is one shared `EntryMeta` component ([feed icon] Site • Author • Date),
  with `Date` passed only where it fits the context: the list rows leave it off because
  the time sits right-aligned, while the reading-pane byline includes the full timestamp.
  `FeedIcon` (with an RSS fallback) is shared by the sidebar rows, list rows, and byline.
- Article opens as a focused single-column reading pane (in-place overlay on desktop,
  full-screen full-bleed on mobile) at `<stream>/e/:id`. Back/Esc returns to the list
  preserving scroll position.
- Date-grouped card list (Today/Yesterday/This week/Older), **virtualized** with
  `@tanstack/react-virtual` (v3, `directDomUpdates`): day-group headers + entries
  flatten into one flat virtualized row list; row heights measured dynamically (titles wrap);
  overscan 15; positions of mounted rows are written to the DOM directly while
  scrolling, React re-renders only when the visible range changes. j/k steps and
  deep links scroll the active entry into view (`scrollToIndex`, align auto).
- Keyboard (implemented): `j/k` open next/previous (each step is a history entry),
  `m` toggle read, `s` save, `l` read later (inside the read-later stream the same key
  removes the item), `Shift+A` mark stream read, `Esc` back to list, `?`
  shortcut sheet. Planned, not yet built: `Enter/o` open original, `/` search focus,
  `g a / g s` go all/saved.
- Mark-read-on-open (implemented): global toggle in Settings, persisted like the other
  reading prefs. The originally-planned per-stream mark-as-read-on-scroll is deferred.
- Empty states with subscribe hint and optimistic read/save toggles (implemented).
  Skeletons on first load (implemented): 12 fixed-height placeholder rows matching the
  real row footprint replace the old "loading…" row (no list-replacement layout shift).
- Code-split routes (implemented): `/settings`, the subscribe dialog, and the `?`
  shortcut sheet are `React.lazy` chunks loaded on first open — the first-paint
  critical path stays just the reader shell.

## Read later

A triage queue that is deliberately web-only: greader has no such concept, so
`/api/v1/read-later` is the only surface and NetNewsWire never sees these items (design and
rationale: [10-read-later.md](10-read-later.md)).

- The sidebar **Streams** block gets a **Read later** row with its unread badge. Adding an
  article is reached from the `+ add` menu on the **Streams** heading ("add article…") or
  from the bookmarklet; the stream itself has no header button.
- The reading pane gains a clock action beside the bookmark: it adds feed entries to the
  queue (`l`). Opened *from* the queue the action becomes "remove from read later", and
  saved URLs hide the star action because there is no entry behind them.
- `/read-later/new` is a code-split form (address / title / optional note). It
  auto-submits once when the bookmarklet sets `auto=1`, then opens the saved item so the
  extracted copy is the confirmation; a rejected or unfetchable address is explained inline
  and the link is still kept. Below the form, a collapsed section offers the bookmarklet.
- The bookmarklet link (`components/BookmarkletLink.tsx`, shared with the settings card) is
  a drag-to-bookmarks button built from the current origin by `lib/bookmarklet.ts`, plus a
  copy-code fallback. **React 19 refuses to render a `javascript:` href** (it substitutes a
  throw-stub), so the URL is written to the anchor node directly in an effect; dragging
  reads the DOM href, which is unaffected. The bookmarklet gathers only the page URL,
  title, and selected text and opens the app's form in a small window, because it cannot
  read the app's session from another origin.

## State management contract

- **TanStack Query owns everything from the server.** Query keys:
  `['entries', streamKey, {filter, sort}]` — `streamKey` distinguishes `all` / `starred` /
  `read-later` / `today` / `unread` / `feed:<id>` / `folder:<id>`, and `today` appends the
  local date (`today:2026-08-24`) so the key rolls over at midnight; a midnight timer
  re-renders the tree so an open tab rolls `today` over without navigation. `['entry', id]`
  (single-entry fetch for deep links not in the loaded list); `['unread-counts']`,
  `['read-later-count']` (sidebar badge), `['subscriptions']`, `['folders']`, `['me']`.
  Infinite queries use our opaque cursor. Read-later items reuse the entry key prefix
  (`['entries','read-later',…]`) and the same cursor, so optimistic entry patches and cursor
  paging work unchanged.
- Mutations: `markRead` / `markReadLater`, `toggleStar`, `toggleReadLater`,
  `removeReadLater`, `saveReadLaterUrl` (optimistic set, rollback on error; the URL save is
  a request because the server fetches the article), `markAllRead(stream, ts)`,
  subscription CRUD. Any entry mutation invalidates `['unread-counts']`; read-later
  mutations invalidate the queue and its count.
- **jotai owns ephemeral UI**: `colorSchemeAtom` (`light` / `dark` / `system`), `themeIdAtom`, `sidebarOpenAtom`,
  `markReadOnOpenAtom`, `sidebarUnreadOnlyAtom`, `collapsedFoldersAtom` (reading prefs also mirrored into
  `user_settings.data` via `/api/v1/me/settings` — server = source of truth across
  devices; local `sparkle.ui` localStorage is the pre-mount first-paint fallback), plus
  `todayRolloverAtom` (a midnight tick). The **open entry is not UI state**: it is derived
  from the URL (`<stream>/e/:id`) by `parseRoute`, so there is no selected-entry atom; the
  stream `filter`/`sort` are URL query params, not atoms. `applySettings` mirrors server
  settings into the atoms after the first load via the default store (setting `atom.init`
  post-mount is a no-op).
- No cross-contamination: no server payloads inside atoms, no fetches outside
  react-query. The API client retries a 401 once after a silent token renewal.

## API client

`src/lib/api.ts`: thin typed fetch wrapper over `/api/v1/*` attaching the OIDC access
token, refreshing via `oidc-client-ts` on 401 once then failing loudly. Response types
generated by hand in `src/lib/types.ts` mirroring the service DTOs (shared shape docs live
with `packages/core`; codegen is overkill at this size but noted as an option).

## Auth flow details

- PKCE + authorization code, scopes `openid profile email`. Cognito issues a
  refresh token automatically for an `authorization_code` grant (no
  `offline_access` scope needed or supported), so the silent renew can use a
  real refresh grant instead of a cross-origin iframe.
- Callback route swaps code → tokens; stores user in memory + sessionStorage.
- Token renewal is **on-demand**: `accessToken()` refreshes when the stored
  token is expired, and the API client refreshes once after a 401. Renewal does
  a CORS `POST` of the refresh token to the token endpoint (no hidden iframe),
  so it does not depend on third-party cookies. Cognito's token endpoint
  returns `Access-Control-Allow-Origin: *`, so no origin whitelist is required
  on the app client for this to work.
- Renewal failure distinguishes a **dead session** (provider rejects the refresh
  token with an OAuth error) from a **transient failure** (network/timeout). Only
  a dead session clears local credentials and redirects the app to `/login`;
  transient failures leave the session intact and surface to the caller.
- Logout: `signoutRedirect` ends the session at Cognito and clears local state.
- The `/login` page reports redirect failures with a retry action instead of
  hanging on a spinner.

## Build & deploy outputs

- `pnpm build:web` → static bundle in `apps/web/dist`; CI syncs to S3 and invalidates
- The active theme is chosen via the `themeIdAtom` and passed to
  `MantineProvider theme={THEMES[themeId]}`. `apps/web/src/themes.ts` defines a
  `ThemeDef` (id, label, 10-shade `accent` ramp) per preset; each builds a full Mantine
  theme that swaps only the `accent` palette, so every `--mantine-color-accent-*` usage
  (component `color="accent"` props, `light-dark()` CSS rules) adapts automatically in
  both light/dark. Future style settings (e.g. fonts) extend `ThemeDef` and are merged
  in `buildTheme`, so consumers never change shape.
- `index.html` sets `<meta name="theme-color">`, viewport, and preloads the app shell
  CloudFront (`/index.html` + hashed assets pattern).
- `index.html` sets `<meta name="theme-color">`, viewport, and preloads the app shell
  font subset. PWA manifest + service-worker shell deferred to Phase 6 (installability
  without offline complexity).

The stream shell also supports an optional device-local `swipe` presentation. It is
controlled by `storyPresentationAtom` and the header toggle, and does not alter the
standard `EntryList`. Swipe stories use the entry's authorized article image when
available, or a theme background with the small feed favicon beside the source title;
the favicon is never used as the hero image. The swipe surface is a native vertical
scroll container with mandatory CSS scroll snapping; its settled story index is written
to `<stream>/story/:index` so refresh and article back navigation preserve position.
Read stories remain actionable but use a gray button, check icon, and muted headline.
