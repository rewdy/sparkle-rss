# Tasks

## 1. Shared storage and extraction foundation

- [x] 1.1 Add nullable entry extraction/claim/failure/cooldown fields and independent user-settings admission history/version columns with forward-only DSQL-safe migrations; verify old rows remain unattempted, original HTML unchanged, and preference updates preserve admission state.
- [x] 1.2 Harden the article extractor using the saved-image connection validation transport, a total 10-second network deadline, MIME checks, strict 2 MiB input and 500,000-character output limits, and final-URL link/image normalization before sanitization. Test redirects, credentials, IPv4/mapped IPv6, rebinding, stalled DNS/body, oversized input/output, empty sanitized output, malformed pages, and Read Later link-only fallback.
- [x] 1.3 Implement the injectable core article-content service with cached success, token claims, 60-second lease recovery, conditional completion, separate cooldowns, and atomic 30/hour per-user admission. Integration-test concurrent same/different entries, repeated attempts on one entry, deletion during fetch, stale completions, expired leases, preference-write races, DSQL conflict retry boundaries, and user isolation.
- [x] 1.4 Update docs 01/03/11 with the implemented storage, admission, extraction limits, and two-stage architecture; verify claims against the schema and extractor tests and replace obsolete historical assumptions.

## 2. Web API and content projection

- [x] 2.1 Add authenticated POST `/api/v1/entries/:id/content` with manual/automatic trigger validation, 200/202/429/error contracts, safe codes, and retry-after. Extend web detail metadata for polling without GET side effects; contract-test foreign/missing IDs and absence of caller-supplied URL fetching.
- [x] 2.2 Add a shared web-only projection for detail, streams, Saved article hydration, and feed-backed Read Later, exposing original HTML and extraction metadata while preserving Google Reader's original mapper. Test old entries, alias identity, unchanged metadata/order/article state, and no feature fields on native responses.
- [x] 2.3 Extend saved-image source authorization to both retained bodies and correct URL bases; test saving relative images after redirects through entry and Read Later aliases, rejection of unrelated URLs, existing dedupe/provenance, source removal, and unchanged splash behavior.
- [x] 2.4 Document endpoint/error/DTO and image-authorization contracts in docs 03/05/08; verify examples against API contract fixtures and record unchanged Google Reader projection.

## 3. Milestone A — manual fetching

- [x] 3.1 Add typed API/query/mutation support and bounded pending-status polling; reconcile only content fields across entry/list/Saved/Read Later caches. Test navigation during requests, concurrent optimistic read/star changes, 202 recovery, 429 feedback, failures, and persisted success after reload.
- [x] 3.2 Add accessible Mantine outline Fetched article/Original tabs, immediate loading feedback without a feed-body flash, and error/retry controls to ReaderPane; use underlying entryId for feed-backed Read Later. Reapply image lazy loading on same-ID content changes. Test keyboard/touch, focus stability, image controls, missing URLs, and exclusion of off-feed URL items.
- [ ] 3.3 Verify manual milestone locally against migrated Postgres with fixture-backed extraction, concurrency, failure and image saving. Record milestone A in docs 06/decisions while explicitly leaving automatic completion unchecked.
- [ ] 3.4 Document manual controls, cache ownership, local verification, and original/full selection in docs 05/07; verify the documented workflow in the local reader.

## 4. Milestone B — automatic on open (required)

- [x] 4.1 Invoke the same content mutation when an eligible reading pane opens with original feed text below the named 500-character threshold (enforced by both web trigger and service, with all reader fetching controls hidden at or above the threshold), including deep links, keyboard navigation, Saved articles, and feed-backed Read Later. Reuse success/pending/cooldown state; test StrictMode/remounts, two tabs, reopen after cooldown, missing URLs, and no repeated retries in an already mounted pane.
- [ ] 4.2 Verify no extraction on list rendering, pagination, prefetch, presentation changes, or Swipe scrolling; opening the full reader from a story qualifies. Test late results never replace the currently open article and existing mark-on-open semantics remain intact.
- [ ] 4.3 Exercise automatic acceptance end to end: an old empty-body entry, teaser, full-body feed entry displayed without tabs or fetching controls, redirect with relative images, cached reload, unreachable/unreadable source, manual retry, cooldown, concurrent opens, and source deletion. Do not mark this change complete based on milestone A alone.
- [ ] 4.4 Update docs 05/06/11 and decisions with automatic-on-open behavior, exclusions, and milestone results; verify documentation matches fixture-backed browser acceptance.

## 5. Verification and handoff

- [x] 5.1 Run lint/typecheck, affected extractor/service/database/API/web tests, unchanged Google Reader conformance, and web/Lambda builds. Verify database projection/claim tests against real Postgres and the total API operation budget against Terraform's 29-second timeout; resolve failures before broadening checks.
- [x] 5.2 Cross-check the documentation delivered with each milestone for consistent limits, lifetime, deployment/rollback, and automatic trigger boundaries; verify it matches the completed acceptance scenarios.
- [ ] 5.3 Review additive migration ordering in CI before deployment; preserve schema/extracted bodies on rollback and deploy only through the pipeline. Update docs 06 current state and decisions in the implementation commit with both milestone outcomes and any remaining release gates.

## Implementation handoff — 2026-10-28

Manual controls, shared persistence, automatic-on-open, web projection, and image
integration are implemented locally. Final full suite: 371 tests passed across 43
files, including unchanged Google Reader conformance and all threshold/tab/loading
regressions. Workspace typecheck, lint, and web/Lambda builds passed; the final
reader UI passed the web build's TypeScript check and full regression suite.
Migration 0005 is additive; reviewed deploy
workflow migrates existing databases before Terraform Lambda updates.
No production deployment or CI plan run occurred. The user approved the final
reader UI and requested committing the implementation. Browser scenario acceptance
and CI release review remain separate outstanding gates.

Browser acceptance is blocked: computer-use inventory has no browser connector,
and native Safari access reports "Computer Use permissions are not granted".
Tasks requiring local browser walkthrough/acceptance and CI release review remain
unchecked; component/integration results are not substituted for those gates.
Temporary fixture servers were stopped after browser access was denied. They used
only sparkle_test with injected extraction; no public-fetch guard was bypassed.
Browser acceptance still requires a permitted browser session.

### 2026-10-28 — Automatic-fetch length refinement

Automatic fetching now requires fewer than 500 normalized readable characters in
the original feed body. `AUTOMATIC_FULL_CONTENT_TEXT_LIMIT` is the single tuning
constant in core's `article/content-policy.ts`. The service returns eligibility to
the reader and independently skips long-body automatic API requests before budget
admission. Manual fetching is unchanged. Boundary/markup/entity/Unicode policy tests,
reader-trigger tests, and real-Postgres automatic-skip/manual-fetch tests verify it.
Existing browser and CI acceptance gates remain open.

### Reader UI refinement

Replaced content switching with Mantine outline tabs and prevented initial feed-body
flash by treating the impending automatic request as pending from the first render.
Original remains selectable during pending work; longer articles initially
select Original and can fetch manually via the other tab. Focused reader/hook
suites pass (27 tests). Earlier browser/CI acceptance gates remain unchanged.

### Full feed articles omit fetching UI

At or above the readable-text threshold, ReaderPane now hides both tabs and all
fetch/retry controls and displays the original feed body, even when an extracted
copy was previously cached. Hook-level manual actions are guarded by the same
reader eligibility flag. Short and empty articles retain their tabs and loading
behavior. The existing server-side manual API contract is unchanged.

### Final reader UI approved

The user reviewed and approved the final labels (Fetched article / Original),
loading behavior, and hidden fetch controls for full feed bodies. Commit this
implementation with the change left open for its remaining acceptance/release tasks.
