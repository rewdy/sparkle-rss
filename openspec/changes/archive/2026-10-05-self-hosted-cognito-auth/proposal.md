# Proposal

## Why

The current web login redirects users to Cognito managed login, where intermittent errors are difficult to diagnose and the available styling does not fit the app. A first-party login flow will give users a consistent experience and let the service handle Cognito authentication directly.

## What Changes

- Add first-party service endpoints for sign-in, sign-out, session renewal, and password recovery/reset backed by Cognito.
- Replace the web app's hosted-login redirect and callback flow with self-hosted login and recovery screens.
- Keep user creation invite-only; self-service signup remains disabled.
- Set the Cognito refresh-token lifetime to seven days so users can remain signed in for about a week.
- Preserve the existing Cognito access-token validation used by protected API routes and keep the Google Reader API authentication contract unchanged.

## Capabilities

### New Capabilities

- `user-auth`: First-party web authentication and password recovery through Cognito, with a seven-day session renewal window.

### Modified Capabilities

None.

## Impact

- `apps/api`: unauthenticated auth routes, Cognito operations, token/session handling, and API routing.
- `apps/web`: login and recovery UI, session handling, and removal of the hosted UI callback flow.
- `tf/modules/auth` and API Gateway routing: Cognito app-client token validity and public auth route configuration.
- Deployment configuration and auth documentation. `/api/greader.php` behavior remains unchanged.
