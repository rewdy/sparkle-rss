# Feed Subscription Delta

## ADDED Requirements

### Requirement: Owned feed fetching preference
Each subscription SHALL have a persistent, per-user full-article-fetch preference, enabled by default for existing and new subscriptions. The first-party subscription API SHALL return the effective preference and accept an optional boolean update for an owned subscription. Omitting it SHALL preserve its value. Another user's preference SHALL remain independent.

#### Scenario: Existing and new subscriptions
- **WHEN** an existing subscription is read or a subscription is created through web, OPML, or Google Reader
- **THEN** full-article fetching is enabled unless that subscription was explicitly opted out

#### Scenario: User isolation and validation
- **WHEN** a user disables fetching for an owned feed
- **THEN** only that user's subscription changes and the choice survives reload and another device
- **AND** a missing or foreign subscription update returns 404 and a non-boolean preference returns 400

#### Scenario: Other subscription edits
- **WHEN** a title or folder update omits the fetching preference, including edits through Google Reader or repeated OPML imports
- **THEN** the existing fetching preference remains unchanged

### Requirement: Feed editor exposes fetching preference
Edit feed SHALL provide a labeled “Fetch full articles” toggle with explanatory text that disabling it uses the original feed content. Save SHALL persist the toggle alongside the existing title edit. A failed save SHALL show feedback and retain the user's choices without claiming success.

#### Scenario: Disable and restore
- **WHEN** a user opens Edit feed, disables Fetch full articles, and saves
- **THEN** the feed's saved preference is disabled
- **AND** reopening the editor reflects that choice and permits re-enabling it

#### Scenario: Failed update
- **WHEN** saving the preference fails
- **THEN** the editor stays open with the draft choices and actionable error feedback
