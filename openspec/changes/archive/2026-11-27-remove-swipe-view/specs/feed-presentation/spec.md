# Spec Delta

## MODIFIED Requirements

### Requirement: Device-local third presentation
The web reader SHALL offer only List and Cards on Today, All, Unread, individual subscription, folder, and Read later streams. Selection SHALL persist on the current device without changing account settings. Existing List and Cards preferences SHALL remain valid. Stored Swipe (`swipe`) and legacy Feed (`feed`) preferences SHALL migrate to List (`list`). Missing or invalid preferences SHALL default to List. The former text-only List layout and separate Feed selection SHALL no longer be offered. Saved SHALL retain its dedicated mixed list without changing the stored preference.

#### Scenario: Reload selected List
- **WHEN** a user selects List and reloads an eligible stream
- **THEN** List remains selected on that device

#### Scenario: Reload selected Feed
- **WHEN** a user previously selected Feed and reloads an eligible stream after the update
- **THEN** List is selected with the former Feed layout and the separate Feed option is absent

#### Scenario: Reload selected Cards
- **WHEN** a user selects Cards and reloads an eligible stream
- **THEN** Cards remains selected on that device

#### Scenario: Visit Saved
- **WHEN** a user with List selected visits Saved and then returns to an eligible stream
- **THEN** Saved uses its dedicated layout and the eligible stream uses List

#### Scenario: Legacy Feed preference
- **WHEN** a user loads with a stored `feed` preference
- **THEN** List is selected with the former Feed layout and the normalized `list` preference is persisted without changing other local preferences

#### Scenario: Legacy Swipe preference
- **WHEN** a user loads with a stored `swipe` preference
- **THEN** List is selected and persisted without changing other local preferences
- **AND** the selector offers only List and Cards

#### Scenario: Existing preference
- **WHEN** a user loads with a missing or invalid presentation preference
- **THEN** List is selected

### Requirement: Accessible controls and loading states
The presentation selector and List article activation SHALL support keyboard operation and visible focus. Thumbnails SHALL NOT introduce a duplicate focus target or repeat the headline as redundant accessible text. Initial loading SHALL show a List-appropriate skeleton with the same left text inset and reserved thumbnail dimensions. Empty and end-of-stream states SHALL remain available. The two-option selector SHALL fit narrow mobile headers while preserving navigation, refresh, and theme controls.

#### Scenario: Keyboard activation
- **WHEN** a keyboard user focuses a List article and activates it
- **THEN** the same reader route opens as for pointer activation

#### Scenario: Initial loading
- **WHEN** List is awaiting its first article page
- **THEN** an accessible loading status and aligned text/thumbnail skeleton appear

#### Scenario: End of stream
- **WHEN** the final nonempty List page has been reached
- **THEN** the end-of-stream indicator is shown
