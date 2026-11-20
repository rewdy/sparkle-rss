# Verification — 2026-11-20

- Full regression: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sparkle_test pnpm test` — 52 files, 517 tests pass. Includes API integration, service persistence, DSQL recovery, and unchanged Google Reader conformance.
- `pnpm lint`, `pnpm typecheck`, `pnpm build:web`, and `pnpm build:lambdas` pass.
- Migration 0007 applied to the existing development database; test suites also exercised a fresh migrated schema. DSQL fake-engine recovery verifies nullable boolean ADD, separate default, and recovery after interruption; this does not claim a production DSQL apply.
- Installed headless Playwright/Chromium used after the session exposed no Playwright MCP and native browser automation was unavailable while the Mac was locked. No repository dependency added.
- Browser fixture: original short body plus a retained long extraction, starred and feed-backed Read Later. Desktop 1440×1000: disable via Edit feed, hide tabs/show original, centered publisher action, reload persistence, Saved and Read Later aliases, re-enable cached extraction, and Original-tab button visibility all pass. Zero content POSTs and zero page errors.
- Light mode with purple accent and dark mode show a filled primary-color button; screenshot/geometry review confirms it is centered below content and above navigation.
- iPhone 13 viewport/touch emulation: original body and button fit without horizontal overflow; touch opens the stored publisher URL in a separate page (publisher response fulfilled locally). Keyboard focus on the link succeeds.
- Browser acceptance caught event bubbling from portal controls into the sidebar link. Feed dropdown and Edit feed clicks now stop propagation; a nested-link regression test verifies no navigation.
- Screenshots were inspected at `/tmp/sparkle-optout-desktop-dark.png`, `/tmp/sparkle-optout-desktop-light.png`, and `/tmp/sparkle-optout-mobile-dark.png`.
- Initial verification was local; no production changes at that time. User subsequently confirmed acceptance and authorized archive, spec sync, and shipping through the main-branch deployment pipeline.
- Follow-up: article clicks tested on both localhost and HTTP LAN origins after replacing secure-context-only randomUUID with getRandomValues for history IDs; 22 navigation tests, lint, and web build pass.
