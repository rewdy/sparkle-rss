# Design

## Context

`parseRoute` currently treats the root as the All stream. `Shell` already loads account settings through React Query, ordinary sign-in already lands on `/`, and the Topbar logo links to `/all`. Sidebar renders the built-in streams in a fixed order. Settings are merged into the account's `user_settings.data` JSON.

## Goals / Non-Goals

Use one effective account preference for routing and ordering. Keep URL-driven stream selection, reader history, and subscription popup return behavior within their existing contracts.

## Decisions

- Store `homeView` as an optional `all | unread | today` key on the existing settings endpoint. Validate the key when supplied while preserving the generic patch contract for other keys. Normalize missing or unsupported stored values to `all` on read. The JSON store supports this addition without a schema migration.
- Use the account's React Query settings result as the source for the selector, shell, and sidebar. Publish the successful PUT response to the settings cache so the sidebar updates immediately. Keep save errors visible and retain the last saved selection on failure. Use the existing session boundary and ensure cached settings belong to the current account.
- Give the authenticated shell ownership of the exact root path. Suspend stream rendering and entry queries while the initial settings request is pending at root. Once resolved, replace the root URL with the canonical stream path and its applicable view parameters. Use cached settings from the same account when available and use All on a terminal load error without such data. Canonical paths give reader history a concrete origin.
- Use a stable promotion of the chosen item from the existing All items, Today, Unread order. Preserve current link destinations, active state, badges, and mobile drawer behavior. Route the logo through `/` and verify the existing ordinary sign-in and sign-in fallback targets. Treat explicit All links and origin-aware reader and channel returns as stream navigation.

## Risks / Trade-offs

- A cold visit to root depends on settings availability. Use the existing loading state at root and bound the wait by the query's error outcome.
- Cached settings can briefly lag behind changes from another device. Apply refreshed data to sidebar ordering and subsequent home visits while keeping the current canonical stream in place.
- Root currently accepts URL view parameters through the All alias. Carry applicable parameters to the destination, applying Unread's forced filter, and resolve only the exact root pathname.

## Migration Plan

Existing settings rows without the key immediately use All. Rollback leaves the optional key in JSON for a later redeploy and restores the previous All landing behavior.
