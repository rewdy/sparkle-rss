# Spec Delta

## MODIFIED Requirements

### Requirement: One history entry per reading session
Opening an article from a stream surface SHALL create one browser history entry. Steps through j/k or reader Next/Previous controls SHALL update the reader URL within that entry. Browser Back, reader Back, and Escape SHALL return directly to the originating surface. Forward SHALL reopen the session's last reader view, whether an article or the channel end view. Navigation at an article boundary SHALL NOT create additional history entries. Keyboard opening from a surface SHALL follow the same policy as pointer opening.

#### Scenario: Several articles then return
- **WHEN** a user opens A from Unread, moves to B and C, and uses any of the three return actions
- **THEN** Unread is shown immediately without visiting B or A
- **AND** browser Forward reopens C

#### Scenario: Keyboard entry and boundaries
- **WHEN** j opens an article from a stream and subsequent steps reach a boundary
- **THEN** Back returns directly to the originating stream with no duplicate reader entries

## ADDED Requirements

### Requirement: End view for Today, Unread, and All

When the reader advances beyond the final article in the current Today, Unread, or All view using Next or j, the app SHALL show a dedicated in-reader completion screen with a friendly heading and a visible, keyboard-accessible return link labeled for the current channel. The heading SHALL receive focus on entry. Previous or k SHALL return to the article the user finished when it is still accessible. If that article is unavailable, the channel return link SHALL remain usable. The end view SHALL have no article actions and SHALL issue no article mutations. Empty channels SHALL display their existing empty state.

#### Scenario: Finish a channel
- **WHEN** a user explicitly advances from the final article of Today, Unread, or All
- **THEN** the reader shows the end view and repeated Next or j leaves it there
- **AND** Previous or k reopens the last article if it remains accessible

#### Scenario: Return to the channel
- **WHEN** a user follows the return link, presses Escape, or uses browser Back from an app-opened end view
- **THEN** the originating channel returns with its filter, sort, and presentation and the existing scroll restoration behavior
- **AND** browser Forward restores the end view

#### Scenario: Open without a known origin
- **WHEN** a user opens the end view directly and uses its return link or Escape
- **THEN** the app replaces the end view with the parent channel preserving filter and sort

### Requirement: Confirm exhaustion before showing the end view

When advancing from the last loaded article of an eligible channel, the reader SHALL follow available pagination for the current filter and sort until a following article is found or the stream is known to be exhausted. The current article SHALL stay visible during loading. A fetch failure SHALL provide visible retry feedback and SHALL NOT be treated as exhaustion. A pending advance SHALL NOT navigate after the user changes the reader view or channel.

#### Scenario: More articles remain
- **WHEN** a user advances from the last loaded article and the next page contains more articles
- **THEN** the reader loads the page and opens the next article in order with the existing mark-on-open behavior

#### Scenario: Page fetch fails
- **WHEN** loading more articles fails during a forward step
- **THEN** the current article stays open and the user can retry the forward step
