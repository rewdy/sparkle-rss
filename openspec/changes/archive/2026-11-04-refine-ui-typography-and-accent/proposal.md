# Proposal

## Why

The web app was designed at a single desktop scale and now runs on much larger
displays, where it reads small and cramped. In dark mode, the accent palettes were
authored light-first: emphasis text and tinted active surfaces land on mid-to-dark
shades that are muddy and, for several presets, fail text contrast against the new
`#17171b` page. The sidebar is the only surface that must scan quickly, yet it shares
the monospace body face with article prose.

## What Changes

- Scale the base root font size up on very large viewports so all rem-based type,
  spacing, and chrome (sidebar width, header height) grow proportionally; the
  reading pane's fixed 16px body size becomes rem-based so it scales too.
- Retune dark-mode accent treatment: emphasis/nav/badge text uses a brighter shade
  that clears 4.5:1 on the dark page, filled accent buttons stay deep with white
  text, and selected/hover accent surfaces become translucent accent tints instead
  of flat near-black ramp values.
- Show the Settings theme swatches in the accent shade actually used for emphasis
  in the active scheme, so presets are judged on how they render in dark mode.
- Add a new `persimmon` (orange) accent preset authored to the same shape and
  contrast floors as the existing ramps.
- Render the sidebar in the sans-serif face (DM Sans) instead of the monospace body
  face. This is an experiment: it ships last and stops for the user's thumbs up/down
  before any follow-up work.

## Capabilities

### New Capabilities

- `ui-typography`: base text scaling for large viewports and the sidebar's typeface
  identity.
- `accent-themes`: the accent preset catalog and how each preset's emphasis, tint,
  and filled-button colors resolve per color scheme, including the new `persimmon`
  preset.

### Modified Capabilities

None. `theme-surfaces` covers neutral background surfaces and is unchanged; accent
rendering is a new, separate contract.

## Impact

Frontend only: `apps/web/src/themes.ts`, `apps/web/src/styles.css`,
`apps/web/src/pages/Settings.tsx`, `apps/web/src/components/Sidebar.tsx`, a new
theme/contrast unit test, and docs 05 plus `docs/decisions.md`. No API, persistence,
Terraform, or Google Reader contract changes; `themeId` remains the stored preference
key and existing selections stay valid.
