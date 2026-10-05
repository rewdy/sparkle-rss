# Tasks

## 1. Cognito service auth API

- [x] 1.1 Add Cognito password authentication, `NEW_PASSWORD_REQUIRED` challenge completion, refresh-token renewal/revocation, and password-recovery operations to the API; verify with focused unit tests for successful and rejected provider responses.
- [x] 1.2 Add `/api/auth/*` sign-in, refresh, sign-out, forgot-password, and confirm-reset endpoints, including seven-day secure HttpOnly refresh-cookie set/clear behavior and non-enumerating reset responses; verify with API contract tests.
- [x] 1.3 Open only `/api/auth/*` in API Gateway and configure the Cognito app client for service password auth with seven-day refresh-token validity; verify `terraform fmt -check -recursive` and `terraform validate`.
- [x] 1.4 Update the API/auth documentation and operational notes for the new endpoints, cookie behavior, Cognito flow, and unchanged invite-only provisioning; verify the docs describe the shipped request and response behavior.

## 2. First-party web auth experience

- [x] 2.1 Replace hosted-UI redirect/callback behavior with branded sign-in, temporary-password completion, and password-recovery/reset screens; verify web tests cover the successful and error states.
- [x] 2.2 Change the web session client to obtain access tokens from the auth API, renew through the HttpOnly cookie, and clear session state on sign-out or confirmed expiry; verify auth/session tests cover renewal and expiry while existing `/api/v1` requests remain authenticated.
- [x] 2.3 Remove obsolete hosted-UI callback routing and build-time OIDC config from the web deployment while retaining Cognito issuer/client configuration needed by API verification; verify production build configuration no longer requires browser OIDC redirects.
- [x] 2.4 Update the frontend/auth documentation and roadmap current-state handoff after implementation; verify the docs match the final flow and account-provisioning process.

## 3. Integration and rollout

- [x] 3.1 Verify API Gateway exposes auth routes without weakening `/api/v1` authorization or `/api/greader.php` behavior; run the relevant API contract and Google Reader conformance suites.
- [x] 3.2 Verify sign-in, temporary-password setup, session renewal across reload, sign-out, and password reset against a Cognito test user; record deployment and rollback steps in the decision log. Production Cognito settings now show `ALLOW_USER_PASSWORD_AUTH` and a seven-day refresh lifetime; the user confirmed a successful login after deployment, and the reset, refresh, and sign-out routes were exercised against the disposable Cognito user.
