# 02 — Google Reader API Compatibility Specification

This is the **contract** with NetNewsWire and every other Google Reader-compatible client.
It is modeled on FreshRSS's implementation (`p/api/greader.php`, `edge` branch), which is
the de-facto reference standard. Any change to our greader surface requires updating this
doc *and* the conformance test suite in the same change.

Sources of truth:
- FreshRSS implementation: <https://github.com/FreshRSS/FreshRSS/blob/edge/p/api/greader.php>
- FreshRSS docs: <https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html>
- Original GR docs (archived): [undoc.in](https://web.archive.org/web/20130710044440/http://undoc.in/api.html),
  [Martin Doms](https://web.archive.org/web/20210126115837/https://blog.martindoms.com/2009/10/16/using-the-google-reader-api-part-2/),
  [mihaip's wiki](https://github.com/mihaip/google-reader-api/wikis)

## Base URL & path handling

Canonical base: `https://<host>/api/greader.php`

FreshRSS tolerates sloppy clients by stripping an optional leading `/api` and/or
`greader.php` from the path before routing. We replicate this leniency: normalize the
incoming API Gateway path, strip `/api` then `/greader.php`, then route.

- `GET /api/greader.php` with no further path/query → body `OK` (plain text).
- `GET /api/greader.php/check/compatibility` → plain-text capability info (clients use it
  as a health check; mirror FreshRSS output shape).

CORS headers are set on all responses (`Access-Control-Allow-Origin: *`,
`Allow-Headers: Authorization`, `Allow-Methods: GET, POST`, `Max-Age: 600`) — some web-based
clients call this API cross-origin. `OPTIONS` short-circuits with no content.

## Authentication model

### Human → API token (our extension point)

Users create an **API token** in the web settings UI while holding a Cognito session:
`POST /api/v1/me/api-tokens` → returns the plaintext token exactly once. Server stores
`SHA-256(token)` + label + timestamps. Tokens are revocable. This replaces FreshRSS's
"API password" and keeps Cognito credentials entirely out of native clients.

### ClientLogin

```
POST /api/greader.php/accounts/ClientLogin
Content-Type: application/x-www-form-urlencoded
Email=<username>&Passwd=<api-token>
```

Response `200 OK`, `text/plain`:

```
SID=<user>/<auth>\n
LSID=null\n
Auth=<user>/<auth>\n
```

- `<username>` = the Sparkle username (not email; FreshRSS semantics). We also accept the
  Cognito username value stored on the user row.
- `<auth>` = `<userId>/` + `base64url(HMAC-SHA256(serverKey, userId || ":" || tokenHash))`.
  Stateless: any later request re-derives it from the stored token hash — one DB read per
  request (cacheable in Lambda memory for the execution-environment lifetime).
- Failure → `401 Unauthorized`. Malformed username → `400`.
- Accept GET params as fallback but log a warning (FreshRSS parity; Vienna uses POST).

### Subsequent requests

Header: `Authorization: GoogleLogin auth=<user>/<auth>`
(Parsers must accept both `GoogleLogin auth=` and the PHP-mangled `GoogleLogin_auth=`.)

Missing/invalid → `401 Unauthorized`.

### Write token

Mutating endpoints require a write token obtained from:

```
GET /api/greader.php/reader/api/0/token
→ 57-character string, trailing 'Z' padding (FreshRSS shape)
```

Sent as form param `T` on: `edit-tag`, `rename-tag`, `disable-tag`,
`mark-all-as-read`. (`subscription/edit` does **not** check `T` — FreshRSS behavior.)
Validation: deterministic per-user value, compared with constant-time equality.
Quirk tolerance: empty string or literal `x` accepted (FeedMe / Reeder send these).
Invalid token → `401` with header `X-Reader-Google-Bad-Token: true`.

## Identifiers

### Stream IDs

| Stream ID | Meaning |
| --- | --- |
| `feed/<numeric-id>` | A feed (numeric = our `feeds.id`). Also accept URL-encoded feed URL in `stream/contents/feed/<url>` paths, resolving URL → id. |
| `user/-/state/com.google/reading-list` | All subscriptions ("All items") |
| `user/-/state/com.google/starred` | Starred items |
| `user/-/state/com.google/read` | Only used as an `xt`/`it` filter, never a stream target |
| `user/-/label/<name>` | Folder/category (v1). Labels (article tags) deferred — not emitted in v1. |

The `-` is a placeholder for "current user"; treat any user segment as `-`.

### Item IDs

Two encodings of the same signed 64-bit entry id:

| Form | Shape | Used by |
| --- | --- | --- |
| Long form | `tag:google.com,2005:reader/item/<16-char zero-padded lowercase hex>` | `items[].id` in stream contents responses |
| Short form | decimal string of the same integer | `itemRefs[].id` in `stream/items/ids`; `i=` params in `edit-tag` and `stream/items/contents` |

Parsers accepting `i=` must handle **both** forms.

## Endpoints

All under `/api/greader.php`. JSON responses are pretty-printed like FreshRSS
(`JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE`) — harmless and
helps debugging against real clients.

Unless noted, mutations return plain-text `OK`.

### Read-only

#### `GET /accounts/ClientLogin` *(see above)*

#### `GET /reader/api/0/user-info`
```json
{ "userId": "<user>", "userName": "<user>", "userProfileId": "<user>", "userEmail": "" }
```

#### `GET /reader/api/0/tag/list?output=json`
```json
{ "tags": [
    { "id": "user/-/state/com.google/starred" },
    { "id": "user/-/state/com.google/reading-list" },
    { "id": "user/-/label/Tech",     "type": "folder" }
]}
```
Non-json `output` → `501` (FreshRSS behavior). Starred + reading-list states always first;
folders after, sorted by name.

#### `GET /reader/api/0/subscription/list?output=json`
```json
{ "subscriptions": [
  { "id": "feed/17",
    "title": "Daring Fireball",
    "categories": [ { "id": "user/-/label/Tech", "label": "Tech" } ],
    "url": "https://daringfireball.net/feeds/main",
    "htmlUrl": "https://daringfireball.net/",
    "iconUrl": "",
    "sortid": "B52CJ4",
    "firstitemmsec": "1690000000000",
    "count": 1234 }
]}
```
`count` = total cached entries for that subscription. `sortid` may be empty in v1.

#### `GET /reader/api/0/unread-count?output=json`
```json
{ "max": 1000,
  "maxperiod": 43200,
  "unreadcounts": [
    { "id": "feed/17", "count": 12, "newestItemTimestampUsec": "1723459200000000" },
    { "id": "user/-/label/Tech", "count": 87,  "newestItemTimestampUsec": "…" },
    { "id": "user/-/state/com.google/reading-list", "count": 340, "newestItemTimestampUsec": "…" }
  ]}
```
One entry per feed, one per folder (sum of member feeds), plus reading-list total.
`newestItemTimestampUsec` is a **string** of microseconds. `count` capped at `max`.

#### `GET /reader/api/0/stream/contents/{stream}` (also `?s=<stream>` form)
Stream path forms supported: bare (`reading-list` implied), `feed/<id-or-url>`,
`user/-/state/com.google/{reading-list,starred}`, `user/-/label/<name>`.

Parameters:
| Param | Meaning |
| --- | --- |
| `n` | page size (default 20) |
| `r` | order: `d`/`n` descending, `o` ascending (by published time) |
| `ot` | start time: only entries crawled/fetched after this Unix sec |
| `nt` | stop time: only entries before this Unix sec |
| `xt` | exclude target, e.g. `user/-/state/com.google/read` |
| `it` | include-target filter (only meaningful paired with `xt=starred` etc.; implement read-state filter) |
| `c` | continuation token from previous response (opaque to client) |

Response:
```json
{ "direction": "ltr",
  "id": "user/-/state/com.google/reading-list",
  "title": "Reading List",
  "updated": 1723459200,
  "self": [ { "href": "https://…/stream/contents/reading-list?n=20" } ],
  "continuation": "opaque-token-if-more",
  "items": [ { … } ] }
```

Item object:
```json
{
  "id": "tag:google.com,2005:reader/item/0000000000012a5f",
  "crawlTimeMsec": "1723460000123",
  "timestampUsec": "1690000000000000",
  "published": 1690000000,
  "updated": 1690000000,
  "canonical": [ { "href": "https://example.com/post-1" } ],
  "alternate": [ { "href": "https://example.com/post-1", "type": "text/html" } ],
  "summary": { "direction": "ltr", "content": "<p>sanitized HTML…</p>" },
  "author": "Author Name",
  "categories": [
    "user/-/state/com.google/reading-list",
    "user/-/state/com.google/read",
    "user/-/state/com.google/starred",
    "user/-/label/Tech",
    "feed/17"
  ],
  "origin": {
    "streamId": "feed/17",
    "title": "Feed Title",
    "htmlUrl": "https://example.com/"
  },
  "enclosure": [ { "href": "https://example.com/ep.mp3", "type": "audio/mpeg", "length": 12345678 } ]
}
```

Time-field conversions (**get these right**, they're classic sync bugs):
| Field | Unit | Source |
| --- | --- | --- |
| `published`, `updated`, `self`… timestamps in JSON | seconds int | feed-declared date |
| `crawlTimeMsec` | milliseconds **string** | when we fetched it |
| `timestampUsec` | microseconds **string** | feed-declared date ×1e6 |
| `mark-all-as-read` `ts` param | **nanoseconds** int | see below |
| `unread-count` `newestItemTimestampUsec` | microseconds string | newest unread |

Podcast note: NetNewsWire consumes `enclosure` for podcast feeds — emit it whenever the
source entry has enclosures.

#### `GET /reader/api/0/stream/items/ids?s=<stream>&output=json`
Same filter/sort/time/continuation params as above (`s=` required here). Response:
```json
{ "itemRefs": [
   { "id": "76383", "directStreamIds": [], "timestampUsec": "1690000000000000" } ],
  "continuation": "opaque-token-if-more"
}
```
This endpoint powers efficient incremental sync (clients ask for ids newer than their last
sync, excluding already-read via `xt=user/-/state/com.google/read`, then hydrate batches
via `stream/items/contents`).

#### `POST /reader/api/0/stream/items/contents`
Form params: `i=<itemId>` repeated (accepts both id forms), optional `r` order.
Returns the same `{ items: [...] }` envelope as `stream/contents`.

#### `GET /reader/api/0/subscription/export`
OPML 2.0 XML document of folders+feeds (`application/xml`, attachment filename
`sparkle-subscriptions.opml`). Structure mirrors FreshRSS export so round-tripping through
other tools works.

### Mutations

#### `POST /reader/api/0/subscription/edit`
Params: `ac` ∈ {`subscribe`,`unsubscribe`,`edit`} (required), `s=feed/<id>` (repeatable),
`t=<title>` (repeatable, rename), `a=user/-/label/<Folder>` (add to folder),
`r=user/-/label/<Folder>` (remove from folder).

- `subscribe`: `s` may be `feed/<url>` (URL-encoded) if the feed isn't known yet → run
  discovery (direct feed URL, else HTML autodiscovery via `<link rel="alternate">`), create
  global feed row + subscription. Optional `t` sets custom title, `a` initial folder.
- `unsubscribe`: delete subscription (+ its per-user entries/state rows).
- `edit`: apply title override and/or folder move (`a`/`r`; a feed lives in ≤1 folder,
  FreshRSS semantics).
- Multiple `s` values: process each; response `OK` if all succeeded.

#### `POST /reader/api/0/subscription/quickadd?quickadd=<url>`
Discover-and-subscribe from a site or feed URL. Response:
```json
{ "query": "<url>", "numResults": 1, "streamId": "feed/42" }
```
(`numResults: 0` on discovery failure.)

#### `POST /reader/api/0/edit-tag`
Params: `i=<itemId>` repeated; `a=<tag>` repeated to add; `r=<tag>` repeated to remove;
`T=<write token>`. Tags seen in practice:
`user/-/state/com.google/{read, starred, broadcast, like, tracking-kept-unread}` and
`user/-/label/<Label>`.

v1 handling: `read` fully implemented (sets/clears `read_at`); `starred` fully
implemented; `broadcast`/`like`/`tracking-kept-unread` accepted and ignored (FreshRSS
stores broadcast/like minimally too); labels deferred (return `OK`, no-op) until labels
ship. Setting `read` implicitly clears nothing else; marking unread clears `read_at`.

Response: `OK`.

#### `POST /reader/api/0/rename-tag`
`s=user/-/label/Old`, `dest=user/-/label/New`, `T=…`. Renames the folder; subscriptions
follow.

#### `POST /reader/api/0/disable-tag`
`s=user/-/label/X` repeated, `T=…`. Deletes the folder; contained feeds become uncategorized.

#### `POST /reader/api/0/mark-all-as-read`
Params: `s=<stream>` (feed/N, label, or reading-list), `ts=<nanoseconds>` (mark strictly
older than this instant; clients echo the timestamp of the newest item they consider read),
`T=…`.

Implemented as a single bounded `UPDATE` joining entries on the time predicate
(see data model) — the canonical payoff of choosing SQL. Response `OK`.

## NetNewsWire-specific notes

Per FreshRSS's own compatibility matrix, NetNewsWire (GReader transport): offline ✓,
favourites ✓, manage-feeds ✓, podcasts ✓, labels ✗. Its sync loop relies on:

1. `subscription/list` + `tag/list` to build the folder tree,
2. `unread-count` for badges,
3. `stream/items/ids` with `ot=<last successful sync>` + `xt=read` for incremental pulls,
4. `stream/items/contents` batched hydration,
5. `edit-tag` for read/star toggles (often batched, multiple `i=`),
6. `subscription/edit` for subscribe/unsubscribe/rename/folder-move,
7. `mark-all-as-read` with `ts`.

E2E acceptance checklist (run against a real NNW build before calling Phase 4 done):
- [ ] Add account (server URL `https://<host>/api/greader.php`, username, API token)
- [ ] Initial sync: folders + feeds appear with correct titles/icons
- [ ] Unread counts match web UI
- [ ] Read an article in NNW → shows read in web UI within a refresh
- [ ] Star in NNW → starred in web UI; unstar bidirectionally
- [ ] Mark-feed-as-read in NNW → counts drop server-side
- [ ] Subscribe to new feed in NNW (URL discovery) → appears server-side
- [ ] Unsubscribe in NNW → gone server-side
- [ ] Rename feed / move between folders in NNW → reflected server-side
- [ ] Add folder in NNW → created server-side
- [ ] Podcast episode plays (enclosure surfaced)
- [ ] Second device converges (no duplicate/unread resurrection loops)

## Implementation tolerance list (quirks we deliberately copy)

- Path prefixes `/api` and `/greader.php` stripped liberally.
- Bare root request returns `OK`.
- Empty/`x` write tokens accepted (FeedMe/Reeder).
- Both item-ID forms accepted everywhere IDs go in.
- `output` param other than `json` on json endpoints → `501 Not Implemented`, not `400`.
- `LSID=null` line in ClientLogin response (Vienna reads it).
- `Authorization` header parsing tolerant of PHP-style space→underscore mangling.
- Errors: `400 badRequest`, `401 unauthorized`, `500 internalServerError`,
  `501 notImplemented`, `503 serviceUnavailable` — plain bodies, matching FreshRSS status
  usage.
