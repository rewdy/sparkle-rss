# 05 — Frontend (`apps/web`)

## Stack

| Concern | Choice |
| --- | --- |
| Build | Vite (React, TypeScript strict) |
| UI kit | **Mantine** (v9) — components + hooks (`@mantine/hooks`), light/dark/system color scheme built in |
| Routing | **wouter** — tiny, hook-first; matches our shallow route tree |
| Server state | TanStack Query v5 — all API data lives here, never in atoms |
| Client/UI state | jotai — view preferences, selection, sidebar, modals |
| Auth | First-party `/api/auth/*` endpoints backed by Cognito; access token in memory, refresh token in an HttpOnly cookie |
| Styling | Mantine theme tokens + CSS modules for layout specifics; PostCSS preset from Mantine |
| Forms | Mantine form hooks (settings/subscribe dialogs only) |

## Styling policy

Styling changes MUST attempt Mantine theme configuration first, in this order:

1. **Theme colors and ramps**: add or adjust color values in `apps/web/src/themes.ts` (`createTheme`). This is the single source for every color value in the app.
2. **Component-level theming**: component props, Mantine `styles`/`classNames` APIs, or theme defaults in `createTheme`.
3. **Scheme-dependent CSS variables**: a `CSSVariablesResolver` (`apps/web/src/themes.ts`) emits `--mantine-color-*` overrides and `--sparkle-*` semantic tokens per color scheme; components and selectors consume the tokens.

Write a hand-written CSS rule ONLY when no theme mechanism reaches the target — for example raw article HTML (`.reading-content pre`), keyframes, or layout/positioning. Such rules may consume theme tokens (`var(--mantine-color-*)`, `var(--sparkle-*)`) but MUST NOT hardcode color values. If a rule seems to need a hardcoded color, add the color to theme configuration first and reference the token instead.

## Typography

Type, spacing, and shell chrome are rem-based, so they share one lever: the root font
size. On viewports at least 1600 CSS pixels wide, `styles.css` raises the root font
size to **112.5% of the user's default** (`@media (min-width: 100em) { html { font-size: 112.5%; } }`),
scaling everything together — including the sidebar and header, which are sized in
rem through `AppShell`. The percentage (not a pixel value) preserves users who already
enlarged browser text. Article bodies (`.reading-content`) are `1rem` and scale with
it. The only intentional exception is the mobile `input, select, textarea { font-size: 16px }`
floor, which exists to stop iOS Safari focus zoom, not as a design scale.

The sidebar renders in the sans-serif face (DM Sans), applied once on the sidebar
container (`ff={fonts.sans}`) so labels, section headings, and actions inherit it;
unread-count badges stay monospace. Approved by the user on 2026-11-04 after a local
review.

Settings uses the same sans-serif face for section headings and small, dimmed
helper text, with the Mantine large spacing token between sections.

## Routes

| Path | View |
| --- | --- |
| `/login` | First-party sign-in, temporary-password setup, and password recovery/reset |
| `/` | Account home redirect to All (default), Unread, or Today |
| `/all` | Reading list (all subscriptions) |
| `/starred` | Saved items |
| `/read-later` | Read later queue (feed entries marked for later plus saved URLs) |
| `/read-later/new` | Add-an-article form; the bookmarklet target (`?url=&title=&excerpt=&popup=1`) |
| `/today` | Items published since local midnight |
| `/unread` | All unread items (API stream `all`, filter forced to unread) |
| `/folder/:id` | Folder stream |
| `/feed/:id` | Feed stream |
| `<stream>/e/:id` | Reading pane for entry `:id` (e.g. `/all/e/123`, `/feed/5/e/123`) |
| `<channel>/e/:id/end` | Reader completion screen for Today, Unread, and All |
| `/settings` | Profile, appearance, API tokens (revocation requires a confirmation modal), OPML import/export |

All stream routes share one component parameterized by stream descriptor
(`{kind: 'all'|'starred'|'readLater'|'today'|'unread'|'folder'|'feed', id?}`), mirroring greader
stream semantics. `today` and `unread` are the API stream `all` plus extra params
(`pubFrom` = local midnight / `filter=unread`); they keep distinct query keys. `readLater`
is not an entry stream: the API client routes it to `/api/v1/read-later`, whose items are
`Entry`-shaped so the same list and reading-pane components render them. The authenticated
root waits for settings, then replaces itself with the canonical home stream URL. App-wide
home links target `/`, and explicit stream links and reader returns target their own streams.
If settings are unavailable, home falls back to All.

**Routing is the view state (standing requirement).** Every view change in the SPA —
opening/closing the reading pane, switching streams, stepping between entries — must be
implemented as a URL route change via wouter `navigate`, so browser back/forward always
works: selecting an entry pushes `<stream>/e/:id`, `j`/`k` and next/previous inside the reader replace that session's article route.
Browser Back, reader Back, and Escape return directly to the originating stream surface;
Forward reopens the last reader view in the session. In Today, Unread, and All, Next
or `j` from the last article replaces the current reader URL with the completion route.
The channel link and Escape close the reader, and Previous or `k` reopens the last
article when available. A directly opened completion route returns to its parent
channel with the current filter and sort. The completion screen keeps the List or
Cards surface mounted, with focus on the completion heading.
Namespaced, validated history-entry
metadata preserves the origin across refresh. Old `<stream>/story/:index` URLs for known
streams are replaced in place with the parent stream and its applicable filter and sort.
This also works when returning through browser history, so Forward can reopen the last
article. Reader close
without a known app origin replaces the route with its parent stream; native browser
Back keeps its normal behavior for direct links. The shell owns this policy through
`lib/reader-navigation.ts`, without a component back-handler registry. Deep links to an entry id render from the loaded list cache or
fetch it via `GET /api/v1/entries/:id`; a 404 closes back to the stream. View preferences
(`filter`, `sort`) live in the query string (`?filter=unread&sort=asc`) as of a later
cleanup, so views are shareable deep links and back/forward restores them; the reader URL
carries the same params so they survive opening and closing an article. At the loaded
boundary in Today, Unread, and All, the reader requests remaining cursor pages with
the same filter and sort. The article stays visible while loading. Next can be
retried on failure, and the completion route opens only after cursor exhaustion.
Leaving the reader discards any pending navigation from the request.

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
  **Streams** (the smart groupings All items / Today / Unread / Saved / Read later),
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
- Date-grouped thumbnail list (Today/Yesterday/This week/Older), **virtualized** with
  `@tanstack/react-virtual` (v3, `directDomUpdates`): day-group headers + entries
  flatten into one flat virtualized row list; row heights measured dynamically (titles wrap);
  overscan 15; positions of mounted rows are written to the DOM directly while
  scrolling, React re-renders only when the visible range changes. j/k steps and
  deep links scroll the active entry into view (`scrollToIndex`, align auto).
- Keyboard (implemented): `j/k` open next/previous (one history entry per reading session),
  `m` toggle read, `s` save, `l` read later (inside the read-later stream the same key
  removes the item), `Shift+A` mark stream read, `Esc` back to list, `?`
  shortcut sheet. Planned, not yet built: `Enter/o` open original, `/` search focus,
  `g a / g s` go all/saved.
- Mark-read-on-open (implemented): global toggle in Settings, persisted like the other
  reading prefs. The originally-planned per-stream mark-as-read-on-scroll is deferred.
- Empty states with subscribe hint and optimistic read/save toggles (implemented).
  Skeletons on first load (implemented): 12 placeholder rows matching the
  estimated real row footprint replace the old "loading…" row. Each placeholder has
  a leading date-label/count placeholder using the real date header's spacing and
  typography height, followed by explicit metadata/title bars in the DOM, centered
  inside slots matching the real xs metadata and md title (1.4 line height).
  Padding and metadata margin match real rows. Decorative bars are hidden from
  screen readers; one status announces loading.
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
- `/read-later/new` is a code-split form (`components/SaveArticleForm.tsx`) with two
  variants. The `page` variant is the in-app form: address / title / optional note, with
  explanatory copy. The `popup` variant is what the bookmarklet's window renders — the same
  fields but no intro copy and no per-field hints, and it confirms in place after saving
  instead of navigating to the saved item. `Shell` picks the variant from `?popup=1` /
  `window.opener` and, for the popup, renders the form without the app chrome (no topbar or
  sidebar) so a 650x530 window is not mostly shell. The form never submits on its own; a
  rejected or unfetchable address is explained inline and the link is still kept.
- The bookmarklet link (`components/BookmarkletLink.tsx`, shown only in the settings card) is
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
  `markReadOnOpenAtom`, `sidebarUnreadOnlyAtom`, `collapsedFoldersAtom`, plus
  `todayRolloverAtom` (a midnight tick). Preference ownership is split on purpose:
  **account-level** prefs (`themeId`, `markReadOnOpen`, `sidebarUnreadOnly`) are written to
  `user_settings.data` via `PUT /api/v1/settings` and are the source of truth across
  devices. The account-level `homeView` also uses this endpoint and stays in the React Query
  settings cache. It promotes the selected stream to the top of the sidebar on save.
  **Device-level** prefs (`colorScheme`, `storyPresentation`, `sidebarOpen`,
  `collapsedFolders`) stay in the `sparkle.ui` localStorage entry. `applySettings` mirrors
  account settings into the atoms after the first settings fetch and deliberately ignores
  `colorScheme`, so a server value can never override the local light/dark choice — that
  would silently undo every topbar toggle, which is local-only. It writes to the single
  module-level `appStore` that `App.tsx` hands to `<JotaiProvider store>`, because
  `atom.init` cannot be mutated post-mount and a `<Provider>` without a `store` prop creates
  a private store that `getDefaultStore()` writes never reach. `sparkle.ui` also caches
  `themeId` as a pre-mount first-paint hint only; the fetched value always wins, so presets
  still follow the account across devices. The **open entry is not UI state**: it is derived
  from the URL (`<stream>/e/:id`) by `parseRoute`, so there is no selected-entry atom; the
  stream `filter`/`sort` are URL query params, not atoms.
- No cross-contamination: no server payloads inside atoms, no fetches outside
  react-query. The API client retries a 401 once after token renewal through the auth API.

## API client

`src/lib/api.ts`: thin typed fetch wrapper over `/api/v1/*` attaching the Cognito access
token, refreshing through `/api/auth/refresh` on 401 once then failing loudly. Response types
generated by hand in `src/lib/types.ts` mirroring the service DTOs (shared shape docs live
with `packages/core`; codegen is overkill at this size but noted as an option).

## Auth flow details

- The sign-in screen posts the username and password to `/api/auth/sign-in`. Cognito
  authenticates the credentials; an admin-created user's first sign-in may require a
  permanent password through `/api/auth/complete-new-password`.
- The API returns the access token to the SPA and sets the seven-day refresh token in a
  Secure, HttpOnly, SameSite=Strict cookie scoped to `/api/auth`. The SPA keeps the access
  token in memory and never reads or stores the refresh token.
- Token renewal is **on-demand**. A page reload renews through `/api/auth/refresh`; the API
  client also renews once after a 401, then retries the original request.
- A rejected or expired refresh cookie sends the user to sign-in. A temporary network or
  provider failure leaves the session state intact and gives the user a retry action.
- Password recovery uses `/api/auth/forgot-password` and `/api/auth/confirm-reset`. The
  request response is generic whether Cognito finds a matching account or not.
- Logout calls `/api/auth/sign-out`, which revokes the refresh token and clears the cookie.
  Access and ID tokens remain one hour; after the seven-day refresh window, users sign in
  again.

## Build & deploy outputs

- `pnpm build:web` → static bundle in `apps/web/dist`; CI syncs to S3 and invalidates
- The active theme is chosen via the `themeIdAtom` and passed to
  `MantineProvider theme={THEMES[themeId]}`. `apps/web/src/themes.ts` defines a
  `ThemeDef` (id, label, 10-shade `accent` ramp) per preset — `blue`, `scarlet`,
  `steel`, `magenta`, `purple`, `persimmon` — and each builds a full Mantine theme
  that swaps only the `accent` palette, so every `--mantine-color-accent-*` usage
  adapts automatically in both light/dark. The theme sets
  `primaryShade: { light: 6, dark: 4 }`: shade 6 is emphasis on white, shade 4 clears
  4.5:1 on the dark page (`#17171b`) for every preset. Because Mantine's `-filled`
  variable follows the scheme shade, the `CSSVariablesResolver` overrides
  `--mantine-color-accent-filled` / `-filled-hover` in dark with shades 6/7 so filled
  buttons stay deep with white text. The resolver also emits scheme-dependent accent
  tokens consumed by hand-written CSS: `--sparkle-accent-tint-strong` (selected
  surfaces: `accent-1` light / `accent-5` at 22% over the page in dark),
  `--sparkle-accent-tint` (hover: `accent-0` light / 14% in dark), and
  `--sparkle-accent-strong` (emphasis: `accent-7` light / `accent-4` dark). Numeric
  floors (emphasis ≥ 4.5:1, fill ≥ 3:1, selected tint ≥ 1.2:1) are guarded by
  `apps/web/test/themes.test.ts`. Settings previews each preset with the emphasis
  shade of the resolved scheme (`presetEmphasisColor`). `isThemeId` validates stored
  preset ids against the `THEME_DEFS` catalog itself (never a hand-written list, which
  dropped a preset in practice) and unrecognized values fall back to `blue`. Future
  style settings (e.g. fonts) extend `ThemeDef`
  and are merged in `buildTheme`, so consumers never change shape.
- `index.html` sets `<meta name="theme-color">`, viewport, and preloads the app shell
  CloudFront (`/index.html` + hashed assets pattern).
- `index.html` sets `<meta name="theme-color">`, viewport, and preloads the app shell
  font subset. Browser icons and home-screen metadata live in `public/`: the exact
  marketing-site `apps/site/public/favicon.svg`, a 16/32/48px ICO fallback, an opaque
  180px Apple touch icon, and 192/512px PNG app icons. `site.webmanifest` names the app,
  starts at `/`, and requests standalone display. Its separate 512px maskable icon
  scales the original artwork to 80% over the source's `#111114` background to keep
  the mark inside the safe circle. Raster assets are rendered from the source SVG;
  update these together when the brand changes. The service-worker/offline shell
  remains deferred to Phase 6.

The stream shell supports device-local List and Cards presentations through
`streamPresentationAtom` and the header selector. The two renderers share stream
queries, cursor pagination, and authorized article images.

## Saved images and mixed Saved timeline (2026-10-10)

Saved (`/starred`) uses `/api/v1/saved` rather than the article-only starred listing.
Its discriminated rows are `{kind: article, id, savedAtMs, entry}` and
`{kind: image, id, savedAtMs, item}`. Ordering, date groups, and row times use save
time. Article publish time remains intact in the reader. Images show lazy thumbnails
from private stored originals with proportional `object-fit: contain`; thumbnails
are display sizing, not generated derivatives. URL read-later articles do not enter
Saved merely by being in the queue.

`/starred/images/:id` opens an independently fetched image preview with provenance,
external source link, available internal article link, and independent removal.
Browser routes own selection and retain `?sort=asc`; the Saved list stays mounted
when its article/image reader opens to preserve scroll. Image previews do not apply
article read state or article shortcuts. Article j/k navigation skips image rows.
Saved always uses the mixed list and hides the presentation selector. Its old story
routes retain sort when redirected to Saved.

Reader content images have app-owned controls outside publisher links. Desktop
hover/focus reveals the button; touch/coarse-pointer controls remain visible. Native
buttons support keyboard activation. Pending, saved, and retry states leave article
read/star/read-later state independent. Enhancement is rebuilt for content changes
and cleaned up on unmount, preserving captions and source links.

React Query owns `['saved', {sort}]`, `['saved-image', id]`, and
`['source-images', kind, id]`; image mutations invalidate source/library data, and
article mutations invalidate the mixed library. Active library/detail queries refresh
signed image URLs before expiry. No saved payload is held in jotai.

Web-only API: `POST /saved-images` takes `{source: {kind: entry|read-later, id},
imageUrl}`; `GET /saved-images?sourceKind=&sourceId=` supplies reader state;
`GET /saved-images/:id` supplies preview; `DELETE /saved-images/:id` removes a save.
`GET /saved?sort=asc|desc&limit=&cursor=` supplies mixed pages (max 200). Image
responses carry source snapshots, availability, save time, original image URL, and
media dimensions/alt. Create/detail/library include signed `image.url` and
`image.urlExpiresAtMs`; reader state does not need signed URLs. Missing or foreign
image IDs return 404, including repeat deletion.

### List presentation

List is the date-grouped virtual list with optional stored article thumbnails on the
right. Headlines and metadata share the same left inset on every row, including rows
without images or with failed images. Text-only rows recover the image column's width;
favicons remain small source marks. List preserves the list's order, filters, read
typography, notes, pagination, and existing reader routes/keyboard actions.

Thumbnails start at 96×72 CSS pixels on desktop and 72×72 below the small-screen
breakpoint, crop with object-fit cover, and reserve dimensions while loading. Delivery
uses the existing authorized articleImage signed URLs and shared query expiry refresh.
These are original image bytes displayed at thumbnail size, not generated derivatives;
lazy loading and virtualization bound requests, but bandwidth remains a trade-off.
Failed URLs hide their image slot; a renewed URL can load again.

The header selector offers List and Cards. The existing local
`sparkle.ui.storyPresentation` key persists the device's choice. Legacy `feed` and
`swipe` values migrate to `list` without changing other preferences. List is the
fallback for missing or invalid values. Saved retains its dedicated mixed list.
On phones the brand uses its sparkles mark to leave room for both presentation choices
and the navigation, refresh, and theme controls. List rows are native buttons with
visible keyboard focus.
Thumbnails are decorative and activate the same article as the row.


### Cards presentation

Cards is a date-grouped grid.
`CardsView` uses three columns at the active theme's viewport md breakpoint and above,
two from sm to below md, and one below sm (currently 992/768 CSS pixels). Date headers
span the grid. Stories retain their stream order across columns, rows, and pagination.
Full titles and read-later notes wrap; metadata uses the same source/author components.

Each card is one native activation button with visible focus. A reserved 16:9 top media
area crops authorized stored article images with object-fit cover. Missing or failed
images show a quiet theme-colored surface and decorative newspaper icon; favicons stay
small source marks. No article-HTML image extraction or additional fallback fetch occurs.
Renewed signed URLs can retry failures through the existing shared query refresh.

Headers and rows of one/two/three cards are dynamically measured with the existing
virtualizer, with five rows of overscan. Focused rows remain mounted, and Tab/Shift+Tab
scrolls and focuses the next logical card even outside the mounted range. Width and
breakpoint changes trigger remeasurement; regrouping retains the visible article anchor.
Cards use original stored bytes, so lazy loading and bounded mounting limit requests but
larger visible images still carry the original-image bandwidth cost.

List and Cards keep their stream surface mounted but hidden and inert while the reader
is open, retaining nonzero layout dimensions so measurements remain valid;
Back/Escape restores scroll and Cards brings the last opened article into view when it
remains in loaded data. Stream/filter/sort changes reset that local scroll surface.
Queries, expiry refresh, pagination, and reader callbacks remain shared in `StreamInner`;
Jotai stores only the device-local presentation, never entries. Scrolling or switching
modes does not mark entries read. Saved retains its dedicated mixed library.

## Full article content

Only `ReaderPane` invokes automatic extraction on an eligible feed article open.
`fullContent.automaticFetchEligible` restricts this to original feed bodies shorter
than the core 500-character readable-text constant. At or above that threshold,
the reader hides the tabs and all fetch/retry actions and shows the original feed
body, including when an older extracted copy exists.
The manual retry/control uses the same mutation and owned entry ID, including the
underlying `entryId` for feed-backed Read Later. List and Cards rendering and
prefetching do not initiate extraction. Off-feed URL items are excluded.

React Query owns `['article-content', entryId]` body/status data and mutations.
Pending claims poll entry detail every two seconds until completion, navigation,
or lease expiry. Content patches update entry, mixed Saved, and Read Later caches
without replacing optimistic read/star flags. Late mutation results target their
original entry, never the active reader. Original/full selection is local UI state;
image lazy-loading and save controls rebuild when the same entry's HTML changes.
Mantine outline tabs labeled Fetched article and Original select the body.
The fetched panel shows an accessible loader immediately on an automatic fetch,
including before the mutation starts, so feed content never flashes first. Original
feed remains selectable during requests; longer bodies render directly without
tabs or fetching controls. Cached results switch without
refetching, and failure feedback keeps a retry control available. Limits/API fields are in
[11-full-content-fetch.md](11-full-content-fetch.md).

## Subscribe bookmarklet and feed discovery

Web subscription discovery uses `POST /api/v1/subscriptions/discover` with `{url}` and
receives `{feed: {feedUrl, siteUrl, title}}`. It checks the supplied page first, then
its origin root if no feed is found or fetching fails, preserving scheme, subdomain,
and port. Duplicate roots/candidates are skipped. A single 20-second deadline covers
both stages, with ten seconds maximum for each request including body reads.
Discovery has no feed/subscription or ingestion side effects; final creation posts
the resolved feed URL to the existing subscriptions endpoint. Native-client discovery
is unchanged.

Settings offers separate draggable **Read later** and **Subscribe** bookmarklets,
each with copyable code. Drag Subscribe to the bookmarks bar and activate it on a
blog page: `/subscribe?url=&title=&popup=1` opens in a small window without reader
chrome. Discovery runs before “Subscribe to <name>?”; the selected feed URL is shown,
with optional custom title and folder fields and Cancel/Subscribe buttons. The heading
uses feed title, then page title, then feed URL. Cancel writes nothing; success and
already-subscribed states remain visible with Close. Failed creation retains choices.
React Query owns discovery (`['feed-discovery', sourceUrl]`), folders, and subscription
mutations; local state holds only form fields and display state. Named-window reuse
resets form state and cannot display stale discovery results from another source.

The existing Subscribe dialog performs discovery then creation on its single submit.
Both surfaces offer **Use RSSFinder.com** on discovery/creation failure, linking to
`https://rssfinder.app/?q=<encoded original URL>` in another tab. The label matches the
user's preferred tool name; the actual destination is rssfinder.app. Sparkle contacts
that service only when the user follows the link. Invalid-input, authentication, and
duplicate states do not offer it. Editing the manual URL clears its error/link.

A signed-out `/subscribe` visit carries an encoded internal `returnTo` through Login
and any permanent-password challenge, returning to discovery and explicit confirmation.
Only the exact internal `/subscribe` path is accepted; untrusted destinations fall back
to `/`. Ordinary sign-in retains its landing behavior. Subscription and Login parameters
use raw browser search strings so nested URLs survive decoding intact.


## Feed fetching preferences and short-body links

Edit feed offers **Fetch full articles**, a server-backed per-subscription toggle,
with helper text explaining that disabling it shows original feed content. Save
updates title and preference together; pending saves disable the toggle, and errors
keep the draft open with feedback. Feed menu and editor portal clicks stop
propagation so they cannot activate the surrounding sidebar navigation link.
The subscription DTO uses `fetchFullArticles`.

React Query owns the preference and content state. Successful preference edits update
the subscription cache, suppress fetching/display in matching entry/detail/Saved
caches immediately, and invalidate entry, Saved, and separate article-content queries.
Feed-backed Read Later aliases use their underlying entry ID. The reader applies the
current subscription setting as a guard against late fetch results; server projections
provide the initial policy when a deep link opens before subscription hydration.
Re-enabling refreshes content status before another automatic attempt. Unrelated
optimistic read/star flags are preserved. Other devices pick up changes on normal
query refresh/reload; no real-time subscription is used.

ReaderPane places a centered filled Mantine button/link, **View full post…**, between
rendered content/image controls and previous/next navigation. It uses the active
primary/accent theme in light/dark mode. Visibility measures the selected displayed
body, independently of fetch eligibility: fewer than 500 normalized readable Unicode
characters, including empty content. Switching between a long fetched body and its
short Original tab updates visibility. Loading alone hides it. Missing/invalid,
non-HTTP(S), and credential-bearing destinations hide the button. Valid stored article
URLs open with `_blank` and `noopener noreferrer`; the corner icon remains.
Browser/server classification parity fixtures pin normalization and the threshold.


Reader navigation history correlation IDs use `crypto.getRandomValues`, which is
available on HTTP LAN development origins. They do not require the secure-context-only
`crypto.randomUUID` API; otherwise article clicks throw before route navigation when
opening the dev server from another device over plain HTTP.
