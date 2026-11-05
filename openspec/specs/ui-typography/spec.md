# UI Typography Specification

## Purpose


Keeps text comfortably readable across display sizes and defines which typeface each
major navigation surface uses.

## Requirements


### Requirement: Large-viewport text scale

When the viewport is at least 1600 CSS pixels wide, the app SHALL raise its root font
size to 112.5% of the user's default so all rem-based type, spacing, and shell chrome
(sidebar width, header height) grow together. Below that width the root font size
SHALL remain at 100%. The increase SHALL be expressed relative to the user's default
font size, not as a fixed pixel value, so users who already enlarged their browser
text keep that preference. Article body text SHALL be sized in rem so it scales with
the rest of the app; the mobile input size floor is exempt because it exists to stop
iOS zoom.

#### Scenario: Wide desktop

- **WHEN** the app renders in a viewport at least 1600 CSS pixels wide
- **THEN** root font size is 112.5% of the user's default and the sidebar, header, and
  body copy all render larger in proportion

#### Scenario: Standard and narrow viewports

- **WHEN** the app renders in a viewport narrower than 1600 CSS pixels
- **THEN** root font size stays at the user's default and layout matches today

#### Scenario: User-enlarged default text

- **WHEN** the user's browser default font size is larger than 16px
- **THEN** the wide-viewport scale multiplies that default instead of replacing it

#### Scenario: Article body scales

- **WHEN** an article is opened on a viewport at least 1600 CSS pixels wide
- **THEN** reading-pane body text grows with the root scale rather than staying fixed

### Requirement: Sidebar typeface

The sidebar SHALL render section headings, navigation labels, feed names, and its
settings/sign-out actions in the app's sans-serif face. Unread-count badges inside the
sidebar SHALL keep monospace numerals so counts stay aligned. Every other surface
(top bar, list rows, metadata, reading pane) SHALL keep its current typeface.

#### Scenario: Sidebar uses the sans-serif face

- **WHEN** the user views any stream
- **THEN** the sidebar's headings, stream labels, and feed names render in the
  sans-serif face

#### Scenario: Counts stay monospace

- **WHEN** a sidebar row shows an unread count
- **THEN** the count renders with monospace numerals

#### Scenario: Other surfaces are unchanged

- **WHEN** the top bar, list rows, and reading pane render
- **THEN** their typefaces match the current design
