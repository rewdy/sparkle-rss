# Proposal: dark-scheme-background-contrast

## Why

In dark mode the reading content's code blocks (`<pre>`) use the same background color as the page (`--mantine-color-dark-7`, `#242424`), so code becomes invisible against the article; light mode works because the `<pre>` keeps its dark surface on the white page. Separately, the dark page background itself reads brighter than the app's designed dark palette: the browser-chrome `theme-color` is already `#17171b` (the app's `neutrals-8`), so the mobile status bar renders visibly darker than the page behind it.

## What Changes

- Introduce a scheme-aware CSS-variables resolver as part of Mantine theme configuration (exported from `apps/web/src/themes.ts`, passed to `MantineProvider` in `App.tsx`). It emits, for the dark scheme, an override of the application body background (`--mantine-color-body` → `neutrals-8`, `#17171b`) and, for both schemes, a semantic code-block surface token (`--sparkle-surface-code`: light `dark-7` `#242424`, dark `neutrals-7` `#222228`). All color values live in theme configuration; no library variables are overridden by hand-written CSS.
- `.reading-content pre` consumes `var(--sparkle-surface-code)`. Article HTML is not a Mantine component, so this one selector maps to the theme token; it carries no color values and replaces the current `light-dark()`/`dark-7` literal.
- Dark mode surfaces that derive from the body color (AppShell header/navbar, story-view fallback, settings knockout ring) darken uniformly with the page. Light mode appearance is unchanged.
- Align the static initial `theme-color` meta in `index.html` (`#1a1b1e`) with the runtime dark value (`#17171b`).
- Document the styling policy in `docs/05-frontend.md`: styling changes MUST go through Mantine theme configuration first; hand-written CSS rules are a last resort reserved for targets theme configuration cannot reach (e.g. raw article HTML), and must not carry color values.
- No data, API, or greader-surface changes.

## Capabilities

### New Capabilities

- `theme-surfaces`: scheme-dependent background surfaces for the app shell (page background driven by the dark-scheme body color) and for code blocks inside article reading content.

### Modified Capabilities

## Impact

- `apps/web/src/themes.ts`: new exported `CSSVariablesResolver` (theme configuration for the body background override and the code-surface token).
- `apps/web/src/App.tsx`: `MantineProvider` receives the resolver.
- `apps/web/src/styles.css`: `.reading-content pre` consumes `var(--sparkle-surface-code)`.
- `apps/web/index.html`: static `theme-color` content updated to match the runtime dark value.
- `docs/05-frontend.md`: new "Styling policy" section making Mantine-theme-first styling mandatory.
- Visual-only change; no dependencies, API, or database impact. Verification is `pnpm lint` / `pnpm typecheck` plus a manual light/dark/system visual check against `docs/05-frontend.md` conventions.