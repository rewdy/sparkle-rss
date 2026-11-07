# Design

## Context

See proposal.md for motivation. `packages/core/src/feed/discover.ts` accepts direct feeds or HTML alternate links, trying up to three candidates and returning the first valid feed. It throws 400 for bad URLs, 502 for fetch failures, and 422 for no feed. It is currently invoked inside `createSubscriptionsService.subscribe`, which creates rows and queues first ingestion. There is no discovery-only HTTP endpoint.

`apps/web/src/lib/bookmarklet.ts`, `BookmarkletLink.tsx`, Settings, and Shell already support a deployment-specific Read later popup. React 19 requires writing the bookmarklet href to the anchor after mount. `SubscribeModal.tsx` already provides folder/title fields but reports only a generic failure. `guard.tsx` redirects anonymous users to `/login`, and Login navigates to `/` after authentication, losing bookmarklet input.

The existing `user-auth` spec does not prescribe a return route, so the added requirement extends it without replacing existing requirements. There is no existing feed-subscription capability spec.

## Goals / Non-Goals

**Goals:** Keep publisher-side execution small; separate preview from persistence; reuse current discovery and subscription behavior; preserve popup context across authentication; keep server data in React Query and styling in Mantine theme components.

**Non-Goals:** Multiple-feed selection, recursive crawling, parent-path searches, feed-path guessing, RSSFinder API integration, automatic subscription, Google Reader changes, or new persistent resources. Origin-root fallback is the only new discovery heuristic. The roadmap's shared outbound-fetch guard is separate work; this change does not claim to complete it.

## Decisions

### 1. Add a discovery-only first-party endpoint

Add `POST /api/v1/subscriptions/discover` accepting `{url: string}` and returning `{feed: {feedUrl: string, siteUrl: string, title: string | null}}` with status 200. Require existing web authentication and resolve the current user before invoking discovery. Validate HTTP(S) on both input and returned feed URLs. Expose discovery through a thin service method with injectable transport for deterministic tests. Do not create feed/subscription rows or invoke the refresh hook. Retain the existing mapped error statuses.

Final confirmation posts the resolved `feedUrl` to the existing `POST /subscriptions` with `title` and `folderId`. This ensures the confirmed candidate is used instead of rediscovering the original HTML page, while the normal service continues to validate an unknown feed and enforce folder ownership/409 behavior. Do not use `subscribeDirect`, whose network-validation bypass is intended for OPML. Fetching an unknown feed again on confirmation is accepted; no preview token or server preview store is needed.

Alternative: subscribe provisionally then undo on Cancel. Rejected because preview must have no persistence or ingestion side effects. A separate discovery service implementation would duplicate the existing algorithm.

### 1a. Try the origin root only after page discovery fails

Implement a web-specific discovery wrapper around the existing single-page algorithm. First try the supplied URL, including its normal alternate-feed candidates. On no-feed or upstream fetch failure (422/502), try `new URL(inputUrl).origin + '/'` once. Preserve the original scheme, full hostname/subdomain, and port; remove path, query, fragment, and credentials from the fallback. Do not derive a registrable domain or switch protocols. Invalid input or a rejected URL must not trigger fallback. A successful page result always wins.

Skip the fallback when that root has already been fetched, including when the initial page redirected to it. Track visited page/candidate URLs across both stages to avoid duplicate requests. Redirects retain existing behavior, but do not derive additional fallback roots from redirect destinations. Each stage retains the current three-candidate limit. Use one 20-second deadline across both stages, including body reads, with each individual request capped at the smaller of ten seconds and the remaining budget. Stop on deadline rather than restarting it for the root; deadline expiry maps to 502. If neither stage succeeds, return 422 if any page was inspected successfully but had no valid feed, otherwise 502 for upstream failure. Preserve the original input for RSSFinder regardless of which stage failed.

Use this wrapper only through the new first-party discovery endpoint. The existing SubscribeModal will call that endpoint on submission, then post the returned feed URL and its existing title/folder choices to the creation endpoint. It remains a single-submit manual flow with no extra confirmation stage. The popup uses the same endpoint before its explicit confirmation. Final creation continues to validate only the resolved feed URL with the existing service; it must not silently substitute a homepage feed if the confirmed feed disappears. This keeps Google Reader callers and shared discovery defaults unchanged.

Alternative: change `discoverFeed` globally. Rejected because Google Reader subscription semantics would also change. Trying the root first could select a broad site feed instead of a section-specific feed advertised by the article.

### 2. Use a separate bookmarklet and route

Add a Subscribe builder alongside the existing builder, targeting `/subscribe?url=...&title=...&popup=1` in a named `sparkle-subscribe` window, approximately 530×560. Capture only `location.href` and `document.title` using URLSearchParams; gather no article text, feed markup, or credentials. Provide a Subscribe settings card with drag and copy affordances. Generalize the link presentation only as necessary, keeping the existing Read later export/default behavior compatible.

Lazy-load a dedicated subscription confirmation component via Shell before stream fallback handling. It renders a compact Mantine Paper/Stack surface without reader chrome; direct `/subscribe` access remains usable as a standalone surface. Use `popup=1` rather than depending on `window.opener`. Cancel attempts to close a script-opened window and otherwise renders a cancelled state. Success stays visible with Close instead of relying on a notification in the opener.

Alternative: native `window.confirm` on the publisher page. Rejected because folder/title fields, inline errors, and an RSSFinder link require an app-owned surface.

### 3. Model discovery and confirmation separately

Use React Query for discovery keyed by source URL, with automatic retries disabled and explicit Retry on error. Load folders with the existing user-scoped query. Keep only form values and local dismissal state in component state; never store discovery payloads in jotai. Remount/reset the form when source parameters change so a reused named popup cannot display or submit a previous result. Keep submission disabled until discovery and folder loading succeed, and while pending. Folder loading failures show a retry without presenting them as feed-discovery failures.

Heading uses nonempty discovered title, then captured page title, then feed URL. Render all publisher-derived strings as text. Show the resolved feed URL as secondary confirmation context. Leave custom title blank by default; an empty value sends no override. Folder defaults to none. Reuse `useSubscribe` for creation and query invalidation. Handle 409 as Already subscribed with Close; retain choices and permit retry after other write errors. No cross-window messaging or live synchronization of another tab's cache is required.

Alternative: extend the existing URL-entry modal into a multi-purpose state machine. A separate popup component keeps the current manual Subscribe flow intact while reusing mutation and field conventions.

### 4. Share an RSSFinder fallback helper

Build links from the fixed `https://rssfinder.app/` origin with `searchParams.set('q', originalAttemptedUrl)`. Preserve the original source rather than the resolved feed URL. Display the exact requested label “Use RSSFinder.com” even though the destination is rssfinder.app. Use an external anchor with `target="_blank"`, `rel="noopener noreferrer"`, and no automatic request/prefetch. Optionally explain that RSSFinder can help locate feeds Sparkle missed.

Use the helper in popup discovery/write errors and SubscribeModal's submission error area after web discovery has exhausted page/root attempts. Exclude invalid URL, auth, and 409 states. Snapshot the attempted manual URL so the fallback refers to the failure being shown; clear both when the input changes. Existing manual subscription does not gain a separate confirmation stage.

Alternative: redirect automatically to RSSFinder. Rejected because the user requested a link and should retain their form and retry option.

### 5. Preserve a narrowly validated return destination

For `/subscribe` authentication redirects, carry the full internal path and search in an encoded `returnTo` query parameter. Validate the destination before navigation: accept only a relative path beginning with a single `/`, resolving to the current origin and the exact `/subscribe` pathname; reject malformed values, backslash variants, external URLs, protocol-relative paths, and other destinations. Keep this rule in a small shared helper used by guard/Login. Without a valid destination, use `/`.

Login must retain `returnTo` through permanent-password setup and password-reset screens and navigate there only after successful authentication. No source URL is itself used as a navigation destination. No API or Cognito auth behavior changes.

Alternative: require sign-in and a second bookmarklet click. Rejected because it loses the captured source and breaks the one-action browsing flow.

## Risks / Trade-offs

- Publisher CSP or popup blocking can prevent bookmarklet execution → retain copy/install guidance and verify a normal browser flow; no guarantee to bypass publisher policies.
- Existing discovery misses some feeds and lacks the shared fetch guard/byte cap tracked in the roadmap → reuse it transparently and provide RSSFinder; leave hardening explicitly tracked separately.
- Root discovery can select a broader feed and adds latency → prefer the article's feed, cap the combined attempt, and show the selected name/feed URL in bookmarklet confirmation.
- Source changes between preview and confirmation or a remote feed disappears → creation still uses the selected feed URL and reports failure with retry; no cached metadata is treated as authority to write directly.
- RSSFinder receives the source URL on user activation → no automatic contact, fixed destination, external link isolation, and normal URL encoding.
- Session return changes can affect ordinary login → restrict the supported destination and test both popup and existing login behavior.

## Migration Plan

No database migration or Terraform changes. Ship the additive API endpoint and web assets through the normal pipeline. Existing Read later bookmarklets remain valid; users install Subscribe separately. Rollback restores earlier API/web artifacts without data conversion; subscriptions created during the release remain normal subscriptions. Update docs 01/05, the roadmap handoff, and decisions alongside implementation. Run targeted API/core/web checks, lint, typecheck, both builds, and browser acceptance before considering implementation complete.
