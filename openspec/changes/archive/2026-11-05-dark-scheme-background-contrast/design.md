# Design

## Context

Current state (verified against `apps/web/src` and the installed `@mantine/core` v9 sources):

- The page background in dark mode is `--mantine-color-body`, which Mantine defines per scheme: `#fff` (light) / `var(--mantine-color-dark-7)` = `#242424` (dark). The `dark` ramp is the Mantine default; the app's `buildTheme` overrides only `neutrals` and `accent`. `body { background-color: var(--mantine-color-body) }` and `AppShell` header/navbar styles all consume this variable.
- `.reading-content pre` (`apps/web/src/styles.css:100-105`) sets `background: var(--mantine-color-dark-7)` unconditionally — identical to the dark page background, hence invisible in dark mode.
- `apps/web/src/themes.ts` already defines a `neutrals` ramp (`#17171b` at index 8, `#222228` at index 7, `#111114` at index 9) that is currently unused by components/CSS, but `App.tsx` already uses `#17171b` as the runtime dark `theme-color` (browser chrome). Mantine generates CSS variables for theme colors at runtime, so `var(--mantine-color-neutrals-8)` / `var(--mantine-color-neutrals-7)` resolve on any page.
- `index.html` ships a static `theme-color` of `#1a1b1e`, which disagrees with the hydrated runtime value.
- **Project directive**: styling updates MUST go through Mantine theme configuration first; hand-written CSS rules are allowed only when theme configuration cannot reach the target, and then only to consume theme tokens — never to carry color values. This change implements that directive and documents it in `docs/05-frontend.md`.

## Goals / Non-Goals

**Goals:**
- Darken the dark-scheme page and chrome surfaces to `neutrals-8` via Mantine's theme-variable mechanism, so all `--mantine-color-body` consumers stay in lockstep.
- Make the `<pre>` surface scheme-aware through a semantic token owned by theme configuration.
- Keep every color value in theme configuration; hand-written CSS consumes tokens only.

**Non-Goals:**
- Re-mapping Mantine's `dark` color ramp to `neutrals` (would shift borders, hovers, dimmed text app-wide — far beyond the reported problem).
- Introducing syntax highlighting, inline `code` styling, or light-mode surface changes.
- Redefining the accent ramps or any non-background surface.

## Decisions

1. **Emit the background override through a `CSSVariablesResolver` (Mantine's theme-variable API).**
   `themes.ts` exports a `CSSVariablesResolver` that returns `{ variables: {}, light: {...}, dark: {...} }` (all three keys are required by the type). For dark it emits `--mantine-color-body: theme.colors.neutrals[8]`; `App.tsx` passes it as the `cssVariablesResolver` prop to `MantineProvider`. Verified against the installed v9:
   - `getMergedVariables` deep-merges the resolver over `defaultCssVariablesResolver(theme)`, so only the overrides need to be emitted.
   - `removeDefaultVariables` keeps entries whose value differs from the `DEFAULT_THEME` output; our body value (`var(--mantine-color-neutrals-8)`) differs from the default (`var(--mantine-color-dark-7)`), so it survives deduplication.
   - The merged result renders in a runtime `<style data-mantine-styles>` tag injected after static stylesheets, so it wins the cascade over Mantine's static `:root[data-mantine-color-scheme="dark"]` fallback.
   - Alternatives rejected: a `[data-mantine-color-scheme="dark"] body { --mantine-color-body: ... }` rule in `styles.css` (CSS-only override — violates the project directive); remapping `colors.dark` in `buildTheme` (shifts every `dark-N` consumer: borders would jump from `#424242` to `#9a9aa2`); `!important` or specificity games (fragile against the runtime style tag).
2. **Reference the existing `neutrals` ramp instead of hardcoding hex.**
   The resolver reads the `neutrals` ramp constant from `themes.ts` (the same single source `buildTheme` uses; indexing the theme's `colors` record is typed as possibly-undefined under the strict TS config), matching the value already used for the runtime `theme-color`. No new color tokens are invented.
3. **Code-block surface is a semantic token emitted by the resolver.**
   The resolver emits `--sparkle-surface-code` for both schemes (`light: theme.colors.dark[7]`, `dark: theme.colors.neutrals[7]`), and `.reading-content pre` consumes `var(--sparkle-surface-code)`. Light mode stays pixel-identical (dark-7 on white); dark mode gets one visible step lighter than the page (`#222228` on `#17171b`). Article HTML is not a Mantine component, so theme configuration cannot style the `<pre>` selector directly — this is the one case the directive allows: CSS maps the selector to a theme token and carries no color value. A `light-dark()` literal on the selector (the previous plan) would have been a CSS-only override and is rejected. The `sparkle-` prefix distinguishes app tokens from Mantine variables.
4. **Align `index.html`'s static `theme-color` to `#17171b`.**
   Removes the pre-hydration mismatch; the value is already the runtime dark constant in `App.tsx`.
5. **Document the styling policy in `docs/05-frontend.md`.**
   A normative "Styling policy" section: attempt Mantine theme configuration first (theme colors/ramps, component props, `cssVariablesResolver` for scheme-dependent variables); write a custom CSS rule only when no theme mechanism reaches the target, and then only to consume theme tokens or handle layout/positioning — never to hardcode colors. `AGENTS.md` conventions gain a one-line pointer to it so agents encounter the rule before writing CSS.

## Risks / Trade-offs

- [Surfaces that assumed `#242424` visually (cards, entry hover, skeletons) now sit on a darker page] → The change actually increases their contrast (cards/hover use `dark-6`/`dark-7`, both lighter than the new background); no consumer is darker than the new page. Verify visually in dev rather than trusting the ramp math.
- [`var(--mantine-color-neutrals-8)` availability depends on Mantine generating vars for custom theme colors] → Confirmed in the installed v9 (`get-css-color-variables` emits `--mantine-color-<name>-<N>` for every theme color); the CSS would show an unstyled fallback if this ever regressed, which is caught by the manual dark-mode check.
- [Resolver behavior (merge, dedupe) is Mantine-internal and could change across upgrades] → Documented above with the v9 source checks; if a future Mantine release changes semantics, the symptom is the old `#242424` background returning, which the manual dark-mode check catches immediately.
- [StoryView "no image" fallback and Settings knockout ring render in dark mode against the new tone] → They read the same variable and follow automatically; both are covered by the manual visual check.
- [Exact shade taste (`#17171b` page, `#222228` pre) may still need a nudge] → Both are one-token edits in `themes.ts`'s resolver; the spec pins the values, so a taste change is a deliberate spec update, not a silent drift.

## Migration Plan

Frontend-only, no data or API surface. Ship with the next deploy; rollback is reverting `themes.ts`, `App.tsx`, `styles.css`, `index.html`, and the docs. No migration steps.

## Open Questions

None. The dark page tone and the pre offset direction (lighter) were picked from the existing `neutrals` ramp to match the browser chrome the app already advertises; they are explicit one-token knobs if taste differs.