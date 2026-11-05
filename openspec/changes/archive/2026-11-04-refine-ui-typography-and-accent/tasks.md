# Tasks

## 1. Large-viewport text scale

- [x] 1.1 Add the wide-viewport root scale to `apps/web/src/styles.css` (`@media (min-width: 100em) { html { font-size: 112.5%; } }`) and change `.reading-content` from `font-size: 16px` to `1rem`; confirm the mobile input floor stays `16px`. Verify with `pnpm dev`: at 1600px and wider the sidebar (260rem-derived), header (44rem-derived), body copy, and reading text scale up together; at 1599px and narrower they match today.
- [x] 1.2 Update `docs/05-frontend.md` typography/styling notes to state the 112.5% root scale at 1600px+, the rem-based reading body, and the intentional 16px iOS floor; verify the doc reads consistently with the CSS.

## 2. Dark-scheme accent treatment

- [x] 2.1 In `apps/web/src/themes.ts`, set `primaryShade: { light: 6, dark: 4 }` and override `--mantine-color-accent-filled` / `-filled-hover` for dark (shade 6 / 7) in `cssVariablesResolver`; run `pnpm --filter web dev` in dark mode and confirm primary buttons stay deep with white text while nav/badge accent text brightens.
- [x] 2.2 Emit the semantic tokens `--sparkle-accent-tint-strong` (light `accent-1`, dark `alpha(accent-5, 0.22)`), `--sparkle-accent-tint` (light `accent-0`, dark `alpha(accent-5, 0.14)`), and `--sparkle-accent-strong` (light `accent-7`, dark `accent-4`) from the resolver; verify in dev tools that all three resolve in both schemes and that `themes.ts` still owns every color value.
- [x] 2.3 Replace the raw dark ramp picks in `apps/web/src/styles.css` (`.entry-row` hover/`[data-active]`, `.article-card[data-active]`, `.card-placeholder`, `.site-title:hover`) with the new tokens; verify selected/hovered rows, selected cards, and card placeholders show a visible accent tint in dark mode and stay pale tints in light mode.
- [x] 2.4 Add `apps/web/test/themes.test.ts` with a WCAG contrast helper asserting, for every preset, emphasis shade vs `#17171b` ≥ 4.5:1, filled shade vs white ≥ 3:1, and the 22%-alpha selected tint over `#17171b` ≥ 1.2:1; run `pnpm --filter web test` and confirm all assertions pass.

## 3. Persimmon preset and swatch preview

- [x] 3.1 Add the `persimmon` ramp and `ThemeId` entry in `apps/web/src/themes.ts` (shade 4 `#f29a45`, shade 6 `#d9761f`); extend the contrast test from 2.4 to cover it and confirm it passes alongside stored-id fallback behavior.
- [x] 3.2 Add the per-scheme emphasis-shade helper in `themes.ts` and use `useComputedColorScheme` in `apps/web/src/pages/Settings.tsx` to fill swatches and the selection ring with the active scheme's emphasis shade; verify in dev that dark-mode swatches show shade 4 and light-mode swatches shade 6.
- [x] 3.3 Update `docs/05-frontend.md` theme-preset notes (six presets, scheme-aware primary shade, filled-button override, semantic accent tokens) and append a dated entry to `docs/decisions.md`; verify the doc matches the shipped theme configuration.
- [x] 3.4 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` at the workspace root and confirm all pass before the sidebar experiment.

## 4. Sidebar sans-serif experiment (last; stop for review)

- [x] 4.1 Set `ff={fonts.sans}` on the `Sidebar` root `Box` in `apps/web/src/components/Sidebar.tsx`, leaving the unread badge's `ff="monospace"` intact; verify in dev that section headings, stream labels, feed names, and settings/sign-out render sans while badge counts stay monospace and every other surface is unchanged.
- [x] 4.2 Run `pnpm --filter web test` (sidebar and ui-state suites) and `pnpm typecheck`; confirm they pass without snapshot or assertion changes.
- [x] 4.3 Note the sidebar face in `docs/05-frontend.md` as awaiting user sign-off, then stop and present the running app for the user's thumbs up/down before any further work.
