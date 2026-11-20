# Proposal

## Why

Some publishers do not extract reliably, and readers need a durable way to keep those feeds on their original RSS content. Short bodies also need a more visible route to the publisher than the existing corner icon.

## What Changes

- Add a per-user, per-feed “Fetch full articles” setting in Edit feed, enabled by default and persisted across devices.
- Disabling it prevents automatic and manual on-demand fetching and shows original feed content directly, including when a fetched copy already exists. Retain cached copies for reuse after re-enabling.
- Enforce the preference in the first-party content service as well as the reader, consistently across feed articles, Saved, deep links, and feed-backed Read Later.
- Below a displayed body shorter than 500 readable characters, show a centered, filled primary-color link button labeled “View full post…”, opening the stored article URL. Keep the existing corner link.
- Preserve ingestion, off-feed Read Later extraction, and Google Reader behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `feed-subscription`: Persist and edit an owned subscription's full-article-fetch preference with an enabled default.
- `full-article-content`: Respect feed opt-outs for fetching and display; expose a prominent publisher link below short displayed bodies.

## Impact

- Additive DSQL-compatible subscription migration, schema, subscription DTO/service, and existing first-party subscription PATCH validation.
- Article-content projections/admission, React Query reconciliation, Edit feed, and ReaderPane; extend existing database/API/hook/reader tests.
- Update docs 03, 05, 11, roadmap, and decision log during implementation. No new AWS resources or runtime dependencies; no Google Reader API contract changes.
