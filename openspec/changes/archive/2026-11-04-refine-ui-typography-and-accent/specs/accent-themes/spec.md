# Spec Delta

## Purpose

Defines the selectable accent presets and the scheme-dependent colors each preset
contributes to emphasis text, tinted surfaces, and filled actions.

## ADDED Requirements

### Requirement: Accent preset catalog

The app SHALL offer six accent presets: blue, scarlet, steel, magenta, purple, and
persimmon (orange). Every preset SHALL provide a complete ten-shade ramp so both color
schemes resolve. A stored preset selection SHALL remain valid across releases; an
unrecognized stored value SHALL fall back to blue.

#### Scenario: Persimmon is selectable

- **WHEN** the user opens appearance settings
- **THEN** persimmon appears beside the existing presets and selecting it recolors
  accent elements in both light and dark schemes

#### Scenario: Existing selections survive

- **WHEN** a user with blue, scarlet, steel, magenta, or purple stored loads the app
- **THEN** that preset is still active with no stored-setting migration

#### Scenario: Unknown selection

- **WHEN** the stored preset id is not one of the six presets
- **THEN** the app renders the blue preset

### Requirement: Dark-scheme accent emphasis contrast

In the dark scheme, accent-colored text and icons — active navigation labels, light
buttons, link hover, and unread badges — SHALL render at 4.5:1 or better against the
dark page background (`#17171b`). Filled accent buttons SHALL keep white text on the
preset's deep accent shade in both schemes, and that pairing SHALL reach at least
3:1.

#### Scenario: Emphasis text is legible on the dark page

- **WHEN** any preset is active in the dark scheme
- **THEN** accent emphasis text and icons measure at least 4.5:1 against `#17171b`

#### Scenario: Filled actions stay deep

- **WHEN** a filled accent button renders in either scheme
- **THEN** its background is the preset's deep accent shade and its label is white,
  with at least 3:1 between them

### Requirement: Dark-scheme accent tint surfaces

Selected and hovered accent surfaces in the dark scheme SHALL read as a translucent
tint of the preset's hue over the page rather than a flat near-black ramp value. Each
preset's selected tint SHALL differ from the page background by at least 1.2:1 and
SHALL be lighter than the page, so selection remains visible without looking muddy.

#### Scenario: Selected row reads as a tint

- **WHEN** a stream row is selected in the dark scheme
- **THEN** its background is an accent-hued tint at least 1.2:1 lighter than the page
  for every preset

#### Scenario: Light scheme keeps pale tints

- **WHEN** the light scheme is active
- **THEN** selected and hovered accent surfaces remain pale accent tints on the white
  page rather than dark fills

### Requirement: Scheme-aware preset preview

Appearance settings SHALL preview each preset in the accent shade that the current
scheme uses for emphasis — the light-scheme emphasis shade in light mode and the
dark-scheme emphasis shade in dark mode — so presets are judged as they render.

#### Scenario: Dark-scheme preview

- **WHEN** the settings page renders in the dark scheme
- **THEN** each preset swatch shows the dark-scheme emphasis shade

#### Scenario: Light-scheme preview

- **WHEN** the settings page renders in the light scheme
- **THEN** each preset swatch shows the light-scheme emphasis shade
