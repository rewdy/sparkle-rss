# Theme Surfaces Specification

## Purpose

Define scheme-dependent background surfaces so the dark scheme reads as a deliberate dark palette: the application background, its derived chrome surfaces, and code blocks inside article reading content all use tones that relate visibly to each other.

## Requirements

### Requirement: Dark scheme application background
When the resolved color scheme is dark, the application background SHALL use the darker palette tone `#17171b` (the app's `neutrals-8`) instead of the library default `#242424`. Full-page surfaces that derive from the application background — the AppShell header, navbar, and main area, the story-view fallback background, and the settings knockout ring — SHALL render with the same tone in dark mode. The static initial `theme-color` meta value in `index.html` SHALL match the hydrated dark value (`#17171b`) so browser chrome does not flash a different tone.

#### Scenario: Dark page background is the darker palette tone
- **WHEN** the app renders with the dark color scheme
- **THEN** the page body background is `rgb(23, 23, 27)` (`#17171b`) and the AppShell header and navbar backgrounds resolve to the same tone

#### Scenario: Light scheme is unchanged
- **WHEN** the app renders with the light color scheme (or resolves `system` to light)
- **THEN** the page background remains white (`#ffffff`) and no light-mode surface color changes

#### Scenario: Browser chrome matches the page tone
- **WHEN** the app is served and rendered before the theme reacts
- **THEN** the static `theme-color` meta equals `#17171b`, matching the hydrated dark value

### Requirement: Reading-content code block contrast
Code blocks (`<pre>`) inside article reading content SHALL render a background that is visibly offset from the page background in every color scheme. In dark scheme the offset SHALL be one step lighter (`#222228`, the app's `neutrals-7`); in light scheme the existing dark surface (`#242424` on the white page) SHALL be preserved. Code block text SHALL remain legible on the new surface.

#### Scenario: Dark code block stands out from the page
- **WHEN** an article containing a `<pre>` code block is rendered in dark scheme
- **THEN** the code block background is `rgb(34, 34, 40)` (`#222228`), visibly lighter than the `rgb(23, 23, 27)` page background

#### Scenario: Light code block is unchanged
- **WHEN** an article containing a `<pre>` code block is rendered in light scheme
- **THEN** the code block background remains `rgb(36, 36, 36)` (`#242424`) on the white page, as it is today