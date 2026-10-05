# Design

## Context

See proposal.md for motivation and specs/user-auth/spec.md for the behavior contract. Today `apps/web/src/lib/auth.ts` uses `oidc-client-ts` PKCE redirects and stores OIDC state in `sessionStorage`; `apps/api/src/app.ts` verifies Cognito access tokens for `/api/v1`, and API Gateway also has a JWT authorizer on those routes. The Cognito client currently allows SRP and refresh-token auth, with one-hour access/ID tokens and 30-day refresh tokens. The pool is invite-only and MFA is off.

## Goals / Non-Goals

**Goals:**

- Keep password and refresh-token exchanges between the browser and the first-party service, with the service calling Cognito.
- Preserve Cognito access tokens as the credential for existing protected API routes.
- Support admin-created users who must replace a temporary password at first sign-in.
- Make the refresh-token window seven days and offer first-party password recovery.

**Non-Goals:**

- Self-service signup, MFA policy changes, social identity providers, or changes to Google Reader authentication.
- Replacing Cognito or changing user provisioning operations.

## Decisions

### Use unauthenticated same-origin auth endpoints

Add a dedicated `/api/auth/*` route family. Those routes must be explicitly open in API Gateway and bypass the `/api/v1` JWT middleware; all existing `/api/v1` routes remain protected. CloudFront already forwards `/api/*` to the API, so the browser can call these endpoints at the app origin without a new cross-origin trust relationship.

The API will use Cognito's user-pool client operations for password authentication, challenge completion, refresh, sign-out/revocation, and password recovery. The app client will enable the password auth flow required by the service while remaining a public client without a secret. Signup stays disabled.

### Keep the refresh token in a secure cookie

On successful sign-in, the API returns the Cognito access token to the web app and sets the refresh token in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie with a seven-day lifetime and a narrow `/api/auth` path. Renewal reads that cookie and returns a replacement access token; sign-out revokes the refresh token and clears the cookie. Passwords and refresh tokens are never written to browser storage. The web app may keep the short-lived access token in memory and request renewal when it expires or an API call receives 401.

This avoids exposing the long-lived credential to application JavaScript. A JavaScript-held refresh token in local/session storage was considered simpler, but increases the impact of an XSS issue. Same-origin cookie use also avoids enabling broad credentialed CORS.

### Keep access-token lifetimes short and set refresh validity to seven days

Keep the existing one-hour access and ID token validity. Change only refresh-token validity from 30 days to seven days. This limits the time a stolen access token is useful while letting normal web activity renew access without another password prompt during the requested week.

### Use generic password-recovery acknowledgements

The recovery request endpoint will return the same acknowledgement whether Cognito finds the account or not, reducing account enumeration. Cognito remains responsible for code delivery and password policy enforcement. The web flow will accept Cognito's delivery destination metadata when available without changing the generic acknowledgement.

## Risks / Trade-offs

- [A compromised browser can still use the active access token] → Keep it in memory, retain the one-hour access-token validity, and rely on existing API authorization.
- [Cookie-based renewal requires careful browser and proxy handling] → Use same-origin `/api/auth` requests, set secure cookie attributes, and cover cookie set/clear behavior in the API contract.
- [Cognito challenge/error variants may differ from common password flows] → Map provider responses to a small stable set of user-facing errors and explicitly handle `NEW_PASSWORD_REQUIRED`.
- [Users with existing hosted-UI tokens will not have the new refresh cookie after deployment] → The app falls back to the first-party sign-in screen; users sign in once after rollout.

## Migration Plan

1. Add the Cognito password-auth capability and set the app client's refresh-token validity to seven days. Deploy the API routes that support both new sign-in and the current protected API token contract.
2. Deploy the first-party web flow and remove the hosted-UI callback path and web-bundle Cognito OIDC configuration.
3. Existing browser sessions without the new cookie sign in once. Rollback can redeploy the prior web bundle and restore the previous Terraform client settings; existing hosted UI configuration can remain during the transition and be removed after the new flow is verified.

No database migration is required.

## Open Questions

None.
