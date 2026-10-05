# Spec Delta

## Purpose

Provides a first-party web authentication experience backed by the existing Cognito user pool. It lets invited users sign in, recover access, and keep a renewable session for up to seven days.

## ADDED Requirements

### Requirement: Users can sign in through the first-party web application
The system SHALL provide a first-party sign-in flow that authenticates users against the configured Cognito user pool without redirecting them to Cognito managed login. Successful authentication SHALL establish a web session and provide the access token needed for protected first-party API requests.

#### Scenario: Successful sign-in
- **WHEN** an invited user submits valid credentials
- **THEN** the system establishes a session and allows access to protected web application features

#### Scenario: Invalid credentials
- **WHEN** a user submits invalid credentials
- **THEN** the system rejects the sign-in and displays a useful, non-sensitive error without establishing a session

#### Scenario: Invited user must set a permanent password
- **WHEN** an admin-created user signs in with a temporary password and Cognito requires a password change
- **THEN** the system lets the user set a permanent password and completes sign-in

### Requirement: Users can maintain and end a session
The system SHALL renew authenticated web sessions through the service while a valid Cognito refresh token remains available. Refresh tokens SHALL remain valid for seven days. The system SHALL end the local session on sign-out and revoke the Cognito refresh token when possible. Expired or revoked sessions SHALL require the user to sign in again.

#### Scenario: Session is renewed
- **WHEN** the web application requests renewal with a valid session before its refresh-token expiry
- **THEN** the system returns a valid access token and continues the session

#### Scenario: Refresh token has expired or been revoked
- **WHEN** the web application requests renewal with an invalid refresh token
- **THEN** the system clears the session and reports that sign-in is required

#### Scenario: User signs out
- **WHEN** an authenticated user signs out
- **THEN** the system clears the browser session and makes the refresh token unusable for future renewal

### Requirement: Users can recover a password
The system SHALL let users request a password-reset code and complete a password reset through first-party screens backed by Cognito. The request response SHALL not reveal whether an account exists.

#### Scenario: Password reset requested
- **WHEN** a user submits an email or username to request a reset
- **THEN** the system returns a generic acknowledgement regardless of whether that account exists

#### Scenario: Password reset completed
- **WHEN** a user submits a valid reset code and a password that meets the pool policy
- **THEN** the system updates the Cognito password and confirms completion

#### Scenario: Invalid or expired reset code
- **WHEN** a user submits an invalid or expired reset code
- **THEN** the system rejects the reset and explains that the user can request a new code

### Requirement: Authentication remains invite-only and preserves API compatibility
The system SHALL keep self-service account creation disabled. Protected `/api/v1` requests SHALL continue to use Cognito access-token validation, and the Google Reader API authentication behavior SHALL remain unchanged.

#### Scenario: User attempts self-service signup
- **WHEN** a user attempts to create an account through the web application
- **THEN** no self-service signup flow is available

#### Scenario: Existing protected API request
- **WHEN** the web application makes a protected `/api/v1` request with a valid Cognito access token
- **THEN** the API accepts it under the existing authorization contract

#### Scenario: Google Reader API request
- **WHEN** a Google Reader-compatible client authenticates using the existing API-token flow
- **THEN** the request continues to behave according to the existing Google Reader API contract
