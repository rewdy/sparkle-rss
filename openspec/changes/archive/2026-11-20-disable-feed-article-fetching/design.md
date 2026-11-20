# Design

## Context

See proposal.md for motivation. `subscriptions` is already keyed by user/feed and edited by `createSubscriptionsService.edit` through `PATCH /api/v1/subscriptions/:feedId`. `FeedMenu` in ManageMenus.tsx has an Edit feed modal with title and a read-only feed URL.

`article/content-policy.ts` classifies original HTML below 500 normalized Unicode characters using linkedom. `services/article-content.ts` projects extracted content independently of that classification and checks the length policy only for automatic admission. Its `decorate` method feeds entry list/detail, Saved, and feed-backed Read Later. Google Reader bypasses this decoration.

`useArticleContent` maintains a separate article-content cache, seeds it from entry projections, polls pending requests, and patches list/detail/Saved caches. ReaderPane uses `automaticFetchEligible` to hide controls and force original content for long articles. Subscription edits currently invalidate subscription/folder/count queries only, so adding a toggle alone would leave stale article projections.

## Goals / Non-Goals

**Goals:** Apply one owned subscription policy at projection and fetch admission; preserve extracted data; reconcile open-reader state; reuse the established short-text definition for the publisher button.

**Non-Goals:** Extraction-quality improvements, publisher-wide overrides, scheduled fetching, cancelling already-admitted network requests, per-article settings, changes to ingestion/native APIs, or OPML serialization of this web preference.

## Decisions

### Store the preference on the subscription

Add nullable boolean `fetch_full_articles` with a separately assigned default of true; normalize NULL to true in reads and policy checks. Use `fetchFullArticles` in the subscription DTO, web types, API client, edit service, and optional boolean PATCH field. Write explicit true on new subscriptions where practical. Existing subscriptions need no backfill. Omitted fields, GReader edits, and duplicate OPML subscriptions preserve the setting. Unsubscribe removes it with the subscription; a new subscription defaults to true.

This matches the confirmed per-user, per-feed scope. A global `feeds` column would couple different users; user-settings JSON would duplicate subscription ownership and cleanup rules.

### Enforce at projection and admission

Resolve the owned subscription alongside each entry; batch this for decoration rather than adding a query per item. Effective `fullContent.automaticFetchEligible` becomes preference-enabled AND existing short-original classification. Add `fullContent.fetchEnabled` to distinguish opt-out from length classification and support reliable cache reconciliation. For disabled subscriptions, project original `contentHtml`, preserve `originalContentHtml`, and retain stored extraction/status metadata without exposing fetched HTML as the selected body. Keep the existing treatment of enabled long bodies and manual API requests unchanged.

Check opt-out for both triggers in the admission transaction after entry ownership and before admission-state writes, cached/pending shortcuts, or budget allocation. Return the existing 200 envelope with the disabled original projection. A missing subscription fails closed for fetching. Existing missing/foreign entry behavior remains 404.

An attempt admitted before a toggle can finish and retain its result. Completion responses must reproject using the current preference; disabling does not need to revoke remote I/O. Requests admitted after the saved change must observe the preference. Existing transaction retry/lease rules remain intact. Keeping extracted data makes re-enabling cheap and avoids destructive bulk updates.

### Reconcile all reader caches and guard late results

Add the toggle and helper text to Edit feed; submit it with title, show pending/error feedback, and close only after success. Treat preferences as React Query server state. After saving, update the subscription cache from the returned DTO, update matching cached eligibility/display metadata to suppress disabled fetching immediately, and invalidate entry lists, details, Saved, and separate `article-content` queries for refresh, including feed-backed Read Later aliases by entry ID.

Use the most recent saved subscription value as a reader policy guard, so an old in-flight content response cannot restore fetched display or trigger another request. Do not assume subscription data has loaded on a deep link: the server projection is sufficient for initial policy. Re-enabling rehydrates the authoritative projection before deciding whether a fetch is needed, preserving cached success, cooldowns, and budget. Do not clear unrelated article flags or overwrite optimistic read/star updates. A preference change on another device is picked up through normal query refresh/reload; real-time push is out of scope.

UI-only enforcement was rejected because stale clients and direct API calls could bypass it. Invalidating only subscription queries was rejected because the hook's disabled query and seed data can outlive the subscription edit.

### Classify the displayed body for the publisher button

Proposed UI detail: reuse fewer than 500 readable characters, including empty bodies, rather than introduce a new word threshold. Evaluate the selected displayed HTML, so a long fetched article hides the button while its short Original tab can show it. An error fallback uses its displayed original body. Off-feed saved URLs can show the same link when their displayed body is short, without changing extraction.

Add a small browser readable-text helper using detached HTML parsing, the existing policy's excluded nodes/block separators/entity decoding/whitespace normalization, and Unicode counting. Share boundary/normalization fixtures with the core policy tests to prevent drift; avoid importing the core barrel into the SPA because it exposes server modules. Keep the 500 limit aligned by a focused parity check; no new DOM dependency is needed in the web bundle. Body classification does not depend on `automaticFetchEligible`, which also includes preference and original-body eligibility.

Render one Mantine `Button component="a"`, filled, using the active primary/accent theme, in a centered Group after rendered content and image controls and before previous/next navigation. Use exact copy “View full post…”, the stored article URL, `_blank`, and `noopener noreferrer`. Validate HTTP(S), no credentials, and valid URL syntax. Keep the corner icon. Hide the button while only the fetched loading state is visible; no custom color CSS or automatic focus movement.

## Risks / Trade-offs

- [Stale projection or late completion defeats opt-out] → current subscription guard, disabled server projections, completion reprojection, and deferred-response regression tests.
- [Additional reads slow list hydration] → batch subscription policy lookup or a user-scoped join within existing decoration.
- [Browser/server HTML counting drift] → matching normalization fixtures covering block boundaries, entities, excluded nodes, Unicode, and 499/500/501 characters.
- [Short complete posts get a redundant link] → intentional simple heuristic; the action is harmless and no truncation inference is claimed.
- [Already-admitted extraction finishes after opt-out] → retain result but never select it while disabled; no promise of network cancellation.
- [DSQL rejects inline column constraints] → nullable ADD COLUMN, separate SET DEFAULT, NULL-as-enabled behavior, and migration-runner compatibility review.

## Migration Plan

1. Add a forward-only migration and Drizzle metadata using the documented DSQL migration authoring/recovery checklist. Do not modify prior migrations.
2. Deploy migration before API/Lambda code through the existing pipeline, then publish the web bundle. No Terraform resource additions or historical-entry backfill.
3. Verify enabled legacy subscriptions, saved opt-out, direct manual/automatic requests, cached copies, re-enable, and short-body links.
4. Roll back application artifacts if necessary while retaining the additive schema. An older release will not honor opt-outs; restoring that behavior is a rollback limitation to evaluate before using an older release.
