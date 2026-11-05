# Tasks

## 1. Theme configuration

- [x] 1.1 In `apps/web/src/themes.ts`, export a resolver typed `CSSVariablesResolver` from `@mantine/core` that returns `{ variables: {}, light: { "--sparkle-surface-code": theme.colors.dark[7] }, dark: { "--mantine-color-body": neutrals[8], "--sparkle-surface-code": neutrals[7] } }` (the `neutrals` ramp constant, typed non-optional) and verify `pnpm typecheck` and `pnpm lint` pass
- [x] 1.2 Pass `cssVariablesResolver` to `MantineProvider` in `apps/web/src/App.tsx`, verify `pnpm typecheck` passes and the dark page renders `#17171b` with header/navbar matching
- [x] 1.3 Update the static `theme-color` meta in `apps/web/index.html` from `#1a1b1e` to `#17171b` and verify the served page's meta tag matches the hydrated value in dark scheme

## 2. Code block surface

- [x] 2.1 In `apps/web/src/styles.css`, change `.reading-content pre` background to `var(--sparkle-surface-code)` and verify `pnpm lint` passes and the selector carries no color values

## 3. Documentation

- [x] 3.1 Add a normative "Styling policy" section to `docs/05-frontend.md`: always attempt styling through Mantine theme configuration first (theme colors/ramps, component props, `cssVariablesResolver` for scheme-dependent variables); write custom CSS rules only when no theme mechanism reaches the target, and then only to consume theme tokens or handle layout, never to hardcode colors; and verify the section matches what this change actually did
- [x] 3.2 Add a one-line pointer to that policy in the `AGENTS.md` conventions list and verify the link target exists

## 4. Verification

- [x] 4.1 Run `docker compose up -d db && pnpm dev`, open an article whose content includes a `<pre>` block (or temporarily inject one in the reader), and confirm in dark scheme: page, AppShell header and navbar render `#17171b`; the code block renders `#222228` and is visibly offset; text remains legible
- [x] 4.2 Confirm light scheme and `system`-resolved-to-light are pixel-unchanged: white page, code block still `#242424`; and confirm StoryView's no-image fallback and the Settings knockout ring look coherent on the darker dark page
- [x] 4.3 Run `pnpm test` and `pnpm build:web` to confirm no regression, then check off the roadmap item in `docs/06-roadmap.md` if this change was listed there and append a one-line decision to `docs/decisions.md` recording the Mantine-theme-first styling policy