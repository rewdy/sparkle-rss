# User Authentication Spec Delta

## ADDED Requirements

### Requirement: Subscription popup resumes after sign-in
When a subscription popup requires sign-in, the application SHALL preserve its internal destination and query parameters and resume that destination after successful sign-in, including completion of a required permanent-password challenge. Returning SHALL run discovery and require explicit subscription confirmation. Return destinations SHALL be validated as supported same-origin internal paths; external, protocol-relative, malformed, or unsupported destinations SHALL fall back to the normal application landing page. Sign-in without a return destination SHALL retain its current landing behavior.

#### Scenario: Signed-out bookmarklet activation
- **WHEN** a signed-out user opens the subscription popup and signs in successfully
- **THEN** the popup resumes the original source URL, page title, and popup mode and asks for confirmation after discovery

#### Scenario: Permanent password required
- **WHEN** sign-in for the subscription popup requires setting a permanent password
- **THEN** completing that challenge resumes the original subscription popup without subscribing automatically

#### Scenario: Untrusted return destination
- **WHEN** a sign-in URL specifies an external, protocol-relative, malformed, or unsupported return destination
- **THEN** successful sign-in navigates to the normal application landing page

#### Scenario: Ordinary sign-in
- **WHEN** a user signs in without a return destination
- **THEN** the application uses its existing landing page
