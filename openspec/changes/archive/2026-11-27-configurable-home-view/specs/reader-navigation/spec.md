# Reader Navigation Delta

## ADDED Requirements

### Requirement: Account home view preference

Settings SHALL offer a segmented Home view selector with All, Unread, and Today and a short description explaining that it controls the default landing view. A successful save SHALL persist the selection for the signed-in account across reloads and devices. Accounts without a supported saved selection SHALL use All. The web settings API SHALL reject unsupported values supplied for this preference and SHALL continue accepting patches that omit it.

#### Scenario: Save a home view
- **WHEN** a user saves Unread or Today as their home view
- **THEN** Settings shows that selection after reload and when the same account opens Settings on another device
- **AND** other accounts keep their own selections

#### Scenario: Existing account without a preference
- **WHEN** an account has no home preference or has an unsupported stored value
- **THEN** its effective home view is All

### Requirement: Root resolves to the account home stream

The authenticated app SHALL replace `/` with `/all`, `/unread`, or `/today` according to the effective preference, preserving any applicable filter and sort parameters. It SHALL wait for the initial account settings result before resolving home and SHALL use All if settings loading fails and no saved value is available. App-wide home actions SHALL target `/`. Explicit stream links, reader return actions, and supported sign-in return destinations SHALL keep their stream or workflow destinations.

#### Scenario: Go home
- **WHEN** a user who selected Today opens `/`, follows the topbar logo, or signs in through the ordinary landing flow
- **THEN** the app opens `/today`
- **AND** browser history gains no intermediate root entry

#### Scenario: Open a different stream directly
- **WHEN** a user whose home view is Today opens `/all`, `/unread`, or an article deep link
- **THEN** the app honors the requested destination

### Requirement: Home stream leads sidebar navigation

The sidebar SHALL put the effective home stream first and keep all other stream links in their existing relative order. A successful save SHALL update sidebar order without changing the current page.

#### Scenario: Choose Unread
- **WHEN** a user saves Unread as their home view
- **THEN** the sidebar starts with Unread, All items, and Today, in that order

#### Scenario: Choose Today or restore All
- **WHEN** a user saves Today
- **THEN** the sidebar starts with Today, All items, and Unread, in that order
- **AND** choosing All again restores All items, Today, and Unread
