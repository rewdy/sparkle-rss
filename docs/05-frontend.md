# 05 — Frontend (`apps/web`)

## Stack

| Concern | Choice |
| --- | --- |
| Build | Vite (React, TypeScript strict) |
| UI kit | **Mantine** (v9) — components + hooks (`@mantine/hooks`), dark/light/system color scheme built in |
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
| `/starred` | Starred items |
| `/today` | Items published since local midnight |
| `/unread` | All unread items (API stream `all`, filter forced to unread) |
| `/folder/:id` | Folder stream |
| `/feed/:id` | Feed stream |
| `<stream>/e/:id` | Reading pane for entry `:id` (e.g. `/all/e/123`, `/feed/5/e/123`) |
| `/settings` | Profile, appearance, API tokens (revocation requires a confirmation modal), OPML import/export |

All stream routes share one component parameterized by stream descriptor
(`{kind: 'all'|'starred'|'today'|'unread'|'folder'|'feed', id?}`), mirroring greader stream
semantics. `today` and `unread` are the API stream `all` plus extra params
(`pubFrom` = local midnight / `filter=unread`); they keep distinct query keys.
Unknown routes → redirect `/all`.

**Routing is the view state (standing requirement).** Every view change in the SPA —
opening/closing the reading pane, switching streams, stepping between entries — must be
implemented as a URL route change via wouter `navigate`, so browser back/forward always
works: selecting an entry pushes `<stream>/e/:id`, `j`/`k` inside the reader push the
sibling entry's route (back walks them), and closing the reader (back button/Esc) replaces
back to the bare stream path. Deep links to an entry id render from the loaded list cache or
fetch it via `GET /api/v1/entries/:id`; a 404 closes back to the stream. View preferences
(`filter`, `sort`) live in the query string (`?filter=unread&sort=asc`) as of a later
cleanup, so views are shareable deep links and back/forward restores them; the reader URL
carries the same params so they survive opening and closing an article.

## Layout: "minimal reader"

```
┌───────────────────────────────────────────────────────┐
│ ✦ Sparkle RSS │ All items (340)          [all|unread] │ top bar
├──────┬────────────────────────────────────────────────┤
│ ▣ All│  ── Today ─────────────────────────────────    │
│ ★    │  ┃ Feed Name            2h   title line        │
│      │  ┃ preview text two lines…                     │ card list,
│ Tech │  ── Yesterday ────────────────────────────     │ date-grouped
│  …   │                                                │
│ News │   (select → focused reading pane, /e/:id)      │
│      │   Title                                        │
│ +Add │   Byline · timestamp · open-original ↗         │
│      │   sanitized article content, ~68ch measure     │
└──────┴────────────────────────────────────────────────┘
```

- Sidebar: fixed stream rows (Today, All unread, Starred, All items), scrollable
  folder/feed list, fixed footer (settings, sign out); unread badges per feed/folder.
  At `< sm` the sidebar becomes a full-screen drawer toggled by a Burger in the top bar,
  auto-closing on navigation. A desktop icon rail is deferred (`sidebarOpenAtom` reserved).
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
  `m` toggle read, `s` star, `Shift+A` mark stream read, `Esc` back to list, `?`
  shortcut sheet. Planned, not yet built: `Enter/o` open original, `/` search focus,
  `g a / g s` go all/starred.
- Mark-read-on-open (implemented): global toggle in Settings, persisted like the other
  reading prefs. The originally-planned per-stream mark-as-read-on-scroll is deferred.
- Empty states with subscribe hint and optimistic read/star toggles (implemented).
  Skeletons on first load (implemented): 12 fixed-height placeholder rows matching the
  real row footprint replace the old "loading…" row (no list-replacement layout shift).
- Code-split routes (implemented): `/settings`, the subscribe dialog, and the `?`
  shortcut sheet are `React.lazy` chunks loaded on first open — the first-paint
  critical path stays just the reader shell.

## State management contract

- **TanStack Query owns everything from the server.** Query keys:
  `['entries', streamKey, {filter, sort}]` — `streamKey` distinguishes `all` / `starred` /
  `today` / `unread` / `feed:<id>` / `folder:<id>`, and `today` appends the local date
  (`today:2026-08-24`) so the key rolls over at midnight; a midnight timer re-renders the
  tree so an open tab rolls `today` over without navigation. `['entry', id]` (single-entry
  fetch for deep links not in the loaded list); `['unread-counts']`,
  `['subscriptions']`, `['folders']`, `['me']`. Infinite queries use our opaque cursor.
- Mutations: `markRead`, `toggleStar` (optimistic set, rollback on error),
  `markAllRead(stream, ts)`, subscription CRUD. Any entry mutation invalidates
  `['unread-counts']`.
- **jotai owns ephemeral UI**: `colorSchemeAtom`, `themeIdAtom`, `sidebarOpenAtom`,
  `markReadOnOpenAtom` (reading prefs also mirrored into
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

- PKCE + authorization code, scopes `openid profile email`.
- Callback route swaps code → tokens; stores user in memory + sessionStorage;
  silent renew via refresh token with fallback to iframe; expired-session navigation
  triggers hosted-UI redirect preserving deep link (`state` param).
- Logout: revoke refresh token + end session at Cognito, clear local state.

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
